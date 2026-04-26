"use strict";
/**
 * MongoDB-backed Baileys auth state.
 *
 * Drop-in replacement for `useMultiFileAuthState`. Stores credentials and signal
 * keys in a separate MongoDB database (`stems-wa-auth`) so that Baileys session
 * data survives container restarts on platforms with ephemeral filesystems
 * (Render free tier, Heroku, Fly.io, etc.).
 *
 * Schema (collection: `wa_auth`):
 *   {
 *     owner_email: "user@example.com",  // tenant key
 *     type: "creds" | "pre-key" | "session" | "sender-key" | "app-state-sync-key" | "app-state-sync-version" | "sender-key-memory",
 *     id: "<key id>",                   // empty string for `creds`
 *     value: <BSON-serialised buffer-aware payload>,
 *     updated_at: Date
 *   }
 *
 * Compound unique index on (owner_email, type, id).
 *
 * Buffers are preserved using BSON's native Binary type. We serialise using
 * Baileys' provided helpers (BufferJSON) so structure round-trips losslessly.
 */

const { initAuthCreds, BufferJSON, proto } = require("@whiskeysockets/baileys");

// All Baileys signal-key categories that need to be persisted.
const KEY_TYPES = [
  "pre-key",
  "session",
  "sender-key",
  "sender-key-memory",
  "app-state-sync-key",
  "app-state-sync-version",
];

function reviveValue(stored) {
  if (stored === null || stored === undefined) return null;
  // We stored via BufferJSON.replacer (which converts Buffers to {type:"Buffer",data:[...]}).
  // Round-trip through BufferJSON.reviver to get real Buffers / proto messages back.
  return JSON.parse(JSON.stringify(stored), BufferJSON.reviver);
}

function encodeValue(raw) {
  // BufferJSON.replacer handles Buffer objects, ArrayBuffers, Uint8Arrays.
  return JSON.parse(JSON.stringify(raw, BufferJSON.replacer));
}

/**
 * Build a Baileys auth-state object whose `state.creds` and `state.keys` are
 * read/written from the given MongoDB collection.
 *
 * @param {import("mongodb").Collection} collection
 * @param {string} ownerEmail tenant identifier (one auth state per owner)
 * @returns {Promise<{ state: any, saveCreds: () => Promise<void> }>}
 */
async function useMongoAuthState(collection, ownerEmail) {
  if (!collection) throw new Error("useMongoAuthState: collection is required");
  if (!ownerEmail) throw new Error("useMongoAuthState: ownerEmail is required");

  const owner = String(ownerEmail).trim().toLowerCase();

  async function readDoc(type, id) {
    const doc = await collection.findOne(
      { owner_email: owner, type, id: String(id || "") },
      { projection: { _id: 0, value: 1 } }
    );
    return doc ? reviveValue(doc.value) : null;
  }

  async function writeDoc(type, id, value) {
    if (value === null || value === undefined) {
      await collection.deleteOne({ owner_email: owner, type, id: String(id || "") });
      return;
    }
    await collection.updateOne(
      { owner_email: owner, type, id: String(id || "") },
      {
        $set: {
          owner_email: owner,
          type,
          id: String(id || ""),
          value: encodeValue(value),
          updated_at: new Date(),
        },
      },
      { upsert: true }
    );
  }

  // Load (or create) credentials.
  let creds = await readDoc("creds", "");
  if (!creds) {
    creds = initAuthCreds();
    await writeDoc("creds", "", creds);
  }

  const state = {
    creds,
    keys: {
      get: async (type, ids) => {
        if (!KEY_TYPES.includes(type)) {
          // Unknown type — Baileys still may ask. Return empty object.
          return {};
        }
        const out = {};
        // Bulk fetch for speed
        const docs = await collection
          .find(
            {
              owner_email: owner,
              type,
              id: { $in: ids.map(String) },
            },
            { projection: { _id: 0, id: 1, value: 1 } }
          )
          .toArray();
        const byId = new Map(docs.map((d) => [d.id, reviveValue(d.value)]));
        for (const id of ids) {
          let value = byId.get(String(id));
          if (value && type === "app-state-sync-key" && value) {
            // Baileys expects this particular type to be a proto message.
            try {
              value = proto.Message.AppStateSyncKeyData.fromObject(value);
            } catch (_) {
              /* ignore — let Baileys handle */
            }
          }
          if (value !== undefined && value !== null) out[id] = value;
        }
        return out;
      },
      set: async (data) => {
        // `data` looks like: { 'pre-key': { '<id>': value | null }, 'session': {...}, ... }
        const ops = [];
        for (const type of Object.keys(data)) {
          for (const id of Object.keys(data[type] || {})) {
            const value = data[type][id];
            if (value === null || value === undefined) {
              ops.push({
                deleteOne: { filter: { owner_email: owner, type, id: String(id) } },
              });
            } else {
              ops.push({
                updateOne: {
                  filter: { owner_email: owner, type, id: String(id) },
                  update: {
                    $set: {
                      owner_email: owner,
                      type,
                      id: String(id),
                      value: encodeValue(value),
                      updated_at: new Date(),
                    },
                  },
                  upsert: true,
                },
              });
            }
          }
        }
        if (ops.length) {
          try {
            await collection.bulkWrite(ops, { ordered: false });
          } catch (e) {
            // bulkWrite throws on partial failures — log but don't crash the socket
            console.error("[wa-auth] bulkWrite error:", e?.message || e);
          }
        }
      },
    },
  };

  async function saveCreds() {
    await writeDoc("creds", "", state.creds);
  }

  return { state, saveCreds };
}

