#!/usr/bin/env node
/**
 * Migration: copies dev DB → production via the migrate-data endpoint.
 * Writes SQL to temp files to avoid shell-escaping issues.
 */
const { execSync, spawnSync } = require("child_process");
const https  = require("https");
const crypto = require("crypto");
const fs     = require("fs");
const path   = require("path");
const os     = require("os");

const PROD_URL    = "https://ai-agent-tool-mikam514.replit.app/api/admin/migrate-data";
const SECRET      = "relink-migrate-2026-secret";
const TARGET_USER = "user_3GjaMrTLQgY6tHQ7wI7rGe9DHfo";
const DEV_USER    = "user_3Gk24V9RlvWqCTJAOpUpugyiwuI";
const DB          = process.env.DATABASE_URL;
const BATCH       = 80;

// Run a SQL query via a temp file (avoids all escaping nightmares)
function sql(query) {
  const tmp = path.join(os.tmpdir(), `mig_${Date.now()}.sql`);
  fs.writeFileSync(tmp, query);
  const result = spawnSync("psql", [DB, "-t", "-A", "-f", tmp], {
    maxBuffer: 50 * 1024 * 1024,
  });
  fs.unlinkSync(tmp);
  if (result.status !== 0) {
    throw new Error(result.stderr.toString());
  }
  const out = result.stdout.toString().trim();
  if (!out || out === "NULL") return null;
  return JSON.parse(out);
}

function scalarSql(query) {
  const tmp = path.join(os.tmpdir(), `mig_${Date.now()}.sql`);
  fs.writeFileSync(tmp, query);
  const result = spawnSync("psql", [DB, "-t", "-A", "-f", tmp]);
  fs.unlinkSync(tmp);
  if (result.status !== 0) throw new Error(result.stderr.toString());
  return result.stdout.toString().trim();
}

function postJson(body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const u    = new URL(PROD_URL);
    const req  = https.request(
      {
        hostname: u.hostname, path: u.pathname, method: "POST", port: 443,
        headers: {
          "Content-Type":   "application/json",
          "Content-Length": Buffer.byteLength(data),
          "x-migrate-secret": SECRET,
        },
      },
      (res) => {
        let buf = "";
        res.on("data", (c) => (buf += c));
        res.on("end", () => {
          try { resolve(JSON.parse(buf)); }
          catch { resolve({ raw: buf.slice(0, 400) }); }
        });
      }
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

function makeHash(str) {
  return crypto.createHash("sha256").update(str).digest("hex").slice(0, 32);
}

async function main() {
  // 1. Load relations from dev DB
  const relations = sql(`
    SELECT json_agg(row_to_json(t)) FROM (
      SELECT id AS old_id, name, participant_me, participant_other,
             status::text, sos_mode,
             to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at
      FROM relations
      WHERE user_id = '${DEV_USER}'
      ORDER BY id
    ) t;
  `);
  if (!relations) { console.error("No relations found in dev DB"); process.exit(1); }
  console.log("Relations to migrate:", relations.map((r) => `${r.old_id}: ${r.name}`).join(", "));

  // 2. Create relations in production (no messages yet) to get the idMap
  console.log("\nCreating relations in production...");
  const initRes = await postJson({ targetUserId: TARGET_USER, relations, messages: [] });
  if (!initRes.ok) {
    console.error("Failed:", JSON.stringify(initRes));
    process.exit(1);
  }
  console.log("Relation results:", JSON.stringify(initRes.results));

  // 3. Send messages per relation in batches
  for (const rel of relations) {
    const total = parseInt(scalarSql(`SELECT COUNT(*) FROM whatsapp_messages WHERE relation_id = ${rel.old_id};`));
    console.log(`\n[${rel.name}] ${total} messages to migrate`);

    let offset = 0, batchNum = 0, totalIns = 0, totalSkip = 0;

    while (offset < total) {
      const msgs = sql(`
        SELECT json_agg(row_to_json(t)) FROM (
          SELECT sender, content, is_me,
                 to_char(sent_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS sent_at,
                 import_source::text AS import_source,
                 content_hash,
                 CASE WHEN media_data IS NOT NULL AND LENGTH(media_data) < 400000
                      THEN media_data ELSE NULL END AS media_data
          FROM whatsapp_messages
          WHERE relation_id = ${rel.old_id}
          ORDER BY sent_at, id
          LIMIT ${BATCH} OFFSET ${offset}
        ) t;
      `);

      if (!msgs) { offset += BATCH; continue; }

      const messages = msgs.map((m) => ({
        relation_old_id: rel.old_id,
        sender:          m.sender,
        content:         m.content,
        is_me:           m.is_me,
        sent_at:         m.sent_at,
        import_source:   m.import_source || "manual",
        content_hash:    m.content_hash || makeHash(`${rel.old_id}:${m.sent_at}:${m.content}`),
        media_data:      m.media_data || null,
      }));

      const res = await postJson({ targetUserId: TARGET_USER, relations, messages });
      if (!res.ok) {
        console.error(`  Batch ${batchNum + 1} error:`, JSON.stringify(res).slice(0, 300));
      } else {
        const ins  = res.results?.messages?.inserted ?? 0;
        const skip = res.results?.messages?.skipped  ?? 0;
        totalIns  += ins;
        totalSkip += skip;
        process.stdout.write(
          `  Batch ${++batchNum}: offset=${offset} → +${ins} inserted, ${skip} skipped (running total: ${totalIns})\n`
        );
      }
      offset += BATCH;
    }
    console.log(`  ✓ [${rel.name}] done: ${totalIns} inserted, ${totalSkip} skipped`);
  }

  // 4. Migrate relational memory
  console.log("\nMigrating relational memory...");
  const memory = sql(`
    SELECT json_agg(row_to_json(t)) FROM (
      SELECT rm.relation_id AS relation_old_id,
             rm.global_summary, rm.current_phase,
             rm.recurring_topics, rm.expressed_limits,
             rm.open_questions, rm.important_events,
             rm.communication_trends, rm.dynamic_report,
             to_char(rm.built_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS built_at
      FROM relational_memory rm
      JOIN relations r ON r.id = rm.relation_id
      WHERE r.user_id = '${DEV_USER}'
    ) t;
  `);

  if (memory && memory.length > 0) {
    const memRes = await postJson({ targetUserId: TARGET_USER, relations, messages: [], memory });
    console.log("Memory result:", JSON.stringify(memRes.results?.memory ?? memRes));
  } else {
    console.log("No memory to migrate.");
  }

  console.log("\n✅ Migration complete!");
}

main().catch((e) => { console.error("Fatal:", e.message ?? e); process.exit(1); });
