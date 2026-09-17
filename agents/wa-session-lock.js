'use strict';
/**
 * Single-writer lock for a tenant's WhatsApp session.
 *
 * The Baileys auth state in Mongo holds Signal protocol key material, and
 * exactly one process may use a given owner's credentials at a time. When two
 * do, WhatsApp closes one with `Stream Errored (conflict)` and invalidates the
 * session — the user then has to scan a QR code again, and any message sent in
 * the meantime can arrive undecryptable ("Waiting for this message").
 *
 * Instances cannot see each other, but they do share the database, so the lock
 * lives there: an instance may only open a socket for an owner while it holds
 * that owner's lease, and it renews the lease on a heartbeat. If a holder dies,
 * its lease goes stale and another instance may take over after LOCK_TTL_MS.
 */

const os = require('os');
const crypto = require('crypto');

const LOCK_COLLECTION = process.env.WA_LOCK_COLLECTION || 'wa_session_locks';
const LOCK_TTL_MS = Number(process.env.WA_LOCK_TTL_MS || 60_000);
const HEARTBEAT_MS = Math.max(5_000, Math.floor(LOCK_TTL_MS / 4));

// Identifies this process across restarts and hosts.
const INSTANCE_ID = `${os.hostname()}:${process.pid}:${crypto.randomBytes(4).toString('hex')}`;

const heartbeats = new Map(); // ownerEmail -> interval handle

function collection(db) {
  return db.collection(LOCK_COLLECTION);
}

/**
 * Try to take (or renew) the lease for one owner.
 * @returns {Promise<{ok: true} | {ok: false, heldBy: string, since: Date}>}
 */
async function acquire(db, ownerEmail) {
  const owner = String(ownerEmail || '').trim().toLowerCase();
  if (!owner) return { ok: false, heldBy: 'unknown', since: null };

  const coll = collection(db);
  const now = new Date();
  const staleCutoff = new Date(now.getTime() - LOCK_TTL_MS);

  try {
    await coll.updateOne(
      {
        _id: owner,
        // Ours already, or the previous holder stopped renewing.
        $or: [{ instanceId: INSTANCE_ID }, { heartbeatAt: { $lte: staleCutoff } }],
      },
      {
        $set: { instanceId: INSTANCE_ID, heartbeatAt: now },
        $setOnInsert: { acquiredAt: now },
      },
      { upsert: true },
    );
    return { ok: true };
  } catch (e) {
    // Duplicate key means a document already exists for this owner and the
    // filter did not match it — i.e. somebody else holds a live lease.
    if (e?.code === 11000) {
      const held = await coll.findOne({ _id: owner });
      return {
        ok: false,
        heldBy: held?.instanceId || 'unknown',
        since: held?.heartbeatAt || null,
      };
    }
    throw e;
  }
}

/** Keep renewing the lease for as long as the socket is open. */
function startHeartbeat(db, ownerEmail, onLost) {
  const owner = String(ownerEmail || '').trim().toLowerCase();
  stopHeartbeat(owner);
  const handle = setInterval(async () => {
    try {
      const res = await collection(db).updateOne(
        { _id: owner, instanceId: INSTANCE_ID },
        { $set: { heartbeatAt: new Date() } },
      );
      // Losing the lease means another instance took over after we stalled.
      // Better to hear it from ourselves than from WhatsApp's conflict error.
      if (res.matchedCount === 0 && typeof onLost === 'function') onLost(owner);
    } catch (e) {
      console.error('[WA-LOCK] heartbeat error:', e?.message || e);
    }
  }, HEARTBEAT_MS);
  if (typeof handle.unref === 'function') handle.unref();
  heartbeats.set(owner, handle);
}

function stopHeartbeat(ownerEmail) {
  const owner = String(ownerEmail || '').trim().toLowerCase();
  const handle = heartbeats.get(owner);
  if (handle) {
    clearInterval(handle);
    heartbeats.delete(owner);
  }
}

/** Give the lease up so another instance can take over immediately. */
async function release(db, ownerEmail) {
  const owner = String(ownerEmail || '').trim().toLowerCase();
  stopHeartbeat(owner);
  try {
    await collection(db).deleteOne({ _id: owner, instanceId: INSTANCE_ID });
  } catch (e) {
    console.error('[WA-LOCK] release error:', e?.message || e);
  }
}

async function releaseAll(db) {
  await Promise.all([...heartbeats.keys()].map((owner) => release(db, owner)));
}

module.exports = {
  INSTANCE_ID,
  LOCK_TTL_MS,
  acquire,
  release,
  releaseAll,
  startHeartbeat,
  stopHeartbeat,
};
