#!/usr/bin/env node
/**
 * Migration script: copies dev data → production via the migrate-data endpoint.
 * Run: node scripts/run-migration.mjs
 */
import pg from "pg";
import { createHash } from "crypto";
import https from "https";

const { Client } = pg;

const PROD_URL = "https://ai-agent-tool-mikam514.replit.app/api/admin/migrate-data";
const SECRET   = "relink-migrate-2026-secret";
// The production user who currently has data in prod DB
const TARGET_USER_ID = "user_3GjaMrTLQgY6tHQ7wI7rGe9DHfo";
const DEV_USER_ID    = "user_3Gk24V9RlvWqCTJAOpUpugyiwuI";

const BATCH_SIZE = 100; // messages per HTTP request

// ── helpers ──────────────────────────────────────────────────────────────────

function postJson(url, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname, path: u.pathname, method: "POST", port: 443,
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(data),
        "x-migrate-secret": SECRET,
      },
    }, (res) => {
      let buf = "";
      res.on("data", c => buf += c);
      res.on("end", () => {
        try { resolve(JSON.parse(buf)); }
        catch { resolve({ raw: buf }); }
      });
    });
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

function hash(s) {
  return createHash("sha256").update(s).digest("hex").slice(0, 32);
}

// ── main ─────────────────────────────────────────────────────────────────────

const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

// 1. Load relations from dev DB
const relsRes = await client.query(
  `SELECT id, name, participant_me, participant_other, status::text, sos_mode, created_at
   FROM relations
   WHERE user_id = $1
   ORDER BY id`,
  [DEV_USER_ID]
);
const relations = relsRes.rows.map(r => ({
  old_id: r.id,
  name: r.name,
  participant_me: r.participant_me,
  participant_other: r.participant_other,
  status: r.status,
  sos_mode: r.sos_mode,
  created_at: r.created_at.toISOString(),
}));

console.log("Relations to migrate:", relations.map(r => `${r.old_id}: ${r.name}`).join(", "));

// 2. Send relations first (empty messages) to create them and get idMap
console.log("\nCreating relations in production...");
const initResult = await postJson(PROD_URL, {
  targetUserId: TARGET_USER_ID,
  relations,
  messages: [],
});
if (!initResult.ok) {
  console.error("Failed to create relations:", JSON.stringify(initResult));
  process.exit(1);
}
console.log("Relations:", JSON.stringify(initResult.results));

// 3. For each relation, send messages in batches
for (const rel of relations) {
  const countRes = await client.query(
    "SELECT COUNT(*) as n FROM whatsapp_messages WHERE relation_id = $1",
    [rel.old_id]
  );
  const total = parseInt(countRes.rows[0].n);
  console.log(`\n[${rel.name}] ${total} messages to migrate`);

  let offset = 0;
  let batchNum = 0;
  let totalInserted = 0;
  let totalSkipped  = 0;

  while (offset < total) {
    const msgRes = await client.query(
      `SELECT sender, content, is_me, sent_at, import_source::text, content_hash,
              CASE WHEN LENGTH(media_data) < 500000 THEN media_data ELSE NULL END as media_data
       FROM whatsapp_messages
       WHERE relation_id = $1
       ORDER BY sent_at, id
       LIMIT $2 OFFSET $3`,
      [rel.old_id, BATCH_SIZE, offset]
    );

    const messages = msgRes.rows.map(m => ({
      relation_old_id: rel.old_id,
      sender: m.sender,
      content: m.content,
      is_me: m.is_me,
      sent_at: m.sent_at.toISOString(),
      import_source: m.import_source || "manual",
      content_hash: m.content_hash || hash(`${rel.old_id}:${m.sent_at.toISOString()}:${m.content}`),
      media_data: m.media_data || null,
    }));

    const result = await postJson(PROD_URL, {
      targetUserId: TARGET_USER_ID,
      relations,
      messages,
    });

    if (!result.ok) {
      console.error(`  Batch ${batchNum + 1} error:`, JSON.stringify(result));
    } else {
      const ins = result.results?.messages?.inserted ?? 0;
      const skp = result.results?.messages?.skipped  ?? 0;
      totalInserted += ins;
      totalSkipped  += skp;
      process.stdout.write(`  Batch ${++batchNum}: +${ins} inserted, ${skp} skipped (total so far: ${totalInserted})\n`);
    }

    offset += BATCH_SIZE;
  }

  console.log(`[${rel.name}] Done: ${totalInserted} inserted, ${totalSkipped} skipped`);
}

// 4. Migrate memory
console.log("\nMigrating relational memory...");
const memRes = await client.query(
  `SELECT rm.*, r.id as rel_id
   FROM relational_memory rm
   JOIN relations r ON r.id = rm.relation_id
   WHERE r.user_id = $1`,
  [DEV_USER_ID]
);
const memory = memRes.rows.map(m => ({
  relation_old_id: m.relation_id,
  global_summary: m.global_summary,
  current_phase: m.current_phase,
  recurring_topics: m.recurring_topics,
  expressed_limits: m.expressed_limits,
  open_questions: m.open_questions,
  important_events: m.important_events,
  communication_trends: m.communication_trends,
  dynamic_report: m.dynamic_report,
  built_at: m.built_at?.toISOString() ?? null,
}));

if (memory.length > 0) {
  const memResult = await postJson(PROD_URL, {
    targetUserId: TARGET_USER_ID,
    relations,
    messages: [],
    memory,
  });
  console.log("Memory result:", JSON.stringify(memResult.results?.memory));
} else {
  console.log("No memory to migrate.");
}

await client.end();
console.log("\n✅ Migration complete!");
