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
import { db, whatsappMessagesTable, whatsappAccountsTable, whatsappLidMappingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { notifyRelationOwner } from "../lib/pushNotifications";
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

// ─── LID ↔ phone mapping (shared across all sessions, persisted in DB) ────────
// WhatsApp now delivers messages using "LID" device identifiers instead of phone
// JIDs. We build this map from contacts.upsert events and from outgoing messages,
// and persist it to the DB so it survives server restarts.
const lidToPhone = new Map<string, string>(); // "8380068413573" → "33612345678"

/** Load all known LID→phone pairs from the DB into the in-memory map. */
async function loadLidMappings() {
  try {
    const rows = await db.select().from(whatsappLidMappingsTable);
    for (const row of rows) {
      lidToPhone.set(row.lid, row.phone);
    }
    if (rows.length > 0) {
      console.log(`[Baileys] Loaded ${rows.length} LID↔phone mappings from DB`);
    }
  } catch (err) {
    console.warn("[Baileys] Could not load LID mappings from DB:", err);
  }
}

/** Persist a single LID→phone pair to the DB (upsert). */
async function saveLidMapping(lid: string, phone: string) {
  try {
    await db
      .insert(whatsappLidMappingsTable)
      .values({ lid, phone, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: whatsappLidMappingsTable.lid,
        set: { phone, updatedAt: new Date() },
      });
  } catch (err) {
    console.warn(`[Baileys] Could not save LID mapping ${lid}→${phone}:`, err);
  }
}

function registerContactJids(contact: { id?: string; lid?: string }) {
  const phoneJid = contact.id ?? "";
  const lidJid   = contact.lid ?? "";
  if (!phoneJid.includes("@s.whatsapp.net") || !lidJid.includes("@lid")) return;
  const phone = phoneJid.split("@")[0].split(":")[0];
  const lid   = lidJid.split("@")[0].split(":")[0];
  if (phone && lid && !lidToPhone.has(lid)) {
    lidToPhone.set(lid, phone);
    saveLidMapping(lid, phone); // fire-and-forget, no await needed
  }
}

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

/**
 * Resolve a JID (any format) to a plain phone-number string.
 *
 * Handles all three modern WhatsApp JID formats:
 *   "33612345678@s.whatsapp.net"    →  "33612345678"
 *   "33612345678:37@s.whatsapp.net" →  "33612345678"  (device suffix stripped)
 *   "8380068413573@lid"             →  "33612345678"  (LID resolved via contacts map)
 *   "8380068413573:0@lid"           →  "33612345678"  (LID with device suffix)
 *
 * Returns "" when a LID cannot yet be resolved (map not yet populated).
 */
function jidToPhone(jid: string): string {
  const user = jid.split("@")[0].split(":")[0]; // strip @server and :device suffix
  if (jid.includes("@lid")) {
    // LID: look up the corresponding phone number from the contacts map
    return lidToPhone.get(user) ?? "";
  }
  return user.replace(/[^0-9]/g, "");
}

/**
 * Loose phone-number comparison that ignores leading country codes / zeroes.
 * Compares the last `N` digits of both numbers so "+33612345678" matches
 * a contactPhone stored as "612345678" or "0612345678".
 */
function phonesMatch(a: string, b: string, significantDigits = 9): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  return a.slice(-significantDigits) === b.slice(-significantDigits);
}

