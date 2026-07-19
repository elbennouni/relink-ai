/**
 * WhatsApp QR Code integration via Baileys (personal accounts)
 * One session per relation, stored in .baileys-sessions/<relationId>/
 */
import { Router } from "express";
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  proto,
} from "@whiskeysockets/baileys";
import type { WAMessage, ConnectionState } from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import { db, whatsappMessagesTable, whatsappAccountsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import path from "path";
import fs from "fs";
import { openai } from "@workspace/integrations-openai-ai-server";
import crypto from "crypto";

const router = Router();

// ─── Session store (in-memory, keyed by relationId) ──────────────────────────
interface Session {
  socket: ReturnType<typeof makeWASocket>;
  status: "connecting" | "qr" | "connected" | "disconnected";
  qr?: string; // base64 QR image
  contactPhone?: string; // e.g. "33612345678" (no +)
  sseClients: Set<{ write: (data: string) => void; end: () => void }>;
}

const sessions = new Map<number, Session>();

const SESSIONS_DIR = path.resolve(process.cwd(), ".baileys-sessions");
fs.mkdirSync(SESSIONS_DIR, { recursive: true });

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sessionDir(relationId: number) {
  return path.join(SESSIONS_DIR, String(relationId));
}

function configPath(relationId: number) {
  return path.join(sessionDir(relationId), "relink-config.json");
}

function readConfig(relationId: number): { contactPhone?: string } {
  try {
    return JSON.parse(fs.readFileSync(configPath(relationId), "utf8"));
  } catch {
    return {};
  }
}

function writeConfig(relationId: number, cfg: { contactPhone?: string }) {
  fs.mkdirSync(sessionDir(relationId), { recursive: true });
  fs.writeFileSync(configPath(relationId), JSON.stringify(cfg), "utf8");
}

function broadcastToSession(relationId: number, data: object) {
  const session = sessions.get(relationId);
  if (!session) return;
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  for (const client of session.sseClients) {
    try { client.write(payload); } catch { /* ignore */ }
  }
}

/** Normalise a JID to a plain phone number string */
function jidToPhone(jid: string): string {
  return jid.replace(/@.*$/, "").replace(/[^0-9]/g, "");
}

/** Download and transcribe a WhatsApp audio message */
async function transcribeWhatsappAudio(
  msg: WAMessage,
  sock: ReturnType<typeof makeWASocket>
): Promise<string> {
  try {
    const { downloadContentFromMessage } = await import("@whiskeysockets/baileys");
    const audioMsg = msg.message?.audioMessage ?? msg.message?.pttMessage;
    if (!audioMsg) return "[Message vocal]";

    const stream = await downloadContentFromMessage(audioMsg, "audio");
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk);
    const buffer = Buffer.concat(chunks);
    const mimeType = audioMsg.mimetype ?? "audio/ogg; codecs=opus";
    const ext = mimeType.includes("ogg") ? "ogg" : mimeType.includes("mp4") ? "mp4" : "ogg";

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

// ─── Start / reconnect a Baileys session ─────────────────────────────────────

async function startSession(relationId: number, contactPhone?: string) {
  // Close any existing session
  const existing = sessions.get(relationId);
  if (existing) {
    try { existing.socket.end(undefined); } catch { /* ignore */ }
    sessions.delete(relationId);
  }

  const dir = sessionDir(relationId);
  fs.mkdirSync(dir, { recursive: true });

  // Persist config
  const savedConfig = readConfig(relationId);
  const phone = contactPhone ?? savedConfig.contactPhone;
  writeConfig(relationId, { contactPhone: phone });

  const { state, saveCreds } = await useMultiFileAuthState(dir);
  const { version } = await fetchLatestBaileysVersion();

  const session: Session = {
    socket: null as unknown as ReturnType<typeof makeWASocket>,
    status: "connecting",
    contactPhone: phone,
    sseClients: new Set(),
  };
  sessions.set(relationId, session);

  const sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, console as unknown as Parameters<typeof makeCacheableSignalKeyStore>[1]),
    },
    printQRInTerminal: false,
    syncFullHistory: true, // try to pull history
    getMessage: async () => undefined,
  });
  session.socket = sock;

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update: Partial<ConnectionState>) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      // Convert QR string to base64 image
      import("qrcode").then((QRCode) => {
        QRCode.toDataURL(qr, { errorCorrectionLevel: "M", width: 300 }).then((dataUrl) => {
          session.status = "qr";
          session.qr = dataUrl;
          broadcastToSession(relationId, { type: "qr", data: dataUrl });
        });
      });
    }

    if (connection === "open") {
      session.status = "connected";
      session.qr = undefined;
      broadcastToSession(relationId, { type: "connected" });
    }

    if (connection === "close") {
      const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      session.status = "disconnected";
      broadcastToSession(relationId, { type: "disconnected", loggedOut: !shouldReconnect });

      if (shouldReconnect) {
        setTimeout(() => startSession(relationId), 3000);
      } else {
        // Logged out — delete session files
        sessions.delete(relationId);
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify" && type !== "append") return;

    for (const msg of messages) {
      if (!msg.message) continue;
      const jid = msg.key.remoteJid ?? "";
      if (jid.endsWith("@g.us") || jid.endsWith("@broadcast")) continue; // skip groups

      const senderJid = msg.key.participant ?? msg.key.remoteJid ?? "";
      const senderPhone = jidToPhone(senderJid || (msg.key.remoteJid ?? ""));
      const isMe = msg.key.fromMe ?? false;

      // If contactPhone is configured, only store messages from/to that contact
      const contactPhone = session.contactPhone?.replace(/\D/g, "");
      const chatPhone = jidToPhone(jid);
      if (contactPhone && chatPhone !== contactPhone && !isMe) continue;

      let content = "";
      const m = msg.message;

      if (m.conversation) {
        content = m.conversation;
      } else if (m.extendedTextMessage?.text) {
        content = m.extendedTextMessage.text;
      } else if (m.audioMessage || m.pttMessage) {
        content = await transcribeWhatsappAudio(msg, sock);
      } else if (m.imageMessage) {
        content = m.imageMessage.caption ? `[Image] ${m.imageMessage.caption}` : "[Image]";
      } else if (m.videoMessage) {
        content = m.videoMessage.caption ? `[Vidéo] ${m.videoMessage.caption}` : "[Vidéo]";
      } else if (m.documentMessage) {
        content = `[Document: ${m.documentMessage.fileName ?? "fichier"}]`;
      } else if (m.stickerMessage) {
        content = "[Sticker]";
      } else if (m.reactionMessage) {
        content = `[Réaction: ${m.reactionMessage.text ?? "?"}]`;
      } else {
        continue; // skip unknown types
      }

      const sentAt = new Date(Number(msg.messageTimestamp) * 1000);
      const hash = crypto
        .createHash("md5")
        .update(`${msg.key.id}${relationId}`)
        .digest("hex");

      try {
        await db
          .insert(whatsappMessagesTable)
          .values({
            relationId,
            sender: isMe ? "Moi" : (senderPhone || "Contact"),
            content,
            isMe,
            sentAt,
            importSource: "whatsapp_file",
            contentHash: hash,
          })
          .onConflictDoNothing();
      } catch { /* ignore constraint errors */ }
    }
  });
}

