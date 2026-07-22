import { Router } from "express";
import { db } from "@workspace/db";
import {
  relationsTable,
  whatsappMessagesTable,
  relationalMemoryTable,
} from "@workspace/db";
import { eq, count, max, sql } from "drizzle-orm";
import { z } from "zod";

const router = Router();

const createRelationBody = z.object({
  name: z.string().min(1),
  participantMe: z.string().min(1),
  participantOther: z.string().min(1),
});

// GET /api/relations — only current user's relations
router.get("/relations", async (req, res) => {
  const userId = (req as any).userId as string;

  console.log(`[DEBUG] GET /api/relations userId="${userId}"`);

  // Use raw SQL to bypass any potential Drizzle ORM column mapping issue
  const rawRelations = await db.execute(sql`
    SELECT id, name, participant_me, participant_other, status, sos_mode, created_at, updated_at
    FROM relations
    WHERE user_id = ${userId}
    ORDER BY created_at ASC
  `);

  const relations = rawRelations.rows as Array<{
    id: number; name: string; participant_me: string; participant_other: string;
    status: string; sos_mode: boolean; created_at: Date; updated_at: Date;
  }>;

  console.log(`[DEBUG] relations count=${relations.length} ids=${relations.map(r=>r.id).join(',')}`);

  const enriched = await Promise.all(
    relations.map(async (r) => {
      const [msgCount] = await db
        .select({ count: count() })
        .from(whatsappMessagesTable)
        .where(eq(whatsappMessagesTable.relationId, r.id));

      const [lastMsg] = await db
        .select({ sentAt: max(whatsappMessagesTable.sentAt) })
        .from(whatsappMessagesTable)
        .where(eq(whatsappMessagesTable.relationId, r.id));

      const [mem] = await db
        .select({ builtAt: relationalMemoryTable.builtAt })
        .from(relationalMemoryTable)
        .where(eq(relationalMemoryTable.relationId, r.id))
        .limit(1);

      return {
        id: r.id,
        name: r.name,
        participantMe: r.participant_me,
        participantOther: r.participant_other,
        status: r.status,
        messageCount: msgCount?.count ?? 0,
        lastMessageAt: lastMsg?.sentAt ?? null,
        memoryBuiltAt: mem?.builtAt ?? null,
        createdAt: r.created_at,
      };
    })
  );

  res.json(enriched);
});

// POST /api/relations — always assign to current user
router.post("/relations", async (req, res) => {
  const userId = (req as any).userId as string;
  const parsed = createRelationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Données invalides" });
    return;
  }

  const [relation] = await db
    .insert(relationsTable)
    .values({
      userId,
      name: parsed.data.name,
      participantMe: parsed.data.participantMe,
      participantOther: parsed.data.participantOther,
    })
    .returning();

  res.status(201).json({
    ...relation,
    messageCount: 0,
    lastMessageAt: null,
    memoryBuiltAt: null,
  });
});

// GET /api/relations/:relationId — ownership already verified by middleware
router.get("/relations/:relationId", async (req, res) => {
  const relationId = Number(req.params.relationId);
  if (isNaN(relationId)) { res.status(400).json({ error: "ID invalide" }); return; }

  const [relation] = await db
    .select()
    .from(relationsTable)
    .where(eq(relationsTable.id, relationId))
    .limit(1);

  if (!relation) { res.status(404).json({ error: "Relation introuvable" }); return; }

  const [msgCount] = await db
    .select({ count: count() })
    .from(whatsappMessagesTable)
    .where(eq(whatsappMessagesTable.relationId, relationId));

  const [lastMsg] = await db
    .select({ sentAt: max(whatsappMessagesTable.sentAt) })
    .from(whatsappMessagesTable)
    .where(eq(whatsappMessagesTable.relationId, relationId));

  const [mem] = await db
    .select()
    .from(relationalMemoryTable)
    .where(eq(relationalMemoryTable.relationId, relationId))
    .limit(1);

  res.json({
    id: relation.id,
    name: relation.name,
    participantMe: relation.participantMe,
    participantOther: relation.participantOther,
    status: relation.status,
    messageCount: msgCount?.count ?? 0,
    lastMessageAt: lastMsg?.sentAt ?? null,
    memoryBuiltAt: mem?.builtAt ?? null,
    createdAt: relation.createdAt,
    currentPhase: mem?.currentPhase ?? null,
    summary: mem?.globalSummary ?? null,
  });
});

// PATCH /relations/:relationId — ownership already verified by middleware
router.patch("/relations/:relationId", async (req, res) => {
  const relationId = Number(req.params.relationId);
  if (isNaN(relationId)) { res.status(400).json({ error: "ID invalide" }); return; }

  const { name, participantOther } = req.body ?? {};
  if (!name && !participantOther) {
    res.status(400).json({ error: "Au moins un champ requis (name, participantOther)" });
    return;
  }

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (name) updates.name = String(name).trim();
  if (participantOther) updates.participantOther = String(participantOther).trim();

  await db.update(relationsTable).set(updates).where(eq(relationsTable.id, relationId));

  const [updated] = await db.select().from(relationsTable).where(eq(relationsTable.id, relationId)).limit(1);
  res.json(updated);
});

// DELETE /api/relations/:relationId — ownership already verified by middleware
router.delete("/relations/:relationId", async (req, res) => {
  const relationId = Number(req.params.relationId);
  if (isNaN(relationId)) { res.status(400).json({ error: "ID invalide" }); return; }

  await db.delete(relationsTable).where(eq(relationsTable.id, relationId));
  res.status(204).send();
});

export default router;
