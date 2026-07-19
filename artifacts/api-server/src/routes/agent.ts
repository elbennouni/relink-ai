import { Router } from "express";
import { db } from "@workspace/db";
import {
  agentSessionsTable,
  agentMessagesTable,
  relationalMemoryTable,
  whatsappMessagesTable,
  relationsTable,
} from "@workspace/db";
import { eq, desc, sql, and, like, or, ne } from "drizzle-orm";
import { anthropic } from "@workspace/integrations-anthropic-ai";

const router = Router();

// ─── Shared helpers ───────────────────────────────────────────────────────────

// Mots vides français à ignorer pour la recherche
const FR_STOP = new Set([
  "dans","pour","avec","cette","comment","quels","quand","parce","mais","plus",
  "tout","bien","faire","avoir","être","elle","lui","nous","vous","ils","elles",
  "aussi","très","alors","donc","comme","encore","même","déjà","cela","celui",
  "dont","leur","quel","quelle","quoi","rien","toujours","jamais","souvent",
  "depuis","avant","après","entre","sous","vers","sans","selon","lors","jusqu",
  "plus","moins","trop","assez","peu","beaucoup","lors","plusieurs","certains",
]);

/**
 * Cherche dans les 48 000 messages les extraits les plus pertinents
 * en fonction des mots-clés extraits de la question de l'utilisateur.
 * Retourne jusqu'à `limit` messages triés chronologiquement.
 */
async function searchRelevantMessages(
  relationId: number,
  query: string,
  limit = 50,
  excludeIds: Set<number> = new Set()
): Promise<Array<{ id: number; sentAt: Date; isMe: boolean; content: string; sender: string }>> {
  const words = query
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // strip accents for search
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter(w => w.length > 3 && !FR_STOP.has(w));

  if (!words.length) return [];

  // Build OR conditions for each keyword (max 6 keywords)
  const keywords = [...new Set(words)].slice(0, 6);
  const conditions = keywords.map(w =>
    like(whatsappMessagesTable.content, `%${w}%`)
  );

  const rows = await db
    .select()
    .from(whatsappMessagesTable)
    .where(and(
      eq(whatsappMessagesTable.relationId, relationId),
      or(...conditions)
    ))
    .orderBy(desc(whatsappMessagesTable.sentAt))
    .limit(limit * 3); // over-fetch then deduplicate

  // Deduplicate with recentMessages, then sort chronologically, cap at limit
  const unique = rows
    .filter(m => !excludeIds.has(m.id))
    .slice(0, limit)
    .sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime());

  return unique.map(m => ({
    id: m.id,
    sentAt: m.sentAt,
    isMe: m.isMe,
    content: m.content,
    sender: m.sender,
  }));
}

type Relation = { participantMe: string; participantOther: string };
type Memory = {
  globalSummary?: string | null;
  currentPhase?: string | null;
  recurringTopics?: unknown;
  expressedLimits?: unknown;
  openQuestions?: unknown;
  importantEvents?: unknown;
  communicationTrends?: unknown;
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
    .limit(150);

  recentMessages.reverse();

  return { relation, mem: mem as Memory | undefined, msgCount, recentMessages };
}

