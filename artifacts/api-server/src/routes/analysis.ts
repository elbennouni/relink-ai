import { Router } from "express";
import { db } from "@workspace/db";
import {
  relationsTable,
  whatsappMessagesTable,
  relationalMemoryTable,
} from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { randomUUID } from "crypto";

const router = Router();

// POST /api/relations/:relationId/analysis/message  (SSE)
router.post("/relations/:relationId/analysis/message", async (req, res) => {
  const relationId = Number(req.params.relationId);
  if (isNaN(relationId)) { res.status(400).json({ error: "ID invalide" }); return; }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const send = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    const { messageContent, messageId, additionalContext } = req.body;

    const [relation] = await db.select().from(relationsTable).where(eq(relationsTable.id, relationId)).limit(1);
    if (!relation) { send({ error: "Relation introuvable" }); res.end(); return; }

    let targetContent = messageContent;
    if (messageId && !targetContent) {
      const [msg] = await db.select().from(whatsappMessagesTable).where(eq(whatsappMessagesTable.id, messageId)).limit(1);
      if (msg) targetContent = msg.content;
    }

    if (!targetContent) { send({ error: "Message requis." }); res.end(); return; }

    const [mem] = await db.select().from(relationalMemoryTable).where(eq(relationalMemoryTable.relationId, relationId)).limit(1);

    const recentMessages = await db.select().from(whatsappMessagesTable)
      .where(eq(whatsappMessagesTable.relationId, relationId))
      .orderBy(desc(whatsappMessagesTable.sentAt))
      .limit(15);
    recentMessages.reverse();

    const transcript = recentMessages
      .map(m => `${m.isMe ? relation.participantMe : relation.participantOther}: ${m.content}`)
      .join("\n");

    const systemPrompt = `Tu es ReLink AI. Analyse ce message avec lucidité et bienveillance.
Distingue toujours: faits observables | tendances | hypothèses | inconnues.
Ne présente jamais une interprétation comme un fait.
Réponds en français.

CONTEXTE:
${relation.participantMe} et ${relation.participantOther}
${mem?.globalSummary ? `Mémoire: ${mem.globalSummary}` : ""}
${mem?.currentPhase ? `Phase: ${mem.currentPhase}` : ""}

ÉCHANGES RÉCENTS:
${transcript}
${additionalContext ? `\nCONTEXTE SUPPLÉMENTAIRE: ${additionalContext}` : ""}`;

    const stream = anthropic.messages.stream({
      model: "claude-sonnet-4-6",
      max_tokens: 8192,
      system: systemPrompt,
      messages: [{
        role: "user",
        content: `Analyse ce message de ${relation.participantOther}: "${targetContent}"

Structure ta réponse avec ces sections:
## Ce que le message dit clairement
## Ce que le contexte récent montre
## Interprétations possibles
## Ce qu'on ne peut pas savoir
## Risques d'une réponse impulsive
## Options possibles`,
      }],
    });

    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        send({ content: event.delta.text });
      }
    }

    send({ done: true });
    res.end();
  } catch (err) {
    send({ error: "L'analyse est temporairement indisponible." });
    res.end();
  }
});