// ─── Auto-restore sessions on startup ────────────────────────────────────────
(async () => {
  try {
    const dirs = fs.readdirSync(SESSIONS_DIR).filter((d) => /^\d+$/.test(d));
    for (const dir of dirs) {
      const relationId = Number(dir);
      const credsPath = path.join(SESSIONS_DIR, dir, "creds.json");
      if (fs.existsSync(credsPath)) {
        console.log(`[Baileys] Restoring session for relation ${relationId}`);
        await startSession(relationId);
      }
    }
  } catch { /* ignore */ }
})();

// ─── Routes ──────────────────────────────────────────────────────────────────

/** GET /api/relations/:id/whatsapp/qr  — SSE stream: qr | connected | disconnected */
router.get("/relations/:id/whatsapp/qr", async (req, res) => {
  const relationId = Number(req.params.id);
  const contactPhone = (req.query.contactPhone as string | undefined)?.replace(/\D/g, "");

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const client = {
    write: (data: string) => res.write(data),
    end: () => res.end(),
  };

  let session = sessions.get(relationId);

  // If already connected, just report status
  if (session?.status === "connected") {
    res.write(`data: ${JSON.stringify({ type: "connected" })}\n\n`);
    res.end();
    return;
  }

  // Start or join session
  if (!session) {
    await startSession(relationId, contactPhone);
    session = sessions.get(relationId)!;
  } else if (contactPhone) {
    session.contactPhone = contactPhone;
    writeConfig(relationId, { contactPhone });
  }

  session.sseClients.add(client);

  // If QR already generated, send it immediately
  if (session.qr) {
    res.write(`data: ${JSON.stringify({ type: "qr", data: session.qr })}\n\n`);
  }

  req.on("close", () => {
    session?.sseClients.delete(client);
  });
});

/** GET /api/relations/:id/whatsapp/status */
router.get("/relations/:id/whatsapp/status", (req, res) => {
  const relationId = Number(req.params.id);
  const session = sessions.get(relationId);

  // Also check if session files exist (so we know it was previously configured)
  const hasFiles = fs.existsSync(path.join(sessionDir(relationId), "creds.json"));

  res.json({
    status: session?.status ?? (hasFiles ? "connecting" : "none"),
    contactPhone: session?.contactPhone ?? readConfig(relationId).contactPhone,
  });
});

/** POST /api/relations/:id/whatsapp/disconnect-qr */
router.post("/relations/:id/whatsapp/disconnect-qr", async (req, res) => {
  const relationId = Number(req.params.id);
  const session = sessions.get(relationId);

  if (session) {
    broadcastToSession(relationId, { type: "disconnected", loggedOut: true });
    try { session.socket.logout(); } catch { /* ignore */ }
    sessions.delete(relationId);
  }

  // Delete session files
  const dir = sessionDir(relationId);
  fs.rmSync(dir, { recursive: true, force: true });

  res.json({ success: true });
});

export default router;
