/**
 * GET /api/relations/:id/power-balance
 * Analyses power dynamics in the conversation using Claude.
 * Returns a score 0-100 (0 = contact has all power, 100 = user has all power)
 */
import { Router } from "express";
import { db, whatsappMessagesTable, relationsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { anthropic } from "@workspace/integrations-anthropic-ai";

const router = Router();

router.get("/relations/:id/power-balance", async (req, res) => {
  const relationId = Number(req.params.id);
  if (isNaN(relationId)) { res.status(400).json({ error: "invalid id" }); return; }

  const [relation] = await db
    .select()
    .from(relationsTable)
    .where(eq(relationsTable.id, relationId))
    .limit(1);
  if (!relation) { res.status(404).json({ error: "not found" }); return; }

  const rows = await db
    .select({
      content: whatsappMessagesTable.content,
      isMe: whatsappMessagesTable.isMe,
      sentAt: whatsappMessagesTable.sentAt,
    })
    .from(whatsappMessagesTable)
    .where(eq(whatsappMessagesTable.relationId, relationId))
    .orderBy(desc(whatsappMessagesTable.sentAt))
    .limit(120);

  rows.reverse();

  if (rows.length < 5) {
    res.json({
      score: 50,
      label: "Pas assez de données",
      trend: "stable",
      detail: "Importez plus de messages pour analyser le rapport de force.",
    });
    return;
  }

  // Compute basic stats before sending to Claude
  const myCount = rows.filter(m => m.isMe).length;
  const theirCount = rows.length - myCount;
  const contextStr = rows.slice(-80).map(m =>
    `${m.isMe ? "Moi" : relation.participantOther}: ${m.content}`
  ).join("\n");

  const prompt = `Tu es un expert en psychologie relationnelle et dynamiques de pouvoir.
Analyse le rapport de force dans cette conversation entre moi (l'utilisateur) et ${relation.participantOther}.

STATISTIQUES BRUTES :
- Mes messages : ${myCount} | Messages de ${relation.participantOther} : ${theirCount}
- Ratio messages moi/eux : ${(myCount / Math.max(theirCount, 1)).toFixed(2)}

CONVERSATION RÉCENTE (du plus ancien au plus récent) :
${contextStr}

Analyse ces facteurs pour déterminer le rapport de force :
1. Qui initie les conversations le plus souvent ?
2. Qui pose le plus de questions (cherche à maintenir le contact) ?
3. Qui répond en dernier et laisse l'autre attendre ?
4. Qui fait preuve de plus de détachement émotionnel ?
5. Qui exprime le plus de besoins/demandes ?
6. Le ratio de messages (envoyer beaucoup = souvent signe de moins de pouvoir)

Donne un score de rapport de force de 0 à 100 où :
- 0-30 = ${relation.participantOther} a clairement la main
- 30-45 = ${relation.participantOther} a légèrement l'avantage
- 45-55 = rapport équilibré
- 55-70 = j'ai légèrement l'avantage
- 70-100 = j'ai clairement la main

Réponds UNIQUEMENT avec ce JSON valide, sans markdown ni explication :
{
  "score": <entier 0-100>,
  "label": <string court ex: "${relation.participantOther} a la main" | "Équilibré" | "Tu as la main">,
  "trend": <"up" | "down" | "stable">,
  "detail": <une phrase courte et directe expliquant pourquoi>
}`;

  try {
    const message = await anthropic.messages.create({
      model: "claude-opus-4-5",
      max_tokens: 250,
      messages: [{ role: "user", content: prompt }],
    });

    const raw = (message.content[0] as { type: string; text: string }).text.trim();
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("no json");
    const parsed = JSON.parse(jsonMatch[0]);

    // Clamp score to valid range
    parsed.score = Math.max(0, Math.min(100, Number(parsed.score) || 50));
    res.json(parsed);
  } catch {
    // Fallback: compute basic score from message ratio
    const ratio = myCount / Math.max(rows.length, 1);
    const score = Math.round((1 - ratio) * 100); // more messages from me = less power
    res.json({
      score: Math.max(20, Math.min(80, score)),
      label: score < 45 ? `${relation.participantOther} a la main` : score > 55 ? "Tu as la main" : "Équilibré",
      trend: "stable",
      detail: "Analyse basée sur le ratio de messages.",
    });
  }
});

export default router;
