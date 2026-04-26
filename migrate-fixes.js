'use strict';
// Backfill migration:
// 1. Reset all activeConversation flags so the new logic starts clean
// 2. Try to backfill pushName for profiles that don't have one (using Baileys creds)
// 3. Reassign any LID-format userIds (14+ digits) to phone-format if a matching
//    assistant message exists in the same time window for the same owner
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const mongoose = require('mongoose');

async function migrate() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB');
  const db = mongoose.connection.db;

  // ── Step 1: Reset all activeConversation flags ────────────────────────
  // After re-login, all old contacts should be inactive until they message us
  const reset = await db.collection('userprofiles').updateMany(
    {},
    { $set: { activeConversation: false, conversationClosed: false } }
  );
  console.log(`Reset activeConversation on ${reset.modifiedCount} profiles`);

  // ── Step 2: LID -> phone reassignment ──────────────────────────────────
  const LID_REGEX = /^\d{14,}$/;
  const lidConvos = await db.collection('conversations')
    .find({ userId: LID_REGEX })
    .toArray();
  console.log(`LID conversations found: ${lidConvos.length}`);

  const lidPairs = [...new Map(
    lidConvos.map(c => [`${c.owner_email}::${c.userId}`, { owner: c.owner_email, lid: c.userId }])
  ).values()];

  for (const { owner, lid } of lidPairs) {
    const lidMsgs = await db.collection('conversations').find({
      owner_email: owner, userId: lid
    }).sort({ timestamp: 1 }).toArray();
    if (!lidMsgs.length) continue;

    const firstTs = new Date(lidMsgs[0].timestamp);
    const lastTs = new Date(lidMsgs[lidMsgs.length - 1].timestamp);
    const windowStart = new Date(firstTs.getTime() - 15 * 60 * 1000);
    const windowEnd = new Date(lastTs.getTime() + 15 * 60 * 1000);

    const matching = await db.collection('conversations').findOne({
      owner_email: owner,
      role: 'assistant',
      timestamp: { $gte: windowStart, $lte: windowEnd },
      userId: { $regex: /^\d{10,13}$/ }
    });

    if (matching) {
      console.log(`Reassigning LID=${lid} -> phone=${matching.userId} (owner=${owner})`);
      await db.collection('conversations').updateMany(
        { owner_email: owner, userId: lid },
        { $set: { userId: matching.userId } }
      );
      await db.collection('userprofiles').updateMany(
        { owner_email: owner, userId: lid },
        { $set: { userId: matching.userId } }
      );
    } else {
      console.log(`No phone match for LID=${lid} (owner=${owner})`);
    }
  }

  // ── Step 3: Mark all profiles with no pushName so they get refreshed
  // on next interaction. (We can't extract pushName from old messages —
  // it'll be filled when the contact next sends a message.)
  const noNameCount = await db.collection('userprofiles').countDocuments({
    $or: [
      { pushName: { $exists: false } },
      { pushName: null },
      { pushName: '' },
    ],
  });
  console.log(`Profiles without pushName: ${noNameCount} (will be filled on next message)`);

  console.log('\n✅ Migration complete!');
  await mongoose.disconnect();
}

migrate().catch(e => { console.error('Migration failed:', e); process.exit(1); });
