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

  const { message, selectedMessageIds, pastedConversation } = req.body;
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

    // Count total messages to give agent full picture
    const [msgCount] = await db
      .select({ total: sql<number>`count(*)` })
      .from(whatsappMessagesTable)
      .where(eq(whatsappMessagesTable.relationId, relationId));

    // Recent messages (last 80 for richer context)
    const recentMessages = await db.select().from(whatsappMessagesTable)
      .where(eq(whatsappMessagesTable.relationId, relationId))
      .orderBy(desc(whatsappMessagesTable.sentAt))
      .limit(80);

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

    // Extract power dynamics from stored report
    const report = mem?.dynamicReport as Record<string, unknown> | undefined;
    const pd = report?.powerDynamics as Record<string, unknown> | undefined;

    // Build system prompt
    const totalMessages = Number(msgCount?.total ?? 0);
    let systemPrompt = `Tu es ReLink AI, un copilote stratégique expert en dynamiques relationnelles et rapports de force.

TU PARLES DIRECTEMENT AVEC : ${relation.participantMe}
C'est ${relation.participantMe} qui t'écrit. Quand tu dis "vous" ou "tu", tu t'adresses à ${relation.participantMe}.
L'autre personne dans la relation est : ${relation.participantOther} — tu n'as pas accès à elle, tu l'analyses à travers les messages.

TA MISSION : aider ${relation.participantMe} à comprendre et rééquilibrer le rapport de force avec ${relation.participantOther}.

PRINCIPES FONDAMENTAUX:
- Tu as lu et analysé TOUTE la conversation (${totalMessages} messages au total). Tu connais les patterns, les tensions, l'histoire.
- Tu analyses avec lucidité et sans complaisance. Tu dis la vérité même inconfortable.
- Tu donnes des conseils CONCRETS et ACTIONNABLES. Si on te montre un message, tu proposes une réponse précise avec l'intention stratégique.
- Tu distingues toujours les faits observables des hypothèses.
- Tu ne promets jamais le retour d'un ex ni le contrôle d'une autre personne — mais tu aides ${relation.participantMe} à reprendre le contrôle de SES comportements.
- Tu réponds en français, avec empathie mais surtout avec clarté stratégique.
- Quand tu cites un message, précise qui l'a écrit : "${relation.participantMe}" ou "${relation.participantOther}".`;

    if (mem?.globalSummary) {
      systemPrompt += `\n\n━━━ CONTEXTE DE LA RELATION ━━━\n${mem.globalSummary}`;
      contextUsed.push("mémoire globale");
    }

    if (mem?.currentPhase) {
      systemPrompt += `\nPhase actuelle: ${mem.currentPhase}`;
    }

    if (mem?.recurringTopics?.length) {
      systemPrompt += `\nSujets récurrents: ${(mem.recurringTopics as string[]).join(", ")}`;
    }

    if (mem?.expressedLimits?.length) {
      systemPrompt += `\nLimites exprimées: ${(mem.expressedLimits as string[]).join(", ")}`;
    }

    // Power dynamics — the core of the agent's strategic awareness
    if (pd) {
      systemPrompt += `\n\n━━━ DYNAMIQUE DE POUVOIR (ANALYSE COMPLÈTE) ━━━`;

      if (pd.currentDynamicSummary) {
        systemPrompt += `\n\nSITUATION ACTUELLE:\n${pd.currentDynamicSummary}`;
        contextUsed.push("dynamique de pouvoir");
      }

      if (typeof pd.imbalanceScore === "number") {
        const score = pd.imbalanceScore as number;
        const label = score < -5 ? "Fort déséquilibre — ${relation.participantOther} domine" :
                      score < -2 ? "Déséquilibre modéré en faveur de ${relation.participantOther}" :
                      score < 2  ? "Relation relativement équilibrée" :
                      score < 5  ? "Légère dominance de ${relation.participantMe}" :
                                   "Fort avantage pour ${relation.participantMe}";
        systemPrompt += `\nScore de déséquilibre: ${score}/10 (${label})`;
      }

      if (Array.isArray(pd.dominancePatterns) && pd.dominancePatterns.length) {
        systemPrompt += `\n\nPATTERNS DE DOMINATION OBSERVÉS:\n${(pd.dominancePatterns as string[]).map(p => `• ${p}`).join("\n")}`;
      }

      if (Array.isArray(pd.submissivePatterns) && pd.submissivePatterns.length) {
        systemPrompt += `\n\nCOMPORTEMENTS SOUMIS DE ${relation.participantMe}:\n${(pd.submissivePatterns as string[]).map(p => `• ${p}`).join("\n")}`;
      }

      if (Array.isArray(pd.tensionPoints) && pd.tensionPoints.length) {
        const tensions = pd.tensionPoints as Array<Record<string, string>>;
        systemPrompt += `\n\nTENSIONS RÉCURRENTES:\n${tensions.map(t =>
          `• Déclencheur: ${t.trigger} → ${t.pattern}`
        ).join("\n")}`;
      }

      if (Array.isArray(pd.powerShifts) && pd.powerShifts.length) {
        systemPrompt += `\n\nBASSCULEMENTS DE POUVOIR:\n${(pd.powerShifts as string[]).map(p => `• ${p}`).join("\n")}`;
      }

      const rs = pd.reversalStrategy as Record<string, unknown> | undefined;
      if (rs) {
        systemPrompt += `\n\n━━━ STRATÉGIE DE RÉÉQUILIBRAGE ━━━`;
        if (rs.mainPrinciple) systemPrompt += `\nPrincipe clé: ${rs.mainPrinciple}`;
        if (Array.isArray(rs.behaviorsToStop) && rs.behaviorsToStop.length) {
          systemPrompt += `\nÀ ARRÊTER IMMÉDIATEMENT:\n${(rs.behaviorsToStop as string[]).map(b => `• ${b}`).join("\n")}`;
        }
        if (Array.isArray(rs.behaviorsToAdopt) && rs.behaviorsToAdopt.length) {
          systemPrompt += `\nÀ ADOPTER:\n${(rs.behaviorsToAdopt as string[]).map(b => `• ${b}`).join("\n")}`;
        }
        if (Array.isArray(rs.messagingPrinciples) && rs.messagingPrinciples.length) {
          systemPrompt += `\nPRINCIPES POUR LES MESSAGES:\n${(rs.messagingPrinciples as string[]).map(b => `• ${b}`).join("\n")}`;
        }
      }

      systemPrompt += `\n\nTu dois garder toute cette analyse en tête dans CHAQUE réponse. Quand l'utilisateur te montre un message ou te demande quoi répondre, applique toujours ces principes stratégiques pour l'aider à rééquilibrer le rapport de force.`;
    }

    if (recentMessages.length) {
      const shown = recentMessages.slice(-60);
      const skipped = recentMessages.length - shown.length;
      const transcript = shown
        .map(m => `[${m.sentAt.toISOString().split("T")[0]}] ${m.isMe ? relation.participantMe : relation.participantOther}: ${m.content}`)
        .join("\n");
      const header = skipped > 0
        ? `(${skipped} messages plus anciens non affichés ici — résumé dans la mémoire relationnelle)`
        : `(${shown.length} derniers messages sur ${totalMessages} au total)`;
      systemPrompt += `\n\n━━━ MESSAGES DE LA CONVERSATION ━━━\n${header}\n${transcript}`;
      contextUsed.push("messages conversation");
    } else if (!mem) {
      systemPrompt += `\n\n[Aucun message importé pour l'instant. Invite ${relation.participantMe} à importer la conversation ou à coller du texte directement.]`;
    }

    if (selectedContext) {
      systemPrompt += selectedContext;
    }

    // Pasted raw conversation from user
    if (pastedConversation && typeof pastedConversation === "string" && pastedConversation.trim().length > 20) {
      systemPrompt += `\n\n━━━ CONVERSATION COLLÉE PAR L'UTILISATEUR ━━━\nL'utilisateur t'a fourni directement ce texte de conversation. Analyse-le avec précision — patterns de pouvoir, tensions, formulations — et réponds à sa question en te basant sur ce contenu.\n\n${pastedConversation.trim()}`;
      contextUsed.push("conversation collée");
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
