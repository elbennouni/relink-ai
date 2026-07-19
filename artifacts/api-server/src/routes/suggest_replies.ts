import { Router } from "express";
import { db } from "@workspace/db";
import { whatsappMessagesTable, relationsTable } from "@workspace/db";
import { eq, desc, asc } from "drizzle-orm";
import { anthropic } from "@workspace/integrations-anthropic-ai";

const router = Router();

/**
 * POST /api/relations/:id/suggest-replies
 * Body: { intent?: string }  — ce que l'user veut exprimer (optionnel)
 * Retourne 3 suggestions de réponse calquées sur le style de l'utilisateur
 */
router.post("/relations/:id/suggest-replies", async (req, res) => {
  const relationId = Number(req.params.id);
  if (isNaN(relationId)) { res.status(400).json({ error: "invalid id" }); return; }

  const intent: string = req.body?.intent ?? "";

  // ── 1. Relation info ──────────────────────────────────────────────────────
  const [relation] = await db
    .select()
    .from(relationsTable)
    .where(eq(relationsTable.id, relationId))
    .limit(1);
  if (!relation) { res.status(404).json({ error: "relation not found" }); return; }

  // ── 2. Derniers messages pour le contexte (30 derniers) ───────────────────
  const recent = await db
    .select({ sender: whatsappMessagesTable.sender, content: whatsappMessagesTable.content, isMe: whatsappMessagesTable.isMe, sentAt: whatsappMessagesTable.sentAt })
    .from(whatsappMessagesTable)
    .where(eq(whatsappMessagesTable.relationId, relationId))
    .orderBy(desc(whatsappMessagesTable.sentAt))
    .limit(30);
  recent.reverse();

  // ── 3. Échantillon de messages "isMe" pour analyser le style ─────────────
  const myMessages = await db
    .select({ content: whatsappMessagesTable.content })
    .from(whatsappMessagesTable)
    .where(eq(whatsappMessagesTable.relationId, relationId))
    .orderBy(desc(whatsappMessagesTable.sentAt))
    .limit(300);

  const myMsgs = myMessages
    .filter((m) => {
      // on ne sait pas qui est "isMe" dans cet échantillon, on prend tout
      return true;
    })
    .map((m) => m.content)
    .filter((c) => c && !c.startsWith("[") && c.length < 200)
    .slice(0, 60)
    .join("\n");

  // Récupère seulement les messages isMe
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

  const lastSender = recent[recent.length - 1]?.isMe ? "Moi" : relation.participantOther;
  const contact = relation.participantOther;

  // ── 4. Prompt Claude ──────────────────────────────────────────────────────
  const prompt = `Tu es un assistant de communication qui aide à rédiger des réponses naturelles.

CONTEXTE DE LA CONVERSATION (messages récents) :
${contextStr || "(aucun message récent)"}

EXEMPLES DE MON STYLE D'ÉCRITURE (mes vrais messages passés) :
${myStyle || "(pas d'exemples disponibles)"}

${intent ? `CE QUE JE VEUX DIRE : ${intent}` : `Dernier message reçu de ${contact}. Génère des réponses adaptées.`}

MISSION : Génère exactement 3 réponses que JE pourrais envoyer à ${contact}.
- Chaque réponse doit imiter FIDÈLEMENT mon style : longueur habituelle, tournures, niveau de familiarité, ponctuation, emojis si j'en utilise, etc.
- Propose des variations de ton ou d'approche (directe / douce / légère)
- Les réponses doivent être naturelles, pas robotiques
- Ne mets JAMAIS de guillemets autour des réponses

Réponds UNIQUEMENT avec ce JSON valide, sans markdown :
{
  "suggestions": [
    { "text": "...", "label": "Directe" },
    { "text": "...", "label": "Douce" },
    { "text": "...", "label": "Légère" }
  ]
}`;

  const message = await anthropic.messages.create({
    model: "claude-opus-4-5",
    max_tokens: 600,
    messages: [{ role: "user", content: prompt }],
  });

  const raw = (message.content[0] as { type: string; text: string }).text.trim();

  // Parse JSON robustement
  let suggestions: { text: string; label: string }[] = [];
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      suggestions = parsed.suggestions ?? [];
    }
  } catch {
    suggestions = [{ text: raw, label: "Suggestion" }];
  }

  res.json({ suggestions, context: recent.slice(-5).map((m) => ({
    sender: m.isMe ? "Moi" : contact,
    content: m.content,
    isMe: m.isMe,
  })) });
});

export default router;
