import { Router } from "express";
import { db } from "@workspace/db";
import {
  noContactSessionsTable,
  noContactEventsTable,
  relationalMemoryTable,
  relationsTable,
} from "@workspace/db";
import { eq, and, desc, sql } from "drizzle-orm";
import { anthropic } from "@workspace/integrations-anthropic-ai";

const router = Router();

// ── GET /api/relations/:id/no-contact ─────────────────────────────────────────
// Retourne la session active + stats globales
router.get("/relations/:id/no-contact", async (req, res) => {
  const relationId = Number(req.params.id);
  if (isNaN(relationId)) { res.status(400).json({ error: "ID invalide" }); return; }

  const [active] = await db
    .select()
    .from(noContactSessionsTable)
    .where(and(
      eq(noContactSessionsTable.relationId, relationId),
      eq(noContactSessionsTable.isActive, true),
    ))
    .orderBy(desc(noContactSessionsTable.startedAt))
    .limit(1);

  // Stats: total sessions, urges résistées, paniques, resets
  const allSessions = await db
    .select({ id: noContactSessionsTable.id, startedAt: noContactSessionsTable.startedAt, endedAt: noContactSessionsTable.endedAt })
    .from(noContactSessionsTable)
    .where(eq(noContactSessionsTable.relationId, relationId))
    .orderBy(desc(noContactSessionsTable.startedAt));

  let bestSeconds = 0;
  for (const s of allSessions) {
    const end = s.endedAt ?? new Date();
    const dur = (end.getTime() - s.startedAt.getTime()) / 1000;
    if (dur > bestSeconds) bestSeconds = dur;
  }

  const [eventStats] = await db
    .select({
      urges: sql<number>`count(*) filter (where type = 'urge')`,
      panics: sql<number>`count(*) filter (where type = 'panic')`,
      resets: sql<number>`count(*) filter (where type = 'reset')`,
    })
    .from(noContactEventsTable)
    .innerJoin(noContactSessionsTable, eq(noContactEventsTable.sessionId, noContactSessionsTable.id))
    .where(eq(noContactSessionsTable.relationId, relationId));

  res.json({
    active: active ?? null,
    stats: {
      totalSessions: allSessions.length,
      bestSeconds,
      urgesResisted: Number(eventStats?.urges ?? 0),
      panics: Number(eventStats?.panics ?? 0),
      resets: Number(eventStats?.resets ?? 0),
    },
  });
});

// ── POST /api/relations/:id/no-contact/start ──────────────────────────────────
router.post("/relations/:id/no-contact/start", async (req, res) => {
  const relationId = Number(req.params.id);
  if (isNaN(relationId)) { res.status(400).json({ error: "ID invalide" }); return; }

  // Désactive les sessions actives existantes
  await db
    .update(noContactSessionsTable)
    .set({ isActive: false, endedAt: new Date() })
    .where(and(
      eq(noContactSessionsTable.relationId, relationId),
      eq(noContactSessionsTable.isActive, true),
    ));

  const [session] = await db
    .insert(noContactSessionsTable)
    .values({ relationId, startedAt: new Date(), isActive: true })
    .returning();

  res.status(201).json(session);
});

// ── POST /api/relations/:id/no-contact/event ──────────────────────────────────
// type: "urge" | "panic"
router.post("/relations/:id/no-contact/event", async (req, res) => {
  const relationId = Number(req.params.id);
  if (isNaN(relationId)) { res.status(400).json({ error: "ID invalide" }); return; }

  const { type, note } = req.body;
  if (!["urge", "panic"].includes(type)) { res.status(400).json({ error: "Type invalide" }); return; }

  const [active] = await db
    .select()
    .from(noContactSessionsTable)
    .where(and(
      eq(noContactSessionsTable.relationId, relationId),
      eq(noContactSessionsTable.isActive, true),
    ))
    .limit(1);

  if (!active) { res.status(404).json({ error: "Aucune session active" }); return; }

  const [event] = await db
    .insert(noContactEventsTable)
    .values({ sessionId: active.id, type, note: note ?? null })
    .returning();

  res.status(201).json(event);
});

