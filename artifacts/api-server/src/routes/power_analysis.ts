import { Router } from "express";
import { db } from "@workspace/db";
import { relationsTable, whatsappMessagesTable, powerAnalysesTable } from "@workspace/db";
import { eq, desc, asc, count } from "drizzle-orm";
import { anthropic } from "@workspace/integrations-anthropic-ai";

const router = Router();

// ── Statistical helpers ───────────────────────────────────────────────────────

interface ConvStats {
  meCount: number;
  otherCount: number;
  meChars: number;
  otherChars: number;
  meInitiates: number;      // # of conversation threads started by me
  otherInitiates: number;
  meAvgResponseMs: number;  // average response time in ms (0 = no data)
  otherAvgResponseMs: number;
  meDoubleTexts: number;    // consecutive messages sent before reply
  otherDoubleTexts: number;
  meQuestions: number;      // messages ending with "?"
  otherQuestions: number;
  totalMessages: number;
  dateFrom: string | null;
  dateTo: string | null;
}

function computeStats(
  messages: { isMe: boolean; content: string; sentAt: Date }[],
): ConvStats {
  if (messages.length === 0) {
    return {
      meCount: 0, otherCount: 0, meChars: 0, otherChars: 0,
      meInitiates: 0, otherInitiates: 0,
      meAvgResponseMs: 0, otherAvgResponseMs: 0,
      meDoubleTexts: 0, otherDoubleTexts: 0,
      meQuestions: 0, otherQuestions: 0,
      totalMessages: 0, dateFrom: null, dateTo: null,
    };
  }

  const sorted = [...messages].sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime());

  let meCount = 0, otherCount = 0, meChars = 0, otherChars = 0;
  let meInitiates = 0, otherInitiates = 0;
  let meRespTimes: number[] = [], otherRespTimes: number[] = [];
  let meDoubleTexts = 0, otherDoubleTexts = 0;
  let meQuestions = 0, otherQuestions = 0;

  const SESSION_GAP_MS = 4 * 60 * 60 * 1000; // 4h gap = new conversation

  for (let i = 0; i < sorted.length; i++) {
    const msg = sorted[i];
    const isMe = msg.isMe;

    if (isMe) { meCount++; meChars += msg.content.length; }
    else { otherCount++; otherChars += msg.content.length; }

    if (msg.content.includes("?")) {
      if (isMe) meQuestions++; else otherQuestions++;
    }

    // Initiates: first message after a 4h+ gap
    if (i === 0) {
      if (isMe) meInitiates++; else otherInitiates++;
    } else {
      const gap = msg.sentAt.getTime() - sorted[i - 1].sentAt.getTime();
      if (gap > SESSION_GAP_MS) {
        if (isMe) meInitiates++; else otherInitiates++;
      }
    }

    // Response time: find next message from the other side
    if (i < sorted.length - 1) {
      const next = sorted[i + 1];
      if (next.isMe !== isMe) {
        const dt = next.sentAt.getTime() - msg.sentAt.getTime();
        if (dt > 0 && dt < 24 * 60 * 60 * 1000) { // ignore >24h gaps
          if (next.isMe) meRespTimes.push(dt);
          else otherRespTimes.push(dt);
        }
      }
    }

    // Double texts: two consecutive messages from the same person
    if (i > 0 && sorted[i - 1].isMe === isMe) {
      if (isMe) meDoubleTexts++; else otherDoubleTexts++;
    }
  }

  const avg = (arr: number[]) => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0;

  return {
    meCount, otherCount, meChars, otherChars,
    meInitiates, otherInitiates,
    meAvgResponseMs: avg(meRespTimes),
    otherAvgResponseMs: avg(otherRespTimes),
    meDoubleTexts, otherDoubleTexts,
    meQuestions, otherQuestions,
    totalMessages: messages.length,
    dateFrom: sorted[0].sentAt.toISOString().split("T")[0],
    dateTo: sorted[sorted.length - 1].sentAt.toISOString().split("T")[0],
  };
}

function formatDuration(ms: number): string {
  if (ms === 0) return "N/A";
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}j`;
}

// ── GET latest analysis ───────────────────────────────────────────────────────

router.get("/relations/:relationId/power-analysis", async (req, res) => {
  const relationId = Number(req.params.relationId);
  if (isNaN(relationId)) { res.status(400).json({ error: "ID invalide" }); return; }

  const [analysis] = await db
    .select()
    .from(powerAnalysesTable)
    .where(eq(powerAnalysesTable.relationId, relationId))
    .orderBy(desc(powerAnalysesTable.createdAt))
    .limit(1);

  const [msgStats] = await db
    .select({ count: count() })
    .from(whatsappMessagesTable)
    .where(eq(whatsappMessagesTable.relationId, relationId));

  res.json({
    analysis: analysis ?? null,
    messageCount: msgStats?.count ?? 0,
  });
});

// ── POST run analysis (SSE) ───────────────────────────────────────────────────

router.post("/relations/:relationId/power-analysis", async (req, res) => {
  const relationId = Number(req.params.relationId);
  if (isNaN(relationId)) { res.status(400).json({ error: "ID invalide" }); return; }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  const send = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    const [relation] = await db
      .select()
      .from(relationsTable)
      .where(eq(relationsTable.id, relationId))
      .limit(1);
    if (!relation) { send({ error: "Relation introuvable" }); res.end(); return; }

    send({ status: "loading", message: "Chargement des messages…" });

    const allMessages = await db
      .select({ isMe: whatsappMessagesTable.isMe, content: whatsappMessagesTable.content, sentAt: whatsappMessagesTable.sentAt })
      .from(whatsappMessagesTable)
      .where(eq(whatsappMessagesTable.relationId, relationId))
      .orderBy(asc(whatsappMessagesTable.sentAt));

    if (allMessages.length < 20) {
      send({ error: "Il faut au moins 20 messages importés pour faire une analyse de rapport de force." });
      res.end();
      return;
    }

    send({ status: "computing", message: "Calcul des statistiques…" });
    const stats = computeStats(allMessages);

    const me = relation.participantMe || "Toi";
    const other = relation.participantOther || "L'autre";

    // Build a compact transcript sample (last 80 messages for context)
    const sample = allMessages.slice(-80);
    const transcript = sample.map(m =>
      `[${m.sentAt.toISOString().slice(0, 16)}] ${m.isMe ? me : other}: ${m.content.slice(0, 200)}`
    ).join("\n");

    const statsText = `
