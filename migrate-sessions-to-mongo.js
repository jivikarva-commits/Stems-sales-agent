"use strict";
/**
 * One-time migration: imports every Baileys file-based session in
 * agents/sessions/<safe-owner-email>/ into the MongoDB auth collection.
 *
 * Usage:
 *   node migrate-sessions-to-mongo.js
 *
 * Safe to re-run — each key is upserted by (owner_email, type, id).
 */
const path = require("path");
const fs = require("fs");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const { MongoClient } = require("mongodb");
const { importFileSessionIntoMongo } = require("./agents/wa-auth-mongo");

const SESSIONS_DIR = path.join(__dirname, "agents", "sessions");
const DB_NAME = process.env.WA_AUTH_DB_NAME || "stems-wa-auth";
const COLL_NAME = process.env.WA_AUTH_COLLECTION || "wa_auth";

if (!process.env.MONGODB_URI) {
  console.error("MONGODB_URI not set. Add it to .env or environment.");
  process.exit(1);
}

(async () => {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  console.log(`Connected to MongoDB. Using db=${DB_NAME} coll=${COLL_NAME}`);
  const coll = client.db(DB_NAME).collection(COLL_NAME);
  // Best-effort index — tolerate conflicts if it already exists with a different name
  try {
    await coll.createIndex(
      { owner_email: 1, type: 1, id: 1 },
      { unique: true }
    );
  } catch (e) {
    if (e?.code !== 85) console.warn("[migrate] createIndex warning:", e.message);
  }

  if (!fs.existsSync(SESSIONS_DIR)) {
    console.log(`No sessions/ directory found at ${SESSIONS_DIR} — nothing to migrate.`);
    await client.close();
    return;
  }

  const dirs = fs
    .readdirSync(SESSIONS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  if (!dirs.length) {
    console.log("Sessions directory is empty.");
    await client.close();
    return;
  }

  console.log(`Found ${dirs.length} session folder(s):`, dirs);

  for (const dir of dirs) {
    // Reverse the safeify: replace "_" right before the TLD back to "@".
    const owner = dir.replace(/_(?=[a-z0-9-]+\.[a-z]{2,}$)/, "@");
    if (!owner.includes("@")) {
      console.log(`Skipping ${dir} — could not derive owner email`);
      continue;
    }
    const fullPath = path.join(SESSIONS_DIR, dir);
    const result = await importFileSessionIntoMongo(coll, owner, fullPath);
    console.log(
      `  ${owner}: imported=${result.imported} skipped=${result.skipped} total=${result.total ?? "?"}`
    );
  }

  console.log("\nMigration complete.");
  await client.close();
})().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});