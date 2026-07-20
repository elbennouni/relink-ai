/**
 * POST /api/relations/:id/messages/add
 * Manually add a message (text or image) to the conversation.
 * Body: { content?: string, mediaData?: string (base64 data URL) }
 */
import { Router } from "express";
import { db, whatsappMessagesTable } from "@workspace/db";
import crypto from "crypto";

const router = Router();

router.post("/relations/:id/messages/add", async (req, res) => {
  const relationId = Number(req.params.id);
  if (isNaN(relationId)) { res.status(400).json({ error: "invalid id" }); return; }

  const { content, mediaData } = req.body as { content?: string; mediaData?: string };
  if (!content && !mediaData) {
    res.status(400).json({ error: "content ou mediaData requis" });
    return;
  }

  const finalContent = content?.trim() ||
    (mediaData?.startsWith("data:image") ? "[Image]" : "[Fichier]");

  const hash = crypto
    .createHash("md5")
    .update(`manual:${Date.now()}:${Math.random()}`)
    .digest("hex");

  try {
    const [inserted] = await db
      .insert(whatsappMessagesTable)
      .values({
        relationId,
        sender: "Moi",
        content: finalContent,
        isMe: true,
        sentAt: new Date(),
        importSource: "manual",
        contentHash: hash,
        ...(mediaData ? { mediaData } : {}),
      })
      .returning();

    res.json({ success: true, message: inserted });
  } catch (err) {
    console.error("[AddMessage] Error:", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

export default router;
