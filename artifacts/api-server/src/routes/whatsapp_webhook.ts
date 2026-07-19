import { Router } from "express";
import { db, whatsappAccountsTable, whatsappMessagesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import crypto from "crypto";
import { openai } from "@workspace/integrations-openai-ai-server";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Download a media file from Meta Graph API and return its buffer + mime type */
async function downloadMetaMedia(
  mediaId: string,
  accessToken: string,
): Promise<{ buffer: Buffer; mimeType: string } | null> {
  try {
    const urlRes = await fetch(`https://graph.facebook.com/v20.0/${mediaId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!urlRes.ok) return null;
    const { url, mime_type } = (await urlRes.json()) as { url: string; mime_type: string };

    const mediaRes = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!mediaRes.ok) return null;
    const arrayBuffer = await mediaRes.arrayBuffer();
    return { buffer: Buffer.from(arrayBuffer), mimeType: mime_type };
  } catch {
    return null;
  }
}

/** Transcribe an audio buffer using OpenAI Whisper */
async function transcribeAudio(buffer: Buffer, mimeType: string): Promise<string> {
  try {
    const ext = mimeType.includes("ogg")
      ? "ogg"
      : mimeType.includes("mp4")
        ? "mp4"
        : mimeType.includes("mpeg")
          ? "mp3"
          : "ogg";
    const file = new File([buffer], `audio.${ext}`, { type: mimeType });
    const result = await openai.audio.transcriptions.create({
      model: "gpt-4o-mini-transcribe",
      file,
      response_format: "json",
    });
    return `[Vocal] ${result.text}`;
  } catch {
    return "[Message vocal — transcription échouée]";
  }
}

// ─── PUBLIC router — only Meta webhook endpoints (no Clerk session required) ──
// These endpoints are called by Meta's servers, which cannot present a Clerk
// session cookie. They are secured by Meta's HMAC signature + verify token.
export const webhookPublicRouter = Router();

// GET /api/webhook/whatsapp — Meta hub.challenge verification
webhookPublicRouter.get("/webhook/whatsapp", async (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode !== "subscribe") {
    res.sendStatus(403);
    return;
  }

  const accounts = await db.select().from(whatsappAccountsTable);
  const match = accounts.find((a) => a.verifyToken === token);
  if (!match) {
    res.sendStatus(403);
    return;
  }

  res.status(200).send(String(challenge));
});

// POST /api/webhook/whatsapp — Inbound messages from Meta
webhookPublicRouter.post("/webhook/whatsapp", async (req, res) => {
  // ── Signature verification ──────────────────────────────────────────────────
  // Meta signs every POST with X-Hub-Signature-256 using the Meta App Secret.
  // If META_WEBHOOK_SECRET is set, we enforce verification and reject bad payloads.
  // If not set, we warn and continue (development mode only).
  const appSecret = process.env.META_WEBHOOK_SECRET;
  const signature = req.get("X-Hub-Signature-256") ?? "";
  const rawBody = (req as any).rawBody as Buffer | undefined;

  if (appSecret) {
    if (!rawBody || !signature.startsWith("sha256=")) {
      res.sendStatus(401);
      return;
    }
    const expected =
      "sha256=" +
      crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex");
    // Both strings must be equal length for timingSafeEqual
    if (
      signature.length !== expected.length ||
      !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
    ) {
      console.warn("[Webhook] Invalid X-Hub-Signature-256 — rejecting payload");
      res.sendStatus(401);
      return;
    }
  } else {
    console.warn(
      "[Webhook] META_WEBHOOK_SECRET not set — skipping HMAC verification (set in production)",
    );
  }

  // Always respond 200 immediately so Meta doesn't retry
  res.sendStatus(200);

  try {
    const body = req.body as WhatsappWebhookPayload;
    if (body.object !== "whatsapp_business_account") return;

    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        if (change.field !== "messages") continue;
        const value = change.value;
        const phoneNumberId = value.metadata?.phone_number_id;
        if (!phoneNumberId) continue;

        const [account] = await db
          .select()
          .from(whatsappAccountsTable)
          .where(eq(whatsappAccountsTable.phoneNumberId, phoneNumberId))
          .limit(1);
        if (!account) continue;

        for (const msg of value.messages ?? []) {
          const senderPhone = msg.from;
          const isMe =
            !account.contactPhone ||
            senderPhone !== account.contactPhone.replace(/\D/g, "");

          let content = "";

          if (msg.type === "text") {
            content = msg.text?.body ?? "";
          } else if (msg.type === "audio") {
            const mediaId = msg.audio?.id;
            if (mediaId) {
              const media = await downloadMetaMedia(mediaId, account.accessToken);
              if (media) {
                content = await transcribeAudio(media.buffer, media.mimeType);
              } else {
                content = "[Message vocal — téléchargement échoué]";
              }
            }
          } else if (msg.type === "image") {
            const caption = msg.image?.caption ? ` — ${msg.image.caption}` : "";
            content = `[Image${caption}]`;
          } else if (msg.type === "document") {
            content = `[Document: ${msg.document?.filename ?? "fichier"}]`;
          } else if (msg.type === "video") {
            content = `[Vidéo${msg.video?.caption ? ` — ${msg.video.caption}` : ""}]`;
          } else if (msg.type === "sticker") {
            content = "[Sticker]";
          } else if (msg.type === "reaction") {
            content = `[Réaction: ${msg.reaction?.emoji ?? "?"}]`;
          } else {
            content = `[${msg.type}]`;
          }

          if (!content) continue;

          const sentAt = new Date(Number(msg.timestamp) * 1000);
          const hash = crypto
            .createHash("md5")
            .update(`${msg.id}${account.relationId}`)
            .digest("hex");

          const existing = await db
            .select({ id: whatsappMessagesTable.id })
            .from(whatsappMessagesTable)
            .where(eq(whatsappMessagesTable.contentHash, hash))
            .limit(1);

          if (existing.length > 0) continue;

          await db.insert(whatsappMessagesTable).values({
            relationId: account.relationId,
            sender: isMe ? "Moi" : (value.contacts?.[0]?.profile?.name ?? senderPhone),
            content,
            isMe,
            sentAt,
            importSource: "manual",
            contentHash: hash,
          });
        }
      }
    }
  } catch (err) {
    console.error("WhatsApp webhook error:", err);
  }
});

// ─── PRIVATE router — relation WhatsApp config (requires auth + ownership) ────
// Mounted after requireAuth and requireRelationOwnership in routes/index.ts.
export const whatsappConfigRouter = Router();

// GET /api/relations/:id/whatsapp/config
whatsappConfigRouter.get("/relations/:id/whatsapp/config", async (req, res) => {
  const relationId = Number(req.params.id);
  const [account] = await db
    .select()
    .from(whatsappAccountsTable)
    .where(eq(whatsappAccountsTable.relationId, relationId))
    .limit(1);

  if (!account) {
    res.json({ configured: false });
    return;
  }

  res.json({
    configured: true,
    phoneNumberId: account.phoneNumberId,
    businessAccountId: account.businessAccountId,
    contactPhone: account.contactPhone,
    // Never return the access token
  });
});

// POST /api/relations/:id/whatsapp/config
whatsappConfigRouter.post("/relations/:id/whatsapp/config", async (req, res) => {
  const relationId = Number(req.params.id);
  const { phoneNumberId, accessToken, businessAccountId, contactPhone } = req.body as {
    phoneNumberId: string;
    accessToken: string;
    businessAccountId?: string;
    contactPhone?: string;
  };

  if (!phoneNumberId || !accessToken) {
    res.status(400).json({ error: "phoneNumberId et accessToken requis" });
    return;
  }

  const verifyToken = crypto.randomBytes(24).toString("hex");

  await db
    .insert(whatsappAccountsTable)
    .values({
      relationId,
      phoneNumberId,
      accessToken,
      businessAccountId,
      contactPhone,
      verifyToken,
    })
    .onConflictDoUpdate({
      target: whatsappAccountsTable.relationId,
      set: {
        phoneNumberId,
        accessToken,
        businessAccountId,
        contactPhone,
        updatedAt: new Date(),
      },
    });

  res.json({ success: true, verifyToken });
});

// DELETE /api/relations/:id/whatsapp/config
whatsappConfigRouter.delete("/relations/:id/whatsapp/config", async (req, res) => {
  const relationId = Number(req.params.id);
  await db.delete(whatsappAccountsTable).where(eq(whatsappAccountsTable.relationId, relationId));
  res.json({ success: true });
});

// ─── Types ────────────────────────────────────────────────────────────────────

interface WhatsappWebhookPayload {
  object: string;
  entry: Array<{
    id: string;
    changes: Array<{
      field: string;
      value: {
        metadata: { display_phone_number: string; phone_number_id: string };
        contacts?: Array<{ profile: { name: string }; wa_id: string }>;
        messages?: Array<WhatsappMessage>;
      };
    }>;
  }>;
}

interface WhatsappMessage {
  id: string;
  from: string;
  timestamp: string;
  type: string;
  text?: { body: string };
  audio?: { id: string; mime_type: string };
  image?: { id: string; caption?: string; mime_type: string };
  document?: { id: string; filename?: string; mime_type: string };
  video?: { id: string; caption?: string; mime_type: string };
  sticker?: { id: string };
  reaction?: { message_id: string; emoji: string };
}
