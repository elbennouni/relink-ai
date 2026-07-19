import { Router } from "express";
import { db } from "@workspace/db";
import { whatsappMessagesTable, relationsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { anthropic } from "@workspace/integrations-anthropic-ai";

const router = Router();

/**
 * POST /relations/:id/analyze-incoming
 * Body: { messageId: number }  — ID du dernier message reçu (non isMe)
 * Retourne une analyse stratégique avec options de réponses scorées
 */
router.post("/relations/:id/analyze-incoming", async (req, res) => {
  const relationId = Number(req.params.id);
  if (isNaN(relationId)) { res.status(400).json({ error: "invalid id" }); return; }

  const { messageId } = req.body ?? {};

  // ── Relation ──────────────────────────────────────────────────────────────
  const [relation] = await db
    .select()
    .from(relationsTable)
    .where(eq(relationsTable.id, relationId))
    .limit(1);
  if (!relation) { res.status(404).json({ error: "relation not found" }); return; }

  const contact = relation.participantOther;

  // ── Message déclencheur ───────────────────────────────────────────────────
  let triggerMessage: { content: string; sentAt: string } | null = null;
  if (messageId) {
    const rows = await db
      .select({ content: whatsappMessagesTable.content, sentAt: whatsappMessagesTable.sentAt })
      .from(whatsappMessagesTable)
      .where(eq(whatsappMessagesTable.id, Number(messageId)))
      .limit(1);
    triggerMessage = rows[0] ?? null;
  }

  // ── Contexte (30 derniers messages) ──────────────────────────────────────
  const recent = await db
    .select({
      content: whatsappMessagesTable.content,
      isMe: whatsappMessagesTable.isMe,
      sentAt: whatsappMessagesTable.sentAt,
    })
    .from(whatsappMessagesTable)
    .where(eq(whatsappMessagesTable.relationId, relationId))
    .orderBy(desc(whatsappMessagesTable.sentAt))
    .limit(30);
  recent.reverse();

  // ── Mes messages pour analyser le rapport de force actuel ─────────────────
  const myLast = await db
    .select({ content: whatsappMessagesTable.content })
    .from(whatsappMessagesTable)
    .where(eq(whatsappMessagesTable.relationId, relationId))
    .orderBy(desc(whatsappMessagesTable.sentAt))
    .limit(100);

  const myStyle = myLast
    .filter((m) => m.content && !m.content.startsWith("[") && m.content.length < 200)
    .slice(0, 40)
    .map((m) => m.content)
    .join("\n");

  const contextStr = recent
    .map((m) => `${m.isMe ? "Moi" : contact}: ${m.content}`)
    .join("\n");

  const lastMsg = triggerMessage?.content
    ?? recent.filter((m) => !m.isMe).slice(-1)[0]?.content
    ?? "(message inconnu)";

  // ── Prompt Claude ─────────────────────────────────────────────────────────
  const prompt = `Tu es un expert en psychologie des relations et en communication stratégique. Tu analyses les dynamiques de pouvoir dans les relations amoureuses/complexes.

CONVERSATION RÉCENTE :
${contextStr}

MESSAGE ENTRANT À ANALYSER :
"${lastMsg}"

MES MESSAGES HABITUELS (pour calibrer mon style) :
${myStyle || "(pas disponible)"}

MISSION : Analyser ce message et proposer des stratégies de réponse avec un SCORE DE POUVOIR.

Le score de pouvoir va de -10 à +10 :
- +8 à +10 = Dignité totale, tu reprends le contrôle, position haute
- +4 à +7 = Position confortable, tu gardes ton pouvoir
- 0 à +3 = Neutre, ni gain ni perte
- -1 à -5 = Tu cèdes du terrain, tu montres le besoin
- -6 à -10 = Tu perds le contrôle, tu lui redonnes tout le pouvoir

ANALYSE le message selon :
1. Quelle est la TACTIQUE utilisée par ${contact} ? (pique, manipulation, test, indifférence, provocation, affection calculée, etc.)
2. Quel CADRE appliquer ? (dignité amoureuse / détachement / silence stratégique / humour souverain / miroir froid)
3. Propose EXACTEMENT 4 options incluant le silence

Réponds UNIQUEMENT avec ce JSON valide, sans markdown :
{
  "tactic": "...",
  "tactique_label": "...",
  "framework": "...",
  "insight": "...",
  "power_baseline": 5,
  "options": [
    {
      "label": "Silence stratégique",
      "text": null,
      "score": 9,
      "score_delta": "+9",
      "reason": "...",
      "type": "silence"
    },
    {
      "label": "Détachement souverain",
      "text": "...",
      "score": 7,
      "score_delta": "+7",
      "reason": "...",
      "type": "dominant"
    },
    {
      "label": "Miroir froid",
      "text": "...",
      "score": 4,
      "score_delta": "+4",
      "reason": "...",
      "type": "neutral"
    },
    {
      "label": "Réponse émotionnelle",
      "text": "...",
      "score": -3,
      "score_delta": "-3",
      "reason": "...",
      "type": "weak"
    }
  ]
}`;

  const message = await anthropic.messages.create({
    model: "claude-opus-4-5",
    max_tokens: 900,
    messages: [{ role: "user", content: prompt }],
  });

  const raw = (message.content[0] as { type: string; text: string }).text.trim();

  let result: object = {};
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) result = JSON.parse(jsonMatch[0]);
  } catch {
    result = { error: "parse_error", raw };
  }

  res.json({ ...result, triggerMessage: lastMsg, contact });
});

export default router;
