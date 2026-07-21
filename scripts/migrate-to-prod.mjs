/**
 * One-shot migration script: copies all data from dev DB to the production API.
 * Run AFTER publishing the app with the migrate_data endpoint.
 *
 * Usage:  node scripts/migrate-to-prod.mjs [PROD_URL]
 */

import { execSync } from 'child_process';

const PROD_URL     = process.argv[2] || 'https://ai-agent-tool-mikam514.replit.app';
const SECRET       = 'relink-migrate-2026-secret';
const DB_URL       = process.env.DATABASE_URL ||
  'postgresql://postgres:password@helium/heliumdb?sslmode=disable';

// Migrate for BOTH possible production user IDs so it works regardless of
// which Google account the user signed in with on production.
const TARGET_USERS = [
  'user_3GjaMrTLQgY6tHQ7wI7rGe9DHfo', // old Google account
  'user_3Gk24V9RlvWqCTJAOpUpugyiwuI', // new Google account (most recent login)
];

// ── helpers ───────────────────────────────────────────────────────────────────

function psql(sql) {
  const out = execSync(`psql "${DB_URL}" -t -A -c "${sql.replace(/"/g, '\\"')}"`, {
    encoding: 'utf8', maxBuffer: 200 * 1024 * 1024,
  });
  return out.trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
}

async function post(body) {
  const resp = await fetch(`${PROD_URL}/api/admin/migrate-data`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-migrate-secret': SECRET },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${await resp.text()}`);
  return resp.json();
}

// ── 1. Export relations from dev DB ───────────────────────────────────────────

console.log('📦  Exporting relations from dev DB…');
const relations = psql(`
  SELECT row_to_json(t) FROM (
    SELECT id as old_id, name, participant_me, participant_other,
      status::text, sos_mode, to_char(created_at,'YYYY-MM-DD HH24:MI:SS') as created_at
    FROM relations WHERE id IN (2,4,5) ORDER BY id
  ) t
`);
console.log(`   → ${relations.length} relations`);

// ── 2. Export memory ──────────────────────────────────────────────────────────

console.log('🧠  Exporting memory…');
const memory = psql(`
  SELECT row_to_json(t) FROM (
    SELECT relation_id as relation_old_id, global_summary, current_phase,
      recurring_topics, expressed_limits, open_questions, important_events,
      communication_trends, dynamic_report,
      to_char(built_at,'YYYY-MM-DD HH24:MI:SS') as built_at
    FROM relational_memory WHERE relation_id IN (2,4,5) ORDER BY relation_id
  ) t
`);
console.log(`   → ${memory.length} memory rows`);

// ── 3. Migrate for each target user ──────────────────────────────────────────

for (const targetUserId of TARGET_USERS) {
  console.log(`\n👤  Migrating for user: ${targetUserId}`);

  // Send relations + memory
  const r0 = await post({ targetUserId, relations, messages: [], memory });
  const idMap = r0.results.idMap;
  console.log('   Relations:', JSON.stringify(r0.results).slice(0, 120));

  // Text messages per relation
  let totalIns = 0, totalSkip = 0;
  for (const relId of [2, 4, 5]) {
    const msgs = psql(`
      SELECT row_to_json(t) FROM (
        SELECT ${relId} as relation_old_id, sender, content, is_me,
          to_char(sent_at,'YYYY-MM-DD HH24:MI:SS') as sent_at,
          import_source::text, content_hash
        FROM whatsapp_messages
        WHERE relation_id = ${relId} AND (media_data IS NULL OR media_data = '')
        ORDER BY sent_at
      ) t
    `);
    console.log(`   rel${relId}: ${msgs.length} text msgs`);
    const BATCH = 200;
    for (let i = 0; i < msgs.length; i += BATCH) {
      const r = await post({ targetUserId, relations: [], messages: msgs.slice(i, i + BATCH) });
      totalIns  += r.results.messages.inserted;
      totalSkip += r.results.messages.skipped;
      process.stdout.write(`     ${Math.min(i + BATCH, msgs.length)}/${msgs.length}\r`);
    }
    console.log();
  }

  // Media messages (one at a time — large payloads)
  for (const relId of [2, 4, 5]) {
    const mediaMsgs = psql(`
      SELECT row_to_json(t) FROM (
        SELECT ${relId} as relation_old_id, sender, content, is_me,
          to_char(sent_at,'YYYY-MM-DD HH24:MI:SS') as sent_at,
          import_source::text, content_hash, media_data
        FROM whatsapp_messages
        WHERE relation_id = ${relId} AND media_data IS NOT NULL AND media_data != ''
        ORDER BY sent_at
      ) t
    `);
    if (!mediaMsgs.length) continue;
    console.log(`   rel${relId}: ${mediaMsgs.length} media msgs`);
    for (let i = 0; i < mediaMsgs.length; i++) {
      const r = await post({ targetUserId, relations: [], messages: [mediaMsgs[i]] });
      totalIns  += r.results.messages.inserted;
      totalSkip += r.results.messages.skipped;
      if (i % 5 === 0) process.stdout.write(`     ${i+1}/${mediaMsgs.length}\r`);
    }
    console.log();
  }

  console.log(`   ✅  inserted=${totalIns}  skipped=${totalSkip}`);
}

console.log('\n🎉  Migration complete!');
