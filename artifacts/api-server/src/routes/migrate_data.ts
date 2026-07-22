/**
 * TEMPORARY migration endpoint — remove after use.
 * Copies dev data into the production DB under a target user ID.
 * Protected by a hard-coded secret header.
 */
import { Router } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { getAuth } from "@clerk/express";
import { requireAuth } from "../middlewares/requireAuth";

const router = Router();
const SECRET = "relink-migrate-2026-secret";

// Copy messages from one relation to another (internal DB copy — no data transfer needed)
router.post("/admin/copy-rel-messages", async (req, res) => {
  if (req.headers["x-migrate-secret"] !== SECRET) {
    return res.status(403).json({ error: "Forbidden" });
  }
  const { fromRelId, toRelId } = req.body as { fromRelId: number; toRelId: number };
  if (!fromRelId || !toRelId) return res.status(400).json({ error: "Missing fromRelId or toRelId" });
  try {
    const r = await db.execute(sql`
      INSERT INTO whatsapp_messages (relation_id, sender, content, is_me, sent_at, import_source, content_hash, media_data)
      SELECT ${toRelId}, sender, content, is_me, sent_at, import_source, content_hash, media_data
      FROM whatsapp_messages WHERE relation_id = ${fromRelId}
      ON CONFLICT DO NOTHING
    `);
    return res.json({ ok: true, copied: r.rowCount });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// Delete relations by IDs (for cleaning up duplicates)
router.post("/admin/delete-relations", async (req, res) => {
  if (req.headers["x-migrate-secret"] !== SECRET) {
    return res.status(403).json({ error: "Forbidden" });
  }
  const { ids } = req.body as { ids: number[] };
  if (!ids || !ids.length) return res.status(400).json({ error: "Missing ids" });
  // Use safe integer-only literal to avoid ANY() parameterization issues
  const safeIds = ids.filter(n => Number.isInteger(n) && n > 0).join(",");
  if (!safeIds) return res.status(400).json({ error: "Invalid ids" });
  try {
    const r = await db.execute(sql.raw(`DELETE FROM relations WHERE id IN (${safeIds})`));
    return res.json({ ok: true, deleted: r.rowCount });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// Fix user_id in production DB
router.post("/admin/fix-user-id", async (req, res) => {
  if (req.headers["x-migrate-secret"] !== SECRET) {
    return res.status(403).json({ error: "Forbidden" });
  }
  const { oldUserId, newUserId } = req.body as { oldUserId: string; newUserId: string };
  if (!oldUserId || !newUserId) return res.status(400).json({ error: "Missing oldUserId or newUserId" });
  try {
    const r1 = await db.execute(sql`UPDATE relations SET user_id = ${newUserId} WHERE user_id = ${oldUserId}`);
    const r2 = await db.execute(sql`UPDATE scheduled_messages SET user_id = ${newUserId} WHERE user_id = ${oldUserId}`);
    const r3 = await db.execute(sql`UPDATE push_tokens SET user_id = ${newUserId} WHERE user_id = ${oldUserId}`);
    return res.json({ ok: true, relations: r1.rowCount, scheduled: r2.rowCount, pushTokens: r3.rowCount });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

router.post("/admin/migrate-data", async (req, res) => {
  if (req.headers["x-migrate-secret"] !== SECRET) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const { targetUserId, relations, messages, memory } = req.body as {
    targetUserId: string;
    relations: Array<{
      old_id: number; name: string; participant_me: string;
      participant_other: string; status: string; sos_mode: boolean; created_at: string;
    }>;
    messages: Array<{
      relation_old_id: number; sender: string; content: string; is_me: boolean;
      sent_at: string; import_source: string; content_hash: string | null; media_data: string | null;
    }>;
    memory?: Array<{
      relation_old_id: number; global_summary: string | null; current_phase: string | null;
      recurring_topics: string[]; expressed_limits: string[]; open_questions: string[];
      important_events: string[]; communication_trends: any; dynamic_report: any; built_at: string;
    }>;
  };

  if (!targetUserId || !relations || !messages) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const idMap: Record<number, number> = {};
  const results: Record<string, any> = {};

  try {
    // ── 1. Insert relations ──────────────────────────────────────────────────
    for (const rel of relations) {
      // Check if already exists for this user
      const existing = await db.execute(sql`
        SELECT id FROM relations
        WHERE user_id = ${targetUserId} AND participant_other = ${rel.participant_other}
        LIMIT 1
      `);

      if (existing.rows.length > 0) {
        const existingId = (existing.rows[0] as any).id as number;
        idMap[rel.old_id] = existingId;
        results[`relation_${rel.old_id}`] = `mapped to existing id=${existingId}`;
      } else {
        const inserted = await db.execute(sql`
          INSERT INTO relations (user_id, name, participant_me, participant_other, status, sos_mode, created_at, updated_at)
          VALUES (
            ${targetUserId}, ${rel.name}, ${rel.participant_me}, ${rel.participant_other},
            ${rel.status}::relation_status, ${rel.sos_mode}, ${rel.created_at}, NOW()
          )
          RETURNING id
        `);
        const newId = (inserted.rows[0] as any).id as number;
        idMap[rel.old_id] = newId;
        results[`relation_${rel.old_id}`] = `inserted new id=${newId}`;
      }
    }

    // ── 2. Insert messages ───────────────────────────────────────────────────
    let insertedMsgs = 0;
    let skippedMsgs = 0;

    for (const msg of messages) {
      const newRelId = idMap[msg.relation_old_id];
      if (!newRelId) { skippedMsgs++; continue; }

      // Skip duplicates by content_hash
      if (msg.content_hash) {
        const dup = await db.execute(sql`
          SELECT id FROM whatsapp_messages
          WHERE relation_id = ${newRelId} AND content_hash = ${msg.content_hash}
          LIMIT 1
        `);
        if (dup.rows.length > 0) { skippedMsgs++; continue; }
      }

      // Determine a valid import_source enum value
      const validSources = ["whatsapp_file", "paste", "screenshot", "manual"];
      const src = validSources.includes(msg.import_source) ? msg.import_source : "manual";

      await db.execute(sql`
        INSERT INTO whatsapp_messages
          (relation_id, sender, content, is_me, sent_at, import_source, content_hash, media_data)
        VALUES (
          ${newRelId}, ${msg.sender}, ${msg.content}, ${msg.is_me}, ${msg.sent_at},
          ${src}::import_source, ${msg.content_hash ?? null}, ${msg.media_data ?? null}
        )
      `);
      insertedMsgs++;
    }

    results.messages = { inserted: insertedMsgs, skipped: skippedMsgs };
    results.idMap = idMap;

    // ── 3. Insert memory ─────────────────────────────────────────────────────
    if (memory && memory.length > 0) {
      let insertedMem = 0;
      for (const mem of memory) {
        const newRelId = idMap[mem.relation_old_id];
        if (!newRelId) continue;

        const existing = await db.execute(sql`
          SELECT id FROM relational_memory WHERE relation_id = ${newRelId} LIMIT 1
        `);
        if (existing.rows.length === 0) {
          await db.execute(sql`
            INSERT INTO relational_memory
              (relation_id, global_summary, current_phase, recurring_topics, expressed_limits,
               open_questions, important_events, communication_trends, dynamic_report, built_at)
            VALUES (
              ${newRelId},
              ${mem.global_summary ?? null},
              ${mem.current_phase ?? null},
              ${JSON.stringify(mem.recurring_topics ?? [])}::jsonb,
              ${JSON.stringify(mem.expressed_limits ?? [])}::jsonb,
              ${JSON.stringify(mem.open_questions ?? [])}::jsonb,
              ${JSON.stringify(mem.important_events ?? [])}::jsonb,
              ${JSON.stringify(mem.communication_trends ?? {})}::jsonb,
              ${JSON.stringify(mem.dynamic_report ?? {})}::jsonb,
              ${mem.built_at ?? null}
            )
          `);
          insertedMem++;
        }
      }
      results.memory = { inserted: insertedMem };
    }

    return res.json({ ok: true, results });
  } catch (err: any) {
    console.error("[migrate-data] error:", err);
    return res.status(500).json({ error: String(err.message ?? err) });
  }
});

/**
 * GET /admin/whoami — retourne le userId Clerk vu par ce serveur.
 * Utilisé pour diagnostiquer ce que le serveur prod voit comme userId.
 */
router.get("/admin/whoami", (req, res) => {
  if (req.headers["x-migrate-secret"] !== SECRET) {
    return res.status(403).json({ error: "Forbidden" });
  }
  const auth = getAuth(req);
  return res.json({ userId: auth?.userId ?? null, sessionId: auth?.sessionId ?? null });
});

/**
 * POST /admin/auto-fix-user — lit le userId Clerk depuis le token dans le header,
 * et réassigne toutes les relations de "fromUserId" vers ce userId réel.
 * Utile quand le userId en prod est différent de celui en dev.
 */
router.post("/admin/auto-fix-user", async (req, res) => {
  if (req.headers["x-migrate-secret"] !== SECRET) {
    return res.status(403).json({ error: "Forbidden" });
  }
  const auth = getAuth(req);
  const realUserId = auth?.userId;
  const { fromUserId } = req.body as { fromUserId: string };

  if (!realUserId) {
    return res.status(401).json({ error: "No Clerk userId found — include a valid Bearer token" });
  }
  if (!fromUserId) {
    return res.status(400).json({ error: "Missing fromUserId" });
  }
  if (realUserId === fromUserId) {
    return res.json({ ok: true, message: "Same userId — no change needed", userId: realUserId });
  }

  try {
    const r = await db.execute(sql`
      UPDATE relations SET user_id = ${realUserId} WHERE user_id = ${fromUserId}
    `);
    return res.json({ ok: true, fromUserId, toUserId: realUserId, updated: r.rowCount });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

/**
 * POST /api/migrate/claim-data
 * Authenticated self-service migration: moves ALL relations (and scheduled messages)
 * from any other userId in the DB to the currently signed-in user.
 * Only works when the caller has 0 existing relations — prevents accidental overwrites.
 * Safe for a personal app where there is one real owner.
 */
router.post("/migrate/claim-data", requireAuth, async (req, res) => {
  const currentUserId = (req as any).userId as string;
  if (!currentUserId) return res.status(401).json({ error: "Not authenticated" });

  // Refuse if the current user already has data
  const mine = await db.execute(sql`SELECT id FROM relations WHERE user_id = ${currentUserId} LIMIT 1`);
  if ((mine.rowCount ?? 0) > 0) {
    return res.status(400).json({ error: "Vous avez déjà des relations — pas besoin de migrer.", alreadyHasData: true });
  }

  // Find other userIds that have data
  const others = await db.execute(sql`
    SELECT DISTINCT user_id FROM relations WHERE user_id IS NOT NULL AND user_id != ${currentUserId}
  `);
  if ((others.rowCount ?? 0) === 0) {
    return res.status(404).json({ error: "Aucune donnée à récupérer." });
  }

  // Reassign all relations and messages to current user
  const updated = await db.execute(sql`
    UPDATE relations SET user_id = ${currentUserId} WHERE user_id != ${currentUserId}
  `);
  await db.execute(sql`
    UPDATE scheduled_messages SET user_id = ${currentUserId} WHERE user_id != ${currentUserId}
  `).catch(() => {}); // best-effort

  console.log(`[Migrate] claim-data: ${updated.rowCount} relations → ${currentUserId}`);
  return res.json({ ok: true, claimed: updated.rowCount });
});

export default router;
