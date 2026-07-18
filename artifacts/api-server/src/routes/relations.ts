import { Router } from "express";
import { db } from "@workspace/db";
import {
  relationsTable,
  whatsappMessagesTable,
  relationalMemoryTable,
} from "@workspace/db";
import { eq, count, max } from "drizzle-orm";
import { z } from "zod";

const router = Router();

const createRelationBody = z.object({
  name: z.string().min(1),
  participantMe: z.string().min(1),
  participantOther: z.string().min(1),
});

// GET /api/relations
router.get("/relations", async (req, res) => {
  const relations = await db.select().from(relationsTable).orderBy(relationsTable.createdAt);

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
        participantMe: r.participantMe,
        participantOther: r.participantOther,
        status: r.status,
        messageCount: msgCount?.count ?? 0,
        lastMessageAt: lastMsg?.sentAt ?? null,
        memoryBuiltAt: mem?.builtAt ?? null,
        createdAt: r.createdAt,
      };
    })
  );

  res.json(enriched);
});

// POST /api/relations
router.post("/relations", async (req, res) => {
  const parsed = createRelationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Données invalides" });
    return;
  }

  const [relation] = await db
    .insert(relationsTable)
    .values({
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

// GET /api/relations/:relationId
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

// DELETE /api/relations/:relationId
router.delete("/relations/:relationId", async (req, res) => {
  const relationId = Number(req.params.relationId);
  if (isNaN(relationId)) { res.status(400).json({ error: "ID invalide" }); return; }

  await db.delete(relationsTable).where(eq(relationsTable.id, relationId));
  res.status(204).send();
});

export default router;