/**
 * Delete every auth document for a given tenant. Use on /logout.
 */
async function clearMongoAuthState(collection, ownerEmail) {
  const owner = String(ownerEmail).trim().toLowerCase();
  if (!owner) return { deletedCount: 0 };
  const r = await collection.deleteMany({ owner_email: owner });
  return r;
}

/**
 * One-time migration: import an existing on-disk Baileys session
 * (the kind produced by `useMultiFileAuthState`) into MongoDB.
 *
 * Re-running is safe: each key is upserted by (owner_email, type, id).
 */
async function importFileSessionIntoMongo(collection, ownerEmail, sessionDir) {
  const fs = require("fs");
  const path = require("path");
  const owner = String(ownerEmail).trim().toLowerCase();
  if (!fs.existsSync(sessionDir)) {
    return { imported: 0, skipped: 0, reason: "session_dir_missing" };
  }

  const files = fs.readdirSync(sessionDir).filter((f) => f.endsWith(".json"));
  let imported = 0;
  let skipped = 0;

  for (const filename of files) {
    const fullPath = path.join(sessionDir, filename);
    let raw;
    try {
      raw = fs.readFileSync(fullPath, "utf8");
    } catch {
      skipped++;
      continue;
    }

    let parsed;
    try {
      parsed = JSON.parse(raw, BufferJSON.reviver);
    } catch {
      skipped++;
      continue;
    }

    let type = null;
    let id = "";

    if (filename === "creds.json") {
      type = "creds";
      id = "";
    } else {
      // useMultiFileAuthState writes "<type>-<id>.json" with "/" replaced by "__".
      // Reverse-engineer the type+id.
      const stripped = filename.replace(/\.json$/, "");
      const matchedType = KEY_TYPES.find(
        (t) => stripped === t || stripped.startsWith(t + "-")
      );
      if (!matchedType) {
        skipped++;
        continue;
      }
      type = matchedType;
      id = stripped.slice(matchedType.length + 1).replace(/__/g, "/");
    }

    await collection.updateOne(
      { owner_email: owner, type, id },
      {
        $set: {
          owner_email: owner,
          type,
          id,
          value: encodeValue(parsed),
          updated_at: new Date(),
          migrated_from_file: filename,
        },
      },
      { upsert: true }
    );
    imported++;
  }

  return { imported, skipped, total: files.length };
}

module.exports = {
  useMongoAuthState,
  clearMongoAuthState,
  importFileSessionIntoMongo,
  KEY_TYPES,
};