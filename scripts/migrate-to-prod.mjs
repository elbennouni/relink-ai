/**
 * One-shot migration script: copies all data from dev DB to the production API.
 * Run AFTER publishing the app with the migrate_data endpoint.
 *
 * Usage:
 *   node scripts/migrate-to-prod.mjs [PROD_URL]
 *
 * Default PROD_URL: https://ai-agent-tool-mikam514.replit.app
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
import { execSync } from 'child_process';

const PROD_URL = process.argv[2] || 'https://ai-agent-tool-mikam514.replit.app';
const SECRET   = 'relink-migrate-2026-secret';
const TARGET_USER_ID = 'user_3GjaMrTLQgY6tHQ7wI7rGe9DHfo';
const DB_URL = process.env.DATABASE_URL ||
  'postgresql://postgres:password@helium/heliumdb?sslmode=disable';

// ── helpers ──────────────────────────────────────────────────────────────────

function psql(sql) {
  const out = execSync(`psql "${DB_URL}" -t -A -c "${sql.replace(/"/g, '\\"')}"`, {
    encoding: 'utf8', maxBuffer: 200 * 1024 * 1024
  });
  return out.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
}

async function post(body) {
  const resp = await fetch(`${PROD_URL}/api/admin/migrate-data`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-migrate-secret': SECRET,
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`HTTP ${resp.status}: ${text}`);
  }
  return resp.json();
}

// ── 1. Export relations ───────────────────────────────────────────────────────

console.log('📦  Exporting relations from dev DB…');
const relations = psql(`
  SELECT row_to_json(t) FROM (
    SELECT id as old_id, name, participant_me, participant_other,
      status::text, sos_mode,
      to_char(created_at, 'YYYY-MM-DD HH24:MI:SS') as created_at
    FROM relations WHERE id IN (2,4,5) ORDER BY id
  ) t
`);
console.log(`   → ${relations.length} relations`);

// ── 2. Export relational memory ───────────────────────────────────────────────

console.log('🧠  Exporting memory…');
const memory = psql(`
  SELECT row_to_json(t) FROM (
    SELECT relation_id as relation_old_id, global_summary, current_phase,
      recurring_topics, expressed_limits, open_questions, important_events,
      communication_trends, dynamic_report,
      to_char(built_at, 'YYYY-MM-DD HH24:MI:SS') as built_at
    FROM relational_memory WHERE relation_id IN (2,4,5) ORDER BY relation_id
  ) t
`);
console.log(`   → ${memory.length} memory rows`);

// ── 3. Send relations + memory first ─────────────────────────────────────────

console.log('🚀  Sending relations + memory to production…');
const r1 = await post({ targetUserId: TARGET_USER_ID, relations, messages: [], memory });
console.log('   → result:', JSON.stringify(r1.results));
const idMap = r1.results.idMap; // old_id → new_id

// ── 4. Export & send text messages in batches ─────────────────────────────────

const BATCH = 200;
let totalInserted = 0;
let totalSkipped = 0;

for (const relId of [2, 4, 5]) {
  console.log(`\n💬  Migrating text messages for relation ${relId}…`);
  const msgs = psql(`
    SELECT row_to_json(t) FROM (
      SELECT ${relId} as relation_old_id, sender, content, is_me,
        to_char(sent_at, 'YYYY-MM-DD HH24:MI:SS') as sent_at,
        import_source::text, content_hash
      FROM whatsapp_messages
      WHERE relation_id = ${relId} AND (media_data IS NULL OR media_data = '')
      ORDER BY sent_at
    ) t
  `);
  console.log(`   Found ${msgs.length} text messages`);

  for (let i = 0; i < msgs.length; i += BATCH) {
    const batch = msgs.slice(i, i + BATCH);
    const result = await post({ targetUserId: TARGET_USER_ID, relations: [], messages: batch });
    totalInserted += result.results.messages.inserted;
    totalSkipped  += result.results.messages.skipped;
    process.stdout.write(`   ${i + batch.length}/${msgs.length}  (inserted=${totalInserted} skipped=${totalSkipped})\r`);
  }
  console.log();
}

// ── 5. Export & send media messages in batches ───────────────────────────────

for (const relId of [2, 4, 5]) {
  console.log(`\n🎵  Migrating media messages for relation ${relId}…`);
  const mediaMsgs = psql(`
    SELECT row_to_json(t) FROM (
      SELECT ${relId} as relation_old_id, sender, content, is_me,
        to_char(sent_at, 'YYYY-MM-DD HH24:MI:SS') as sent_at,
        import_source::text, content_hash, media_data
      FROM whatsapp_messages
      WHERE relation_id = ${relId} AND media_data IS NOT NULL AND media_data != ''
      ORDER BY sent_at
    ) t
  `);
  console.log(`   Found ${mediaMsgs.length} media messages`);

  // Send one at a time for media (large payloads)
  for (let i = 0; i < mediaMsgs.length; i++) {
    const result = await post({ targetUserId: TARGET_USER_ID, relations: [], messages: [mediaMsgs[i]] });
    totalInserted += result.results.messages.inserted;
    totalSkipped  += result.results.messages.skipped;
    if (i % 10 === 0) process.stdout.write(`   ${i+1}/${mediaMsgs.length}\r`);
  }
  console.log();
}

console.log('\n✅  Migration complete!');
console.log(`   Total inserted: ${totalInserted}`);
console.log(`   Total skipped:  ${totalSkipped}`);