/** Download a WhatsApp media message and return a base64 data URL */
async function downloadMediaAsDataUrl(
  msg: WAMessage,
  type: "image" | "audio" | "video"
): Promise<string | null> {
  try {
    const { downloadContentFromMessage } = await import("@whiskeysockets/baileys");
    const m = msg.message!;
    const mediaMsg =
      type === "image" ? m.imageMessage :
      type === "audio" ? (m.audioMessage ?? m.pttMessage) :
      m.videoMessage;
    if (!mediaMsg) return null;

    const stream = await downloadContentFromMessage(mediaMsg as Parameters<typeof downloadContentFromMessage>[0], type);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk);
    const buffer = Buffer.concat(chunks);
    const mimeType = (mediaMsg as { mimetype?: string }).mimetype ?? (type === "image" ? "image/jpeg" : type === "audio" ? "audio/ogg" : "video/mp4");
    return `data:${mimeType};base64,${buffer.toString("base64")}`;
  } catch {
    return null;
  }
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
    syncFullHistory: false,
    // Returning a non-undefined value is critical — Baileys drops incoming
    // messages silently when getMessage returns undefined (needed for retries).
    getMessage: async (_key) => ({ conversation: "" }),
  });
  session.socket = sock;

  sock.ev.on("creds.update", saveCreds);

  // ── Build LID ↔ phone mapping from contact list ───────────────────────────
  // WhatsApp delivers messages with LID JIDs in newer versions. contacts.upsert
  // fires on connect with the full contact list, each entry having both the
  // phone JID (id) and LID (lid) when available.
  sock.ev.on("contacts.upsert", (contacts) => {
    let mapped = 0;
    for (const contact of contacts) {
      const before = lidToPhone.size;
      registerContactJids(contact as { id?: string; lid?: string });
      if (lidToPhone.size > before) mapped++;
    }
    if (mapped > 0) {
      console.log(`[Baileys:${relationId}] contacts.upsert: mapped ${mapped} new LID↔phone pairs (total: ${lidToPhone.size})`);
    }
  });

  sock.ev.on("contacts.update", (updates) => {
    for (const update of updates) {
      registerContactJids(update as { id?: string; lid?: string });
    }
  });

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

  // ── Extract content + media from a single WAMessage ─────────────────────────
  async function extractMessage(msg: WAMessage, skipAudio: boolean): Promise<{ content: string; mediaData: string | null } | null> {
    const m = msg.message!;
    let content = "";
    let mediaData: string | null = null;

    if (m.conversation) {
      content = m.conversation;
    } else if (m.extendedTextMessage?.text) {
      content = m.extendedTextMessage.text;
    } else if ((m.audioMessage || m.pttMessage) && !skipAudio) {
      const [transcription, audioData] = await Promise.all([
        transcribeWhatsappAudio(msg, sock),
        downloadMediaAsDataUrl(msg, "audio"),
      ]);
      content = transcription;
      mediaData = audioData;
    } else if (m.audioMessage || m.pttMessage) {
      content = "[Message vocal]";
    } else if (m.imageMessage) {
      content = m.imageMessage.caption || "[Image]";
      if (!skipAudio) mediaData = await downloadMediaAsDataUrl(msg, "image");
    } else if (m.videoMessage) {
      content = m.videoMessage.caption ? `[Vidéo] ${m.videoMessage.caption}` : "[Vidéo]";
    } else if (m.documentMessage) {
      content = `[Document: ${m.documentMessage.fileName ?? "fichier"}]`;
    } else if (m.stickerMessage) {
      content = "[Sticker]";
    } else if (m.reactionMessage) {
      content = `[Réaction: ${m.reactionMessage.text ?? "?"}]`;
    } else {
      return null;
    }

    return { content, mediaData };
  }

  // ── Persist one message into the correct relation ─────────────────────────────
  async function persistMessage(
    msg: WAMessage,
    targetRelationId: number,
    isMe: boolean,
    senderPhone: string,
    content: string,
    mediaData: string | null,
    sentAt: Date,
  ) {
    const hash = crypto
      .createHash("md5")
      .update(`${msg.key.id}:${targetRelationId}`)
      .digest("hex");
    try {
      const result = await db
        .insert(whatsappMessagesTable)
        .values({
          relationId: targetRelationId,
          sender: isMe ? "Moi" : (senderPhone || "Contact"),
          content,
          isMe,
          sentAt,
          importSource: "whatsapp_file",
          contentHash: hash,
          ...(mediaData ? { mediaData } : {}),
        })
        .onConflictDoNothing()
        .returning({ id: whatsappMessagesTable.id });

      // Send push notification for incoming messages (fromMe=false) that were actually inserted
      if (!isMe && result.length > 0) {
        const preview = content.length > 80 ? content.slice(0, 80) + "…" : content;
        notifyRelationOwner(
          targetRelationId,
          `Nouveau message`,
          preview,
          { relationId: targetRelationId },
        ).catch(() => {}); // fire-and-forget
      }
    } catch { /* ignore constraint errors */ }
  }

  // ── Shared helper : persist a list of WAMessages ─────────────────────────────
  // For incoming (fromMe=false) messages, searches ALL active sessions to find
  // the relation whose contactPhone matches the sender — because WhatsApp may
  // deliver the message to any of the open web sessions.
  async function storeMessages(msgs: WAMessage[], skipAudio = false) {
    for (const msg of msgs) {
      if (!msg.message) continue;
      const jid = msg.key.remoteJid ?? "";

      // Skip groups and broadcasts — never skip @lid (real chat messages use LID in new WA)
      if (jid.endsWith("@g.us") || jid.endsWith("@broadcast")) continue;

      const isMe = msg.key.fromMe ?? false;

      // jidToPhone resolves LIDs via the contacts map, strips :XX device suffix
      const chatPhone = jidToPhone(jid);

      // For group messages participant field carries the sender; for 1-on-1 use remoteJid
      const senderRaw = msg.key.participant ?? msg.key.remoteJid ?? "";
      const senderPhone = jidToPhone(senderRaw || jid);

      const sentAt = new Date(Number(msg.messageTimestamp) * 1000);
      if (isNaN(sentAt.getTime()) || sentAt.getFullYear() < 2000) continue;

      const extracted = await extractMessage(msg, skipAudio);
      if (!extracted) continue;
      const { content, mediaData } = extracted;

      // ── Learn LID → phone mapping from outgoing messages ─────────────────────
      // When the user sends a message (fromMe=true) and the remoteJid is a @lid,
      // we know that LID corresponds to this session's contactPhone. Record it
      // immediately so subsequent incoming messages from that LID can be routed.
      if (jid.includes("@lid") && chatPhone === "") {
        const lidUser = jid.split("@")[0].split(":")[0];
        const myContactPhone = session.contactPhone?.replace(/\D/g, "");
        if (isMe && myContactPhone && !lidToPhone.has(lidUser)) {
          lidToPhone.set(lidUser, myContactPhone);
          saveLidMapping(lidUser, myContactPhone); // persist to DB
          console.log(`[Baileys:${relationId}] Learned LID from outgoing: ${lidUser} → ${myContactPhone} (saved to DB)`);
        }
      }

      if (isMe) {
        // Own outgoing message — store in this relation if the chat's remote JID
        // matches our configured contactPhone (or if no filter is set yet).
        const myContactPhone = session.contactPhone?.replace(/\D/g, "");
        const resolvedPhone = jidToPhone(jid); // re-resolve after possible map update above
        if (!myContactPhone || resolvedPhone === "" || phonesMatch(resolvedPhone, myContactPhone)) {
          // resolvedPhone === "" means LID not yet resolved — store optimistically
          await persistMessage(msg, relationId, true, senderPhone, content, mediaData, sentAt);
        } else {
          console.log(`[Baileys:${relationId}] Own msg skipped — chatPhone=${resolvedPhone} contactPhone=${myContactPhone}`);
        }
      } else {
        // Incoming message — route to the relation whose contactPhone matches chatPhone.
        // Search ALL sessions (WhatsApp may deliver the message to any open web session).
        let stored = false;
        const resolvedPhone = jidToPhone(jid); // may now be resolved after learn step

        if (resolvedPhone === "") {
          // LID not yet in contacts map — store in current session as best effort
          console.log(`[Baileys:${relationId}] ⚠ LID ${jid} not yet resolved, storing in current relation`);
          await persistMessage(msg, relationId, false, senderPhone, content, mediaData, sentAt);
          stored = true;
        } else {
          for (const [relId, relSession] of sessions.entries()) {
            const cp = relSession.contactPhone?.replace(/\D/g, "");
            if (phonesMatch(resolvedPhone, cp ?? "")) {
              console.log(`[Baileys:${relationId}→${relId}] Incoming from ${resolvedPhone} (matches ${cp}): "${content.slice(0, 60)}"`);
              await persistMessage(msg, relId, false, senderPhone, content, mediaData, sentAt);
              stored = true;
            }
          }
        }

        if (!stored) {
          const known = [...sessions.values()].map(s => s.contactPhone?.replace(/\D/g, "") ?? "?").join(", ");
          console.log(`[Baileys:${relationId}] ⚠ No match — resolvedPhone=${resolvedPhone} jid=${jid} | known: [${known}] | lidMap: ${lidToPhone.size}`);
        }
      }
    }
  }

  // ── New messages arriving in real time ────────────────────────────────────
  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    console.log(`[Baileys:${relationId}] upsert type=${type} count=${messages.length} jids=${messages.map(m => `${m.key.remoteJid}(fromMe=${m.key.fromMe})`).join(",")}`);
    if (type !== "notify" && type !== "append") return;
    await storeMessages(messages, false);
  });

  // ── Historical messages (WhatsApp delivers past conversations on connect) ──
  sock.ev.on("messages.history-set", async ({ messages, isLatest }) => {
    console.log(`[Baileys] history-set: ${messages.length} messages (isLatest=${isLatest}) for relation ${relationId}`);
    // Skip audio transcription for history (too slow for bulk); store as [Message vocal]
    await storeMessages(messages as WAMessage[], true);
  });
}

// ─── Auto-restore sessions on startup ────────────────────────────────────────
(async () => {
  // Load persisted LID↔phone mappings first so they're available before any
  // session connects and receives messages.
  await loadLidMappings();

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

/** POST /relations/:id/whatsapp/send */
router.post("/relations/:id/whatsapp/send", async (req, res) => {
  const relationId = Number(req.params.id);
  const session = sessions.get(relationId);

  if (!session || session.status !== "connected") {
    res.status(400).json({ error: "WhatsApp not connected" });
    return;
  }

  const phone = session.contactPhone?.replace(/\D/g, "");
  if (!phone) {
    res.status(400).json({ error: "No contact phone configured" });
    return;
  }

  const { text } = req.body;
  if (!text || typeof text !== "string") {
    res.status(400).json({ error: "text is required" });
    return;
  }

  const jid = `${phone}@s.whatsapp.net`;
  await session.socket.sendMessage(jid, { text });

  res.json({ success: true, to: phone });
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
