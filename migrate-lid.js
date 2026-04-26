'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const mongoose = require('mongoose');

async function migrate() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB');
  const db = mongoose.connection.db;

  // LIDs are 14+ digit numbers that are NOT real phone numbers
  const LID_REGEX = /^\d{14,}$/;

  const lidConvos = await db.collection('conversations').find({ userId: LID_REGEX }).toArray();
  console.log('LID conversations found:', lidConvos.length);

  const lidProfiles = await db.collection('userprofiles').find({ userId: LID_REGEX }).toArray();
  console.log('LID profiles found:', lidProfiles.length);

  // Get unique LIDs with their owner
  const lidOwnerPairs = [...new Map(
    lidConvos.map(c => [`${c.owner_email}::${c.userId}`, { owner: c.owner_email, lid: c.userId }])
  ).values()];

  for (const { owner, lid } of lidOwnerPairs) {
    // Find any conversation from the same owner with a PHONE userId (10-13 digits)
    // that has assistant messages near the same time as the LID messages
    const lidMsgs = await db.collection('conversations').find({
      owner_email: owner, userId: lid
    }).sort({ timestamp: 1 }).toArray();

    if (!lidMsgs.length) continue;

    const firstTs = new Date(lidMsgs[0].timestamp);
    const lastTs = new Date(lidMsgs[lidMsgs.length - 1].timestamp);
    const windowStart = new Date(firstTs.getTime() - 15 * 60 * 1000);
    const windowEnd = new Date(lastTs.getTime() + 15 * 60 * 1000);

    // Find assistant messages for same owner in that window (phone format userId)
    const matching = await db.collection('conversations').findOne({
      owner_email: owner,
      role: 'assistant',
      timestamp: { $gte: windowStart, $lte: windowEnd },
      userId: { $regex: /^\d{10,13}$/ }
    });

    if (matching) {
      console.log(`Reassigning LID=${lid} -> phone=${matching.userId} (owner=${owner})`);
      const r1 = await db.collection('conversations').updateMany(
        { owner_email: owner, userId: lid },
        { $set: { userId: matching.userId } }
      );
      const r2 = await db.collection('userprofiles').updateMany(
        { owner_email: owner, userId: lid },
        { $set: { userId: matching.userId } }
      );
      console.log(`  Updated convos: ${r1.modifiedCount}, profiles: ${r2.modifiedCount}`);
    } else {
      console.log(`No phone match found for LID=${lid} (owner=${owner}) — leaving as-is`);
    }
  }

  console.log('\nMigration complete!');
  await mongoose.disconnect();
}

migrate().catch(e => { console.error('Migration failed:', e); process.exit(1); });