STATISTIQUES CALCULÉES (sur ${stats.totalMessages} messages, du ${stats.dateFrom} au ${stats.dateTo}):

Messages envoyés  — ${me}: ${stats.meCount} (${Math.round(stats.meCount / stats.totalMessages * 100)}%)  |  ${other}: ${stats.otherCount} (${Math.round(stats.otherCount / stats.totalMessages * 100)}%)
Caractères écrits — ${me}: ${stats.meChars}  |  ${other}: ${stats.otherChars}
Conversations initiées — ${me}: ${stats.meInitiates}  |  ${other}: ${stats.otherInitiates}
Temps de réponse moyen — ${me}: ${formatDuration(stats.meAvgResponseMs)}  |  ${other}: ${formatDuration(stats.otherAvgResponseMs)}
Double-textos — ${me}: ${stats.meDoubleTexts}  |  ${other}: ${stats.otherDoubleTexts}
Questions posées — ${me}: ${stats.meQuestions}  |  ${other}: ${stats.otherQuestions}
`.trim();

    send({ status: "analyzing", message: "Analyse IA en cours…", stats });

    const systemPrompt = `Tu es un expert en psychologie relationnelle, dynamiques de pouvoir et théorie de l'attachement. 
Tu analyses les échanges entre deux personnes avec une précision clinique, bienveillante mais sans complaisance.
Tu utilises les données statistiques ET les extraits de conversation pour donner une analyse profonde et actionnable.
Réponds UNIQUEMENT en français. Ne te répète pas. Sois concis et percutant.`;

    const userPrompt = `Analyse le rapport de force dans cette relation entre ${me} (l'utilisateur) et ${other}.

${statsText}

EXTRAIT DE CONVERSATION (derniers échanges):
${transcript}

Produis une analyse complète en suivant EXACTEMENT ce format markdown:

## Rapport de force global
[Une phrase tranchée sur qui a le pouvoir actuellement et pourquoi. Donne un score: ${me} X/10 vs ${other} X/10]

## Ce que les chiffres révèlent
[Analyse des 6 métriques: volume, initiative, temps de réponse, double-textos, questions. Chaque métrique = 1-2 phrases max. Ce que chaque écart dit sur l'investissement émotionnel de chaque personne]

## Dynamiques cachées
[Ce que le contenu des messages révèle au-delà des stats: qui cherche la validation, qui maintient la distance, qui contrôle le rythme, signes de manipulation ou de jeu de pouvoir, patterns d'attachement visibles]

## Le piège dans lequel tu es
[1-3 comportements précis de ${me} qui affaiblissent sa position. Sois direct, sans filtre]

## Reprendre le pouvoir : plan d'action immédiat
[5 actions concrètes et spécifiques pour rééquilibrer le rapport de force MAINTENANT. Pas de généralités. Des comportements précis à adopter ou arrêter]

## Ce qu'il faut surveiller
[2-3 signaux qui indiqueront si le rééquilibrage fonctionne]`;

    let fullText = "";

    const stream = anthropic.messages.stream({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    });

    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        fullText += event.delta.text;
        send({ content: event.delta.text });
      }
    }

    // Compute power scores from stats
    let meScore = 50;
    const total = stats.meCount + stats.otherCount || 1;
    // More messages = less power (over-investing)
    meScore -= Math.round((stats.meCount / total - 0.5) * 20);
    // Faster response = less power
    if (stats.meAvgResponseMs > 0 && stats.otherAvgResponseMs > 0) {
      const respRatio = stats.meAvgResponseMs / (stats.meAvgResponseMs + stats.otherAvgResponseMs);
      meScore += Math.round((respRatio - 0.5) * 20);
    }
    // More initiates = less power
    const initTotal = stats.meInitiates + stats.otherInitiates || 1;
    meScore -= Math.round((stats.meInitiates / initTotal - 0.5) * 15);
    // More double texts = less power
    const dtTotal = stats.meDoubleTexts + stats.otherDoubleTexts || 1;
    meScore -= Math.round((stats.meDoubleTexts / dtTotal - 0.5) * 10);

    meScore = Math.max(5, Math.min(95, meScore));
    const otherScore = 100 - meScore;

    // Save to DB
    await db.insert(powerAnalysesTable).values({
      relationId,
      stats,
      powerScoreMe: meScore,
      powerScoreOther: otherScore,
      analysisText: fullText,
      messageCount: stats.totalMessages,
      dateRangeFrom: stats.dateFrom,
      dateRangeTo: stats.dateTo,
    });

    send({ done: true, powerScoreMe: meScore, powerScoreOther: otherScore, stats });
    res.end();
  } catch (err) {
    console.error("power-analysis error", err);
    send({ error: "L'analyse est temporairement indisponible." });
    res.end();
  }
});

export default router;
