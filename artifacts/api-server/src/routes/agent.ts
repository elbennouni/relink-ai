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

// ─── Shared helpers ───────────────────────────────────────────────────────────

type Relation = { participantMe: string; participantOther: string };
type Memory = {
  globalSummary?: string | null;
  currentPhase?: string | null;
  recurringTopics?: unknown;
  expressedLimits?: unknown;
  dynamicReport?: unknown;
};

async function buildContext(relationId: number) {
  const [relation] = await db
    .select()
    .from(relationsTable)
    .where(eq(relationsTable.id, relationId))
    .limit(1);

  if (!relation) return null;

  const [mem] = await db
    .select()
    .from(relationalMemoryTable)
    .where(eq(relationalMemoryTable.relationId, relationId))
    .limit(1);

  const [msgCount] = await db
    .select({ total: sql<number>`count(*)` })
    .from(whatsappMessagesTable)
    .where(eq(whatsappMessagesTable.relationId, relationId));

  const recentMessages = await db
    .select()
    .from(whatsappMessagesTable)
    .where(eq(whatsappMessagesTable.relationId, relationId))
    .orderBy(desc(whatsappMessagesTable.sentAt))
    .limit(80);

  recentMessages.reverse();

  return { relation, mem: mem as Memory | undefined, msgCount, recentMessages };
}