// ── POST /api/relations/:id/no-contact/reset ──────────────────────────────────
// Casse le streak — crée un event reset, clôt la session, en ouvre une nouvelle
router.post("/relations/:id/no-contact/reset", async (req, res) => {
  const relationId = Number(req.params.id);
  if (isNaN(relationId)) { res.status(400).json({ error: "ID invalide" }); return; }

  const { note } = req.body;

  const [active] = await db
    .select()
    .from(noContactSessionsTable)
    .where(and(
      eq(noContactSessionsTable.relationId, relationId),
      eq(noContactSessionsTable.isActive, true),
    ))
    .limit(1);

  if (active) {
    await db
      .insert(noContactEventsTable)
      .values({ sessionId: active.id, type: "reset", note: note ?? null });

    await db
      .update(noContactSessionsTable)
      .set({ isActive: false, endedAt: new Date() })
      .where(eq(noContactSessionsTable.id, active.id));
  }

  // Démarre une nouvelle session
  const [newSession] = await db
    .insert(noContactSessionsTable)
    .values({ relationId, startedAt: new Date(), isActive: true })
    .returning();

  res.status(201).json(newSession);
});

// ── POST /api/relations/:id/no-contact/panic-support  (SSE) ───────────────────
// Génère un message IA d'urgence pour résister à l'envie de contacter
router.post("/relations/:id/no-contact/panic-support", async (req, res) => {
  const relationId = Number(req.params.id);
  if (isNaN(relationId)) { res.status(400).json({ error: "ID invalide" }); return; }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  const send = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    // Charge le contexte relation
    const [relation] = await db.select().from(relationsTable).where(eq(relationsTable.id, relationId)).limit(1);
    const [mem] = await db.select().from(relationalMemoryTable).where(eq(relationalMemoryTable.relationId, relationId)).limit(1);

    const [active] = await db
      .select()
      .from(noContactSessionsTable)
      .where(and(eq(noContactSessionsTable.relationId, relationId), eq(noContactSessionsTable.isActive, true)))
      .limit(1);

    const secondsIn = active
      ? Math.floor((Date.now() - active.startedAt.getTime()) / 1000)
      : 0;
    const daysIn = Math.floor(secondsIn / 86400);
    const hoursIn = Math.floor((secondsIn % 86400) / 3600);

    const me = relation?.participantMe ?? "toi";
    const other = relation?.participantOther ?? "l'autre";
    const summary = mem?.globalSummary ?? "";
    const report = mem?.dynamicReport as Record<string, unknown> | undefined;
    const pd = report?.powerDynamics as Record<string, unknown> | undefined;

    const systemPrompt = `Tu es ReLink AI, mode URGENCE — intervention anti-panique No Contact.

${me} est en train de craquer. Il/elle veut contacter ${other}. TON RÔLE : l'en empêcher maintenant.

CONTEXTE DE LA RELATION :
${summary || "Relation douloureuse avec un fort déséquilibre de pouvoir."}
${pd?.currentDynamicSummary ? `\nDYNAMIQUE : ${pd.currentDynamicSummary}` : ""}

Durée No Contact actuelle : ${daysIn} jour(s) et ${hoursIn} heure(s).

RÈGLES DE RÉPONSE EN MODE PANIQUE :
1. Commence par reconnaître la douleur réelle, sans la minimiser (1-2 phrases max).
2. Rappelle une vérité concrète et dure sur cette relation et ce qui se passerait si ${me} contactait ${other} maintenant.
3. Donne 3 actions concrètes à faire dans les 10 prochaines minutes à la place d'envoyer un message.
4. Termine par une phrase courte, directe, qui donne de la force.

Sois direct, chaleureux, et BREF. Pas de listes à puces — écris comme si tu parlais à un ami en crise.
Réponds en français.`;

    let fullResponse = "";
    const stream = anthropic.messages.stream({
      model: "claude-sonnet-4-6",
      max_tokens: 600,
      system: systemPrompt,
      messages: [{ role: "user", content: `Je veux lui écrire. Aide-moi à tenir.` }],
    });

    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        fullResponse += event.delta.text;
        send({ content: event.delta.text });
      }
    }

    // Log l'événement panique
    if (active) {
      await db.insert(noContactEventsTable).values({
        sessionId: active.id,
        type: "panic",
        note: fullResponse.slice(0, 500),
      });
    }

    send({ done: true });
    res.end();
  } catch {
    send({ error: "Impossible de générer le support." });
    res.end();
  }
});

export default router;