function buildSystemPrompt(
  relation: Relation,
  mem: Memory | undefined,
  totalMessages: number,
  recentMessages: Array<{ sentAt: Date; isMe: boolean; content: string }>,
  options: {
    selectedContext?: string;
    pastedConversation?: string;
    relevantMessages?: Array<{ sentAt: Date; isMe: boolean; content: string }>;
  } = {}
): { systemPrompt: string; contextUsed: string[] } {
  const contextUsed: string[] = [];
  const me = relation.participantMe;
  const other = relation.participantOther;

  const hasMem = !!(mem?.globalSummary || mem?.dynamicReport);

  let systemPrompt = `Tu es ReLink AI, un copilote stratégique expert en dynamiques relationnelles et rapports de force.

TU PARLES DIRECTEMENT AVEC : ${me}
C'est ${me} qui t'écrit. Quand tu dis "tu", tu t'adresses à ${me}. L'autre personne est ${other}.

TA MISSION : aider ${me} à comprendre et rééquilibrer le rapport de force avec ${other}.

RÈGLES ABSOLUES :
- Tu as analysé l'INTÉGRALITÉ de la conversation (${totalMessages} messages). Tu connais cette relation par cœur — les faits, les patterns, l'histoire, les basculements. Parle TOUJOURS avec cette certitude. Ne dis jamais "je n'ai pas accès à tes messages" ou "je ne peux pas voir" — tu as fait l'analyse complète.
- Si tu n'as pas le détail verbatim d'un message précis, tu te bases sur ta connaissance des patterns généraux que tu as analysés.
- Tu analyses avec lucidité et sans complaisance. Tu dis la vérité même inconfortable.
- Conseils CONCRETS et ACTIONNABLES uniquement. Si on te montre un message, tu proposes une réponse précise avec l'intention stratégique.
- Tu réponds en français, avec empathie mais surtout avec clarté stratégique.
- Quand tu cites un message, précise qui l'a écrit : "${me}" ou "${other}".`;

  // ── Mémoire complète ─────────────────────────────────────────────────────
  if (hasMem) {
    systemPrompt += `\n\n${"━".repeat(50)}\nMÉMOIRE RELATIONNELLE — ANALYSE COMPLÈTE DES ${totalMessages} MESSAGES\n${"━".repeat(50)}`;
    contextUsed.push("mémoire relationnelle");
  }

  if (mem?.globalSummary) {
    systemPrompt += `\n\n▸ RÉSUMÉ DE LA RELATION :\n${mem.globalSummary}`;
  }

  if (mem?.currentPhase) {
    systemPrompt += `\n\n▸ PHASE ACTUELLE :\n${mem.currentPhase}`;
  }

  const report = mem?.dynamicReport as Record<string, unknown> | undefined;

  // Communication dynamics from dynamicReport
  if (report) {
    const dynParts: string[] = [];
    if (report.whoInitiates)   dynParts.push(`Qui initie : ${report.whoInitiates}`);
    if (report.whoFollowsUp)   dynParts.push(`Qui relance : ${report.whoFollowsUp}`);
    if (report.avgResponseTime) dynParts.push(`Temps de réponse : ${report.avgResponseTime}`);
    if (report.messageFrequency) dynParts.push(`Fréquence : ${report.messageFrequency}`);
    if (report.recentChanges)  dynParts.push(`Évolution récente : ${report.recentChanges}`);
    if (dynParts.length) {
      systemPrompt += `\n\n▸ DYNAMIQUE DE COMMUNICATION :\n${dynParts.map(p => `• ${p}`).join("\n")}`;
    }

    if (Array.isArray(report.observableFacts) && report.observableFacts.length) {
      systemPrompt += `\n\n▸ FAITS OBSERVABLES :\n${(report.observableFacts as string[]).map(f => `• ${f}`).join("\n")}`;
    }

    if (Array.isArray(report.trends) && report.trends.length) {
      systemPrompt += `\n\n▸ TENDANCES OBSERVÉES :\n${(report.trends as string[]).map(t => `• ${t}`).join("\n")}`;
    }

    if (Array.isArray(report.recurringConflicts) && report.recurringConflicts.length) {
      systemPrompt += `\n\n▸ CONFLITS RÉCURRENTS :\n${(report.recurringConflicts as string[]).map(c => `• ${c}`).join("\n")}`;
    }
  }

  if (mem?.recurringTopics && Array.isArray(mem.recurringTopics) && mem.recurringTopics.length) {
    systemPrompt += `\n\n▸ SUJETS RÉCURRENTS :\n${(mem.recurringTopics as string[]).map(t => `• ${t}`).join("\n")}`;
  }

  if (mem?.importantEvents && Array.isArray(mem.importantEvents) && mem.importantEvents.length) {
    systemPrompt += `\n\n▸ ÉVÉNEMENTS CLÉS :\n${(mem.importantEvents as string[]).map(e => `• ${e}`).join("\n")}`;
  }

  if (mem?.expressedLimits && Array.isArray(mem.expressedLimits) && mem.expressedLimits.length) {
    systemPrompt += `\n\n▸ LIMITES EXPRIMÉES :\n${(mem.expressedLimits as string[]).map(l => `• ${l}`).join("\n")}`;
  }

  if (mem?.openQuestions && Array.isArray(mem.openQuestions) && mem.openQuestions.length) {
    systemPrompt += `\n\n▸ QUESTIONS SANS RÉPONSE :\n${(mem.openQuestions as string[]).map(q => `• ${q}`).join("\n")}`;
  }

  // Power dynamics
  const pd = report?.powerDynamics as Record<string, unknown> | undefined;

  if (pd) {
    systemPrompt += `\n\n${"━".repeat(50)}\nDYNAMIQUE DE POUVOIR\n${"━".repeat(50)}`;
    contextUsed.push("dynamique de pouvoir");

    if (pd.currentDynamicSummary) {
      systemPrompt += `\n\n▸ SITUATION ACTUELLE :\n${pd.currentDynamicSummary}`;
    }

    if (typeof pd.imbalanceScore === "number") {
      const score = pd.imbalanceScore as number;
      const label =
        score < -5 ? `Fort déséquilibre — ${other} domine` :
        score < -2 ? `Déséquilibre modéré en faveur de ${other}` :
        score < 2  ? "Relation relativement équilibrée" :
        score < 5  ? `Légère dominance de ${me}` :
                     `Fort avantage pour ${me}`;
      systemPrompt += `\n▸ Score de déséquilibre : ${score}/10 (${label})`;
    }

    if (Array.isArray(pd.dominancePatterns) && pd.dominancePatterns.length) {
      systemPrompt += `\n\n▸ PATTERNS DE DOMINATION DE ${other} :\n${(pd.dominancePatterns as string[]).map(p => `• ${p}`).join("\n")}`;
    }

    if (Array.isArray(pd.submissivePatterns) && pd.submissivePatterns.length) {
      systemPrompt += `\n\n▸ COMPORTEMENTS SOUMIS DE ${me} (à corriger) :\n${(pd.submissivePatterns as string[]).map(p => `• ${p}`).join("\n")}`;
    }

    if (Array.isArray(pd.tensionPoints) && pd.tensionPoints.length) {
      const tensions = pd.tensionPoints as Array<Record<string, string>>;
      systemPrompt += `\n\n▸ TENSIONS RÉCURRENTES :\n${tensions.map(t =>
        `• Déclencheur : ${t.trigger} → ${t.pattern} (monte : ${t.whoEscalates}, calme : ${t.whoDeescalates})`
      ).join("\n")}`;
    }

    if (Array.isArray(pd.powerShifts) && pd.powerShifts.length) {
      systemPrompt += `\n\n▸ BASCULEMENTS DE POUVOIR :\n${(pd.powerShifts as string[]).map(p => `• ${p}`).join("\n")}`;
    }

    const rs = pd.reversalStrategy as Record<string, unknown> | undefined;
    if (rs) {
      systemPrompt += `\n\n${"━".repeat(50)}\nSTRATÉGIE DE RÉÉQUILIBRAGE\n${"━".repeat(50)}`;
      if (rs.mainPrinciple) systemPrompt += `\n▸ Principe clé : ${rs.mainPrinciple}`;
      if (Array.isArray(rs.behaviorsToStop) && rs.behaviorsToStop.length) {
        systemPrompt += `\n▸ À ARRÊTER IMMÉDIATEMENT :\n${(rs.behaviorsToStop as string[]).map(b => `• ${b}`).join("\n")}`;
      }
      if (Array.isArray(rs.behaviorsToAdopt) && rs.behaviorsToAdopt.length) {
        systemPrompt += `\n▸ À ADOPTER :\n${(rs.behaviorsToAdopt as string[]).map(b => `• ${b}`).join("\n")}`;
      }
      if (Array.isArray(rs.messagingPrinciples) && rs.messagingPrinciples.length) {
        systemPrompt += `\n▸ PRINCIPES DE MESSAGING :\n${(rs.messagingPrinciples as string[]).map(b => `• ${b}`).join("\n")}`;
      }
    }

    systemPrompt += `\n\nApplique TOUJOURS cette analyse dans tes réponses. Ne dis jamais que tu n'as pas les informations — tu as fait l'analyse complète.`;
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

  if (options.relevantMessages && options.relevantMessages.length > 0) {
    const me = relation.participantMe;
    const other = relation.participantOther;
    const transcript = options.relevantMessages
      .map(m => `[${m.sentAt.toISOString().split("T")[0]}] ${m.isMe ? me : other}: ${m.content}`)
      .join("\n");
    systemPrompt += `\n\n━━━ MESSAGES PERTINENTS TROUVÉS DANS L'HISTORIQUE COMPLET ━━━\n(Extraits de l'ensemble des ${totalMessages} messages — sélectionnés automatiquement en rapport avec la question)\n${transcript}`;
    contextUsed.push(`recherche historique (${options.relevantMessages.length} msgs)`);
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

  const { message, selectedMessageIds, pastedConversation, images } = req.body;
  if (!message) { res.status(400).json({ error: "Message requis." }); return; }

  // images: Array<{ data: string; mediaType: string }> — base64 encoded
  const imageBlocks: Array<{
    type: "image";
    source: { type: "base64"; media_type: "image/jpeg" | "image/png" | "image/gif" | "image/webp"; data: string };
  }> = Array.isArray(images)
    ? images
        .filter((img: { data?: string; mediaType?: string }) => img?.data && img?.mediaType)
        .map((img: { data: string; mediaType: string }) => ({
          type: "image" as const,
          source: {
            type: "base64" as const,
            media_type: img.mediaType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
            data: img.data,
          },
        }))
    : [];

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

    // Recherche contextuelle dans l'historique complet
    const recentIds = new Set(recentMessages.map((m: { id: number }) => m.id));
    const relevantMessages = message && message.length > 5
      ? await searchRelevantMessages(relationId, message, 50, recentIds)
      : [];

    const { systemPrompt, contextUsed } = buildSystemPrompt(
      relation, mem, totalMessages, recentMessages,
      { selectedContext, pastedConversation, relevantMessages }
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
    const chatHistory: Array<{ role: "user" | "assistant"; content: string | Array<{ type: string; [k: string]: unknown }> }> = prevMessages.map(m => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

    // If images are attached, build a vision content array
    const userContent: string | Array<{ type: string; [k: string]: unknown }> =
      imageBlocks.length > 0
        ? [...imageBlocks, { type: "text", text: message }]
        : message;

    chatHistory.push({ role: "user", content: userContent });

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