function buildSystemPrompt(
  relation: Relation,
  mem: Memory | undefined,
  totalMessages: number,
  recentMessages: Array<{ sentAt: Date; isMe: boolean; content: string }>,
  options: { selectedContext?: string; pastedConversation?: string } = {}
): { systemPrompt: string; contextUsed: string[] } {
  const contextUsed: string[] = [];
  const me = relation.participantMe;
  const other = relation.participantOther;

  let systemPrompt = `Tu es ReLink AI, un copilote stratégique expert en dynamiques relationnelles et rapports de force.

TU PARLES DIRECTEMENT AVEC : ${me}
C'est ${me} qui t'écrit. Quand tu dis "vous" ou "tu", tu t'adresses à ${me}.
L'autre personne dans la relation est : ${other} — tu n'as pas accès à elle, tu l'analyses à travers les messages.

TA MISSION : aider ${me} à comprendre et rééquilibrer le rapport de force avec ${other}.

PRINCIPES FONDAMENTAUX:
- Tu as lu et analysé TOUTE la conversation (${totalMessages} messages au total). Tu connais les patterns, les tensions, l'histoire.
- Tu analyses avec lucidité et sans complaisance. Tu dis la vérité même inconfortable.
- Tu donnes des conseils CONCRETS et ACTIONNABLES. Si on te montre un message, tu proposes une réponse précise avec l'intention stratégique.
- Tu distingues toujours les faits observables des hypothèses.
- Tu ne promets jamais le retour d'un ex ni le contrôle d'une autre personne — mais tu aides ${me} à reprendre le contrôle de SES comportements.
- Tu réponds en français, avec empathie mais surtout avec clarté stratégique.
- Quand tu cites un message, précise qui l'a écrit : "${me}" ou "${other}".`;

  if (mem?.globalSummary) {
    systemPrompt += `\n\n━━━ CONTEXTE DE LA RELATION ━━━\n${mem.globalSummary}`;
    contextUsed.push("mémoire globale");
  }

  if (mem?.currentPhase) {
    systemPrompt += `\nPhase actuelle: ${mem.currentPhase}`;
  }

  if (mem?.recurringTopics && Array.isArray(mem.recurringTopics) && mem.recurringTopics.length) {
    systemPrompt += `\nSujets récurrents: ${(mem.recurringTopics as string[]).join(", ")}`;
  }

  if (mem?.expressedLimits && Array.isArray(mem.expressedLimits) && mem.expressedLimits.length) {
    systemPrompt += `\nLimites exprimées: ${(mem.expressedLimits as string[]).join(", ")}`;
  }

  const report = mem?.dynamicReport as Record<string, unknown> | undefined;
  const pd = report?.powerDynamics as Record<string, unknown> | undefined;

  if (pd) {
    systemPrompt += `\n\n━━━ DYNAMIQUE DE POUVOIR (ANALYSE COMPLÈTE) ━━━`;

    if (pd.currentDynamicSummary) {
      systemPrompt += `\n\nSITUATION ACTUELLE:\n${pd.currentDynamicSummary}`;
      contextUsed.push("dynamique de pouvoir");
    }

    if (typeof pd.imbalanceScore === "number") {
      const score = pd.imbalanceScore as number;
      const label =
        score < -5 ? `Fort déséquilibre — ${other} domine` :
        score < -2 ? `Déséquilibre modéré en faveur de ${other}` :
        score < 2  ? "Relation relativement équilibrée" :
        score < 5  ? `Légère dominance de ${me}` :
                     `Fort avantage pour ${me}`;
      systemPrompt += `\nScore de déséquilibre: ${score}/10 (${label})`;
    }

    if (Array.isArray(pd.dominancePatterns) && pd.dominancePatterns.length) {
      systemPrompt += `\n\nPATTERNS DE DOMINATION OBSERVÉS:\n${(pd.dominancePatterns as string[]).map(p => `• ${p}`).join("\n")}`;
    }

    if (Array.isArray(pd.submissivePatterns) && pd.submissivePatterns.length) {
      systemPrompt += `\n\nCOMPORTEMENTS SOUMIS DE ${me}:\n${(pd.submissivePatterns as string[]).map(p => `• ${p}`).join("\n")}`;
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
      .map(m => `[${m.sentAt.toISOString().split("T")[0]}] ${m.isMe ? me : other}: ${m.content}`)
      .join("\n");
    const header = skipped > 0
      ? `(${skipped} messages plus anciens non affichés ici — résumé dans la mémoire relationnelle)`
      : `(${shown.length} derniers messages sur ${totalMessages} au total)`;
    systemPrompt += `\n\n━━━ MESSAGES DE LA CONVERSATION ━━━\n${header}\n${transcript}`;
    contextUsed.push("messages conversation");
  } else if (!mem) {
    systemPrompt += `\n\n[Aucun message importé pour l'instant. Invite ${me} à importer la conversation ou à coller du texte directement.]`;
  }

  if (options.selectedContext) {
    systemPrompt += options.selectedContext;
  }

  if (options.pastedConversation && options.pastedConversation.trim().length > 20) {
    systemPrompt += `\n\n━━━ CONVERSATION COLLÉE PAR L'UTILISATEUR ━━━\nL'utilisateur t'a fourni directement ce texte de conversation. Analyse-le avec précision — patterns de pouvoir, tensions, formulations — et réponds à sa question en te basant sur ce contenu.\n\n${options.pastedConversation.trim()}`;
    contextUsed.push("conversation collée");
  }

  return { systemPrompt, contextUsed };
}

// ─── Routes ───────────────────────────────────────────────────────────────────

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

// POST /api/relations/:relationId/agent/sessions/:sessionId/intro  (SSE — no user message saved)
// Génère automatiquement un bilan de la relation au démarrage d'une nouvelle session.
router.post("/relations/:relationId/agent/sessions/:sessionId/intro", async (req, res) => {
  const relationId = Number(req.params.relationId);
  const sessionId = Number(req.params.sessionId);
  if (isNaN(relationId) || isNaN(sessionId)) { res.status(400).json({ error: "ID invalide" }); return; }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const send = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    const ctx = await buildContext(relationId);
    if (!ctx) { send({ error: "Relation introuvable" }); res.end(); return; }

    const { relation, mem, msgCount, recentMessages } = ctx;
    const totalMessages = Number(msgCount?.total ?? 0);
    const { systemPrompt, contextUsed } = buildSystemPrompt(relation, mem, totalMessages, recentMessages);

    send({ contextUsed });

    const hasMem = !!(mem?.globalSummary || mem?.dynamicReport);
    const introPrompt = hasMem
      ? `Tu viens d'être ouvert pour la première fois dans cette session avec ${relation.participantMe}.

Présente-toi en 3-4 paragraphes. Montre immédiatement que tu connais leur histoire :
1. Confirme que tu as analysé toute la conversation (${totalMessages} messages) et que tu connais leur relation avec ${relation.participantOther} en profondeur — pas besoin de tout réexpliquer.
2. Résume en 2-3 points concrets ce que tu as retenu : la dynamique principale, un pattern clé observé, et la phase actuelle de la relation.
3. Dis clairement ce sur quoi tu peux aider concrètement (analyser un message reçu, préparer une réponse, comprendre un comportement, stratégie de rééquilibrage).
4. Termine par une question directe et personnalisée sur ce qui les préoccupe en ce moment.

Sois direct, chaleureux, et montre que tu es déjà pleinement dans le contexte.`
      : `Tu viens d'être ouvert pour la première fois dans cette session avec ${relation.participantMe}.
La conversation n'a pas encore été importée ou la mémoire n'est pas encore construite.
Présente-toi chaleureusement, explique ce que tu peux faire (analyser des conversations, décoder des comportements, préparer des réponses), et invite ${relation.participantMe} à importer leur conversation ou à coller des messages directement pour commencer l'analyse.`;

    let fullResponse = "";
    const stream = anthropic.messages.stream({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: "user", content: introPrompt }],
    });

    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        fullResponse += event.delta.text;
        send({ content: event.delta.text });
      }
    }

    // Save only the assistant message — no user message
    await db.insert(agentMessagesTable).values({
      sessionId,
      role: "assistant",
      content: fullResponse,
      contextUsed,
    });

    await db.update(agentSessionsTable).set({
      messageCount: sql`${agentSessionsTable.messageCount} + 1`,
      updatedAt: new Date(),
    }).where(eq(agentSessionsTable.id, sessionId));

    send({ done: true });
    res.end();
  } catch (err) {
    send({ error: "Impossible de générer l'introduction." });
    res.end();
  }
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
    const ctx = await buildContext(relationId);
    if (!ctx) { send({ error: "Relation introuvable" }); res.end(); return; }

    const { relation, mem, msgCount, recentMessages } = ctx;
    const totalMessages = Number(msgCount?.total ?? 0);

    // Selected messages context
    let selectedContext = "";
    if (selectedMessageIds?.length) {
      const selected = recentMessages.filter((m: { id: number }) => selectedMessageIds.includes(m.id));
      if (selected.length) {
        selectedContext = `\n\nMESSAGES SÉLECTIONNÉS PAR L'UTILISATEUR:\n${selected.map((m: { sentAt: Date; isMe: boolean; content: string }) =>
          `[${m.sentAt.toISOString().split("T")[0]}] ${m.isMe ? relation.participantMe : relation.participantOther}: ${m.content}`
        ).join("\n")}`;
      }
    }

    const { systemPrompt, contextUsed } = buildSystemPrompt(
      relation, mem, totalMessages, recentMessages,
      { selectedContext, pastedConversation }
    );

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