// POST /api/relations/:relationId/analysis/suggestions
router.post("/relations/:relationId/analysis/suggestions", async (req, res) => {
  const relationId = Number(req.params.relationId);
  if (isNaN(relationId)) { res.status(400).json({ error: "ID invalide" }); return; }

  const { messageContent, messageId, context } = req.body;

  const [relation] = await db.select().from(relationsTable).where(eq(relationsTable.id, relationId)).limit(1);
  if (!relation) { res.status(404).json({ error: "Relation introuvable" }); return; }

  let targetContent = messageContent;
  if (messageId && !targetContent) {
    const [msg] = await db.select().from(whatsappMessagesTable).where(eq(whatsappMessagesTable.id, messageId)).limit(1);
    if (msg) targetContent = msg.content;
  }

  if (!targetContent) { res.status(400).json({ error: "Message requis." }); return; }

  const [mem] = await db.select().from(relationalMemoryTable).where(eq(relationalMemoryTable.relationId, relationId)).limit(1);

  const recentMessages = await db.select().from(whatsappMessagesTable)
    .where(eq(whatsappMessagesTable.relationId, relationId))
    .orderBy(desc(whatsappMessagesTable.sentAt))
    .limit(10);
  recentMessages.reverse();

  const transcript = recentMessages.map(m =>
    `${m.isMe ? relation.participantMe : relation.participantOther}: ${m.content}`
  ).join("\n");

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 8192,
    system: `Tu es ReLink AI. Propose 3 réponses à ce message, en tenant compte du contexte relationnel.
Ne jamais envoyer automatiquement. L'utilisateur doit relire avant d'envoyer.
Réponds en français. Retourne uniquement du JSON valide.`,
    messages: [{
      role: "user",
      content: `Message de ${relation.participantOther}: "${targetContent}"

Contexte récent:
${transcript}

${mem?.globalSummary ? `Mémoire: ${mem.globalSummary}` : ""}
${context ? `Contexte supplémentaire: ${context}` : ""}

Propose exactement 3 réponses avec ces styles: natural (courte et naturelle), calm (calme et ouverte), firm (ferme avec une limite claire).

Retourne ce JSON:
{
  "suggestions": [
    {
      "text": "le texte de la réponse",
      "style": "natural",
      "intention": "l'intention derrière cette réponse",
      "tone": "le ton de la réponse",
      "explanation": "explication courte de pourquoi cette réponse"
    }
  ],
  "analysis": "analyse courte de la situation en 1-2 phrases"
}`,
    }],
  });

  const block = response.content[0];
  const text = block.type === "text" ? block.text : "{}";

  let parsed: { suggestions?: unknown[]; analysis?: string } = {};
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
  } catch { /* empty */ }

  const suggestions = (Array.isArray(parsed.suggestions) ? parsed.suggestions : []).map((s: unknown) => {
    const sugg = s as Record<string, string>;
    return {
      id: randomUUID(),
      text: sugg.text || "",
      style: (["natural", "calm", "firm"].includes(sugg.style) ? sugg.style : "natural") as "natural" | "calm" | "firm",
      intention: sugg.intention || "",
      tone: sugg.tone || "",
      explanation: sugg.explanation || "",
    };
  });

  res.json({ suggestions, analysis: parsed.analysis ?? null });
});

// POST /api/relations/:relationId/analysis/suggestions/transform
router.post("/relations/:relationId/analysis/suggestions/transform", async (req, res) => {
  const relationId = Number(req.params.relationId);
  if (isNaN(relationId)) { res.status(400).json({ error: "ID invalide" }); return; }

  const { originalText, transformation } = req.body;
  if (!originalText || !transformation) { res.status(400).json({ error: "Données manquantes." }); return; }

  const transformationMap: Record<string, string> = {
    shorter: "Raccourcis ce message en gardant l'essentiel",
    more_natural: "Rends ce message plus naturel et spontané",
    softer: "Adoucis le ton de ce message",
    firmer: "Rends ce message plus ferme et direct, avec une limite claire",
    no_blame: "Reformule sans reproches ni accusations",
    single_question: "Transforme en une seule question ouverte",
    detached: "Rends ce message plus détaché émotionnellement",
    dignified: "Rends ce message plus digne et posé",
  };

  const instruction = transformationMap[transformation] || "Améliore ce message";

  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 1024,
    messages: [{
      role: "user",
      content: `${instruction}. Retourne uniquement le texte transformé, sans explication.

Message original: "${originalText}"`,
    }],
  });

  const block = response.content[0];
  const transformed = block.type === "text" ? block.text.trim() : originalText;

  res.json({
    id: randomUUID(),
    text: transformed,
    style: "natural" as const,
    intention: `Transformation: ${transformation}`,
    tone: transformation,
    explanation: `Message transformé avec: ${instruction}`,
  });
});

export default router;
