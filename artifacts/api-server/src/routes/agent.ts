import { Router } from "express";
import { db } from "@workspace/db";
import {
  agentSessionsTable,
  agentMessagesTable,
  relationalMemoryTable,
  whatsappMessagesTable,
  relationsTable,
} from "@workspace/db";
import { eq, desc, sql } from "drizzle-orm";
import { anthropic } from "@workspace/integrations-anthropic-ai";

const router = Router();

// GET /api/relations/:relationId/agent/sessions
router.get("/relations/:relationId/agent/sessions", async (req, res) => {
  const relationId = Number(req.params.relationId);
  if (isNaN(relationId)) { res.status(400).json({ error: "ID invalide" }); return; }

  const sessions = await db
    .select()
    .from(agentSessionsTable)
    .where(eq(agentSessionsTable.relationId, relationId))
    .orderBy(desc(agentSessionsTable.updatedAt));

  res.json(sessions);
});

// POST /api/relations/:relationId/agent/sessions
router.post("/relations/:relationId/agent/sessions", async (req, res) => {
  const relationId = Number(req.params.relationId);
  if (isNaN(relationId)) { res.status(400).json({ error: "ID invalide" }); return; }

  const { title } = req.body;
  if (!title) { res.status(400).json({ error: "Titre requis." }); return; }

  const [session] = await db.insert(agentSessionsTable).values({
    relationId,
    title,
    messageCount: 0,
  }).returning();

  res.status(201).json(session);
});

// GET /api/relations/:relationId/agent/sessions/:sessionId
router.get("/relations/:relationId/agent/sessions/:sessionId", async (req, res) => {
  const relationId = Number(req.params.relationId);
  const sessionId = Number(req.params.sessionId);
  if (isNaN(relationId) || isNaN(sessionId)) { res.status(400).json({ error: "ID invalide" }); return; }

  const [session] = await db.select().from(agentSessionsTable)
    .where(eq(agentSessionsTable.id, sessionId)).limit(1);
  if (!session) { res.status(404).json({ error: "Session introuvable" }); return; }

  const messages = await db.select().from(agentMessagesTable)
    .where(eq(agentMessagesTable.sessionId, sessionId))
    .orderBy(agentMessagesTable.createdAt);

  res.json({
    id: session.id,
    relationId: session.relationId,
    title: session.title,
    createdAt: session.createdAt,
    messages: messages.map(m => ({
      id: m.id,
      sessionId: m.sessionId,
      role: m.role,
      content: m.content,
      contextUsed: m.contextUsed,
      createdAt: m.createdAt,
    })),
  });
});

// POST /api/relations/:relationId/agent/sessions/:sessionId/chat  (SSE)
router.post("/relations/:relationId/agent/sessions/:sessionId/chat", async (req, res) => {
  const relationId = Number(req.params.relationId);
  const sessionId = Number(req.params.sessionId);
  if (isNaN(relationId) || isNaN(sessionId)) { res.status(400).json({ error: "ID invalide" }); return; }

  const { message, selectedMessageIds } = req.body;
  if (!message) { res.status(400).json({ error: "Message requis." }); return; }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const send = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    const [relation] = await db.select().from(relationsTable).where(eq(relationsTable.id, relationId)).limit(1);
    if (!relation) { send({ error: "Relation introuvable" }); res.end(); return; }

    // Build context
    const contextUsed: string[] = [];

    // Relational memory
    const [mem] = await db.select().from(relationalMemoryTable)
      .where(eq(relationalMemoryTable.relationId, relationId)).limit(1);

    // Recent messages (last 30)
    const recentMessages = await db.select().from(whatsappMessagesTable)
      .where(eq(whatsappMessagesTable.relationId, relationId))
      .orderBy(desc(whatsappMessagesTable.sentAt))
      .limit(30);

    recentMessages.reverse();

    // Selected messages context
    let selectedContext = "";
    if (selectedMessageIds?.length) {
      const selected = recentMessages.filter(m => selectedMessageIds.includes(m.id));
      if (selected.length) {
        selectedContext = `\n\nMESSAGES SÉLECTIONNÉS PAR L'UTILISATEUR:\n${selected.map(m =>
          `[${m.sentAt.toISOString().split("T")[0]}] ${m.isMe ? relation.participantMe : relation.participantOther}: ${m.content}`
        ).join("\n")}`;
        contextUsed.push("messages sélectionnés");
      }
    }

    // Build system prompt
    let systemPrompt = `Tu es ReLink AI, un copilote émotionnel expert en relations amoureuses et ruptures.
Tu connais parfaitement la relation entre ${relation.participantMe} et ${relation.participantOther}.
Tu réponds avec empathie, lucidité et bienveillance. Tu ne promets jamais le retour d'un ex, le contrôle d'une autre personne, ou un résultat émotionnel garanti.
Tu distingues toujours les faits des hypothèses et des inconnues.
Tu réponds en français.

RELATION: ${relation.name}
${relation.participantMe} (moi) — ${relation.participantOther} (eux)`;

    if (mem?.globalSummary) {
      systemPrompt += `\n\nMÉMOIRE RELATIONNELLE:\n${mem.globalSummary}`;
      contextUsed.push("mémoire globale");
    }

    if (mem?.currentPhase) {
      systemPrompt += `\nPhase actuelle: ${mem.currentPhase}`;
    }

    if (mem?.recurringTopics?.length) {
      systemPrompt += `\nSujets récurrents: ${mem.recurringTopics.join(", ")}`;
    }

    if (mem?.expressedLimits?.length) {
      systemPrompt += `\nLimites exprimées: ${mem.expressedLimits.join(", ")}`;
    }

    if (recentMessages.length) {
      const transcript = recentMessages
        .slice(-20)
        .map(m => `[${m.sentAt.toISOString().split("T")[0]}] ${m.isMe ? relation.participantMe : relation.participantOther}: ${m.content}`)
        .join("\n");
      systemPrompt += `\n\nDERNIERS MESSAGES:\n${transcript}`;
      contextUsed.push("derniers messages");
    }

    if (selectedContext) {
      systemPrompt += selectedContext;
    }

    // Previous session messages for context
    const prevMessages = await db.select().from(agentMessagesTable)
      .where(eq(agentMessagesTable.sessionId, sessionId))
      .orderBy(agentMessagesTable.createdAt)
      .limit(20);

    // Save user message
    await db.insert(agentMessagesTable).values({
      sessionId,
      role: "user",
      content: message,
      contextUsed,
    });

    // Build conversation history
    const chatHistory = prevMessages.map(m => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));
    chatHistory.push({ role: "user", content: message });

    send({ contextUsed });

    // Stream response
    let fullResponse = "";
    const stream = anthropic.messages.stream({
      model: "claude-sonnet-4-6",
      max_tokens: 8192,
      system: systemPrompt,
      messages: chatHistory,
    });

    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        fullResponse += event.delta.text;
        send({ content: event.delta.text });
      }
    }

    // Save assistant message
    await db.insert(agentMessagesTable).values({
      sessionId,
      role: "assistant",
      content: fullResponse,
      contextUsed,
    });

    // Update session
    await db.update(agentSessionsTable).set({
      messageCount: sql`${agentSessionsTable.messageCount} + 2`,
      updatedAt: new Date(),
    }).where(eq(agentSessionsTable.id, sessionId));

    send({ done: true });
    res.end();
  } catch (err) {
    send({ error: "L'analyse est temporairement indisponible." });
    res.end();
  }
});

export default router;
