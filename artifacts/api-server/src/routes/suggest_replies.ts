import { Router } from "express";
import { db } from "@workspace/db";
import { whatsappMessagesTable, relationsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { anthropic } from "@workspace/integrations-anthropic-ai";

const router = Router();

/**
 * POST /api/relations/:id/suggest-replies
 * Body: { intent?: string }
 * Returns 3 suggestions with text, label, score (0-100) and scoreLabel
 */
router.post("/relations/:id/suggest-replies", async (req, res) => {
  const relationId = Number(req.params.id);
  if (isNaN(relationId)) { res.status(400).json({ error: "invalid id" }); return; }

  const intent: string = req.body?.intent ?? "";

  const [relation] = await db
    .select()
    .from(relationsTable)
    .where(eq(relationsTable.id, relationId))
    .limit(1);
  if (!relation) { res.status(404).json({ error: "relation not found" }); return; }

  const recent = await db
    .select({
      sender: whatsappMessagesTable.sender,
      content: whatsappMessagesTable.content,
      isMe: whatsappMessagesTable.isMe,
      sentAt: whatsappMessagesTable.sentAt,
    })
    .from(whatsappMessagesTable)
    .where(eq(whatsappMessagesTable.relationId, relationId))
    .orderBy(desc(whatsappMessagesTable.sentAt))
    .limit(30);
  recent.reverse();

  const myOwnMessages = await db
    .select({ content: whatsappMessagesTable.content })
    .from(whatsappMessagesTable)
    .where(eq(whatsappMessagesTable.relationId, relationId))
    .orderBy(desc(whatsappMessagesTable.sentAt))
    .limit(500);

  const myStyle = myOwnMessages
    .filter((m) => m.content && !m.content.startsWith("[") && m.content.length < 300)
    .map((m) => m.content)
    .slice(0, 80)
    .join("\n");

  const contextStr = recent
    .map((m) => `${m.isMe ? "Moi" : relation.participantOther}: ${m.content}`)
    .join("\n");

  const contact = relation.participantOther;

  const prompt = `Tu es un expert en communication relationnelle et psychologie.

CONTEXTE DE LA CONVERSATION (messages récents) :
${contextStr || "(aucun message récent)"}

EXEMPLES DE MON STYLE D'ÉCRITURE (mes vrais messages passés) :
${myStyle || "(pas d'exemples disponibles)"}

${intent ? `CE QUE JE VEUX DIRE : ${intent}` : `Dernier message reçu de ${contact}. Génère des réponses adaptées.`}

MISSION : Génère exactement 3 réponses que JE pourrais envoyer à ${contact}.
- Chaque réponse doit imiter FIDÈLEMENT mon style : longueur habituelle, tournures, niveau de familiarité, ponctuation, emojis si j'en utilise
- Propose des variations de ton ou d'approche (directe / douce / légère)
- Pour chaque réponse, évalue son score d'efficacité STRATÉGIQUE (0-100) selon :
  * Maintient ou augmente-t-elle mon pouvoir dans la relation ? (+)
  * Est-elle trop demandeuse ou vulnérable ? (-)
  * Crée-t-elle de l'intérêt/attraction sans trop en donner ? (+)
  * Est-elle authentique et naturelle ? (+)
- Les réponses doivent être naturelles, pas robotiques
- Ne mets JAMAIS de guillemets autour des réponses

Réponds UNIQUEMENT avec ce JSON valide, sans markdown :
{
  "suggestions": [
    {
      "text": "...",
      "label": "Directe",
      "score": <0-100>,
      "scoreLabel": <"Stratégique" | "Équilibrée" | "Vulnérable" | "Froide" | "Chaleureuse" | "Naturelle">
    },
    {
      "text": "...",
      "label": "Douce",
      "score": <0-100>,
      "scoreLabel": "..."
    },
    {
      "text": "...",
      "label": "Légère",
      "score": <0-100>,
      "scoreLabel": "..."
    }
  ]
}`;

  const message = await anthropic.messages.create({
    model: "claude-opus-4-5",
    max_tokens: 800,
    messages: [{ role: "user", content: prompt }],
  });

  const raw = (message.content[0] as { type: string; text: string }).text.trim();

  let suggestions: { text: string; label: string; score: number; scoreLabel: string }[] = [];
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      suggestions = (parsed.suggestions ?? []).map((s: any) => ({
        text: s.text ?? "",
        label: s.label ?? "Suggestion",
        score: Math.max(0, Math.min(100, Number(s.score) || 50)),
        scoreLabel: s.scoreLabel ?? "Équilibrée",
      }));
    }
  } catch {
    suggestions = [{ text: raw, label: "Suggestion", score: 50, scoreLabel: "Équilibrée" }];
  }

  res.json({
    suggestions,
    context: recent.slice(-5).map((m) => ({
      sender: m.isMe ? "Moi" : contact,
      content: m.content,
      isMe: m.isMe,
    })),
  });
});

export default router;
