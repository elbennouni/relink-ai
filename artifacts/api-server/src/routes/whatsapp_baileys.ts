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
import { db, whatsappMessagesTable, whatsappAccountsTable, whatsappLidMappingsTable, relationsTable, scheduledMessagesTable } from "@workspace/db";
import { eq, desc, and, gte } from "drizzle-orm";
import { notifyRelationOwner } from "../lib/pushNotifications";
import path from "path";
import fs from "fs";
import { openai } from "@workspace/integrations-openai-ai-server";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import crypto from "crypto";

const router = Router();

// Fetch Baileys version once at startup and cache it
let baileysVersion: [number, number, number] = [2, 3000, 1015920855]; // safe fallback
fetchLatestBaileysVersion().then(({ version }) => { baileysVersion = version; }).catch(() => {});

// ─── Session store (in-memory, keyed by relationId) ──────────────────────────
interface Session {
  socket: ReturnType<typeof makeWASocket>;
  status: "connecting" | "qr" | "connected" | "disconnected";
  qr?: string; // base64 QR image
  contactPhone?: string; // e.g. "33612345678" (no +)
  historyDays?: number; // 0 = no history, 7/60/180/3650 = import window
  intentionalClose?: boolean; // set before socket.end() to prevent the connection.update handler from re-scheduling startSession
  historyImported?: boolean; // true once messages.history-set finished — prevents SSE reconnects from re-triggering a creds wipe
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
 * Strict phone-number comparison that handles local vs. international formats.
 *
 * Two numbers match when, after digit-only normalization and leading-zero
 * stripping, either:
 *   1. They are identical, OR
 *   2. One is a proper suffix of the other AND the extra prefix on the longer
 *      number is 1–3 digits (a plausible country-code addition).
 *
 * This prevents the false-positive collisions that "last-N-digits" matching
 * can produce across different country codes (e.g. +1 and +33 numbers that
 * happen to share their last 9 digits).
 *
 * Minimum 7 significant digits required to avoid short-number false positives.
 */
function phonesMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  const na = a.replace(/[^0-9]/g, "");
  const nb = b.replace(/[^0-9]/g, "");
  if (!na || !nb) return false;
  if (na === nb) return true;

  // Strip leading zeros (local-format prefix) before suffix comparison so that
  // "0612345678" (French local) aligns with "33612345678" (international JID).
  const naS = na.replace(/^0+/, "");
  const nbS = nb.replace(/^0+/, "");
  if (naS === nbS) return true;

  const shorter = naS.length <= nbS.length ? naS : nbS;
  const longer  = naS.length <= nbS.length ? nbS : naS;
  if (shorter.length < 7) return false;
  if (!longer.endsWith(shorter)) return false;

  // The extra prefix must look like a country code (1–3 digits).
  const prefix = longer.slice(0, longer.length - shorter.length);
  return prefix.length >= 1 && prefix.length <= 3;
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

async function startSession(relationId: number, contactPhone?: string, historyDays?: number, skipCredsWipe = false) {
  // Close any existing session.
  // Mark it as intentionally closed BEFORE calling socket.end() so its
  // connection.update handler does NOT schedule a new startSession call.
  const existing = sessions.get(relationId);
  if (existing) {
    existing.intentionalClose = true;
    try { existing.socket.end(undefined); } catch { /* ignore */ }
    sessions.delete(relationId);
  }

  const dir = sessionDir(relationId);

  // syncFullHistory = true when the user asked for historical import
  const wantsHistory = historyDays !== undefined && historyDays > 0;

  // WhatsApp only sends history when a device is first linked.
  // If creds already exist and the user wants history, wipe them so Baileys
  // starts fresh, generates a new QR, and WhatsApp delivers the history on link.
  // Exception: skipCredsWipe is true when called after a 515 "restart required" —
  // in that case Baileys just saved fresh QR-paired creds; wiping them would
  // destroy the pairing we just completed.
  if (wantsHistory && !skipCredsWipe) {
    const credsPath = path.join(dir, "creds.json");
    if (fs.existsSync(credsPath)) {
      console.log(`[Baileys:${relationId}] Wiping session creds for fresh history import`);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  fs.mkdirSync(dir, { recursive: true });

  // Persist config
  const savedConfig = readConfig(relationId);
  const phone = contactPhone ?? savedConfig.contactPhone;
  writeConfig(relationId, { contactPhone: phone });

  const { state, saveCreds } = await useMultiFileAuthState(dir);

  const session: Session = {
    socket: null as unknown as ReturnType<typeof makeWASocket>,
    status: "connecting",
    contactPhone: phone,
    historyDays,
    sseClients: new Set(),
  };
  sessions.set(relationId, session);

  const sock = makeWASocket({
    version: baileysVersion,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, console as unknown as Parameters<typeof makeCacheableSignalKeyStore>[1]),
    },
    printQRInTerminal: false,
    syncFullHistory: wantsHistory,
    // Baileys' default shouldSyncHistoryMessage returns false for FULL sync type,
    // silently dropping all FULL history chunks even when syncFullHistory=true.
    // Override to accept all sync types when the user requested history import.
    ...(wantsHistory && { shouldSyncHistoryMessage: () => true }),
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
      // If we intentionally closed this socket (e.g. startSession replaced it),
      // do NOT schedule a reconnect — that would start a second parallel session
      // and create an infinite double-reconnect loop.
      if (session.intentionalClose) return;

      const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
      const isLoggedOut = statusCode === DisconnectReason.loggedOut;

      // 515 = "restart required" — WhatsApp intentionally sends this after a QR
      // scan pairing to force a reconnect with the newly-saved credentials.
      // The Baileys log says "pairing configured successfully, expect to restart".
      // We MUST reconnect in this case even though status was still "qr".
      const isRestartRequired = statusCode === DisconnectReason.restartRequired;

      // Only auto-reconnect when:
      //   a) WhatsApp asks for a restart after pairing (515), OR
      //   b) The session was fully connected (QR already scanned, transient drop)
      // Do NOT reconnect if Baileys drops while still waiting for QR scan with an
      // unrecognised code — that causes a rate-limiting spiral.
      const wasConnected = session.status === "connected";
      const shouldReconnect = !isLoggedOut && (wasConnected || isRestartRequired);

      console.log(`[Baileys:${relationId}] connection closed — statusCode=${statusCode} wasConnected=${wasConnected} isRestartRequired=${isRestartRequired} isLoggedOut=${isLoggedOut}`);

      session.status = "disconnected";

      if (isLoggedOut) {
        // WhatsApp explicitly logged this device out — wipe session files
        broadcastToSession(relationId, { type: "disconnected", loggedOut: true });
        sessions.delete(relationId);
        fs.rmSync(dir, { recursive: true, force: true });
      } else if (isRestartRequired) {
        // Silent restart after QR pairing — don't show "disconnected" to the user,
        // just reconnect immediately with the freshly-saved credentials.
        console.log(`[Baileys:${relationId}] QR pairing complete — reconnecting with new creds`);
        setTimeout(() => startSession(relationId, session.contactPhone, session.historyDays, true /* skipCredsWipe */), 500);
      } else if (wasConnected) {
        // Transient drop after a fully-established session → reconnect
        broadcastToSession(relationId, { type: "disconnected", loggedOut: false });
        setTimeout(() => startSession(relationId), 3000);
      } else {
        // Dropped before QR scan with unexpected code — don't reconnect, let user retry
        broadcastToSession(relationId, { type: "disconnected", loggedOut: false });
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
  // `confident` = we are SURE this message belongs to targetRelationId (phone matched
  // exactly). When false (LID unresolved fallback, no-match fallback) we store the
  // message for safety but do NOT trigger SOS — we can't risk auto-replying to the
  // wrong person.
  async function persistMessage(
    msg: WAMessage,
    targetRelationId: number,
    isMe: boolean,
    senderPhone: string,
    content: string,
    mediaData: string | null,
    sentAt: Date,
    confident = true,
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
          null,           // null → auto-uses relation name as title
          preview,
          { relationId: targetRelationId },
        ).catch(() => {}); // fire-and-forget

        // SOS mode: auto-generate a reply — only when routing is confirmed
        if (confident) triggerSosReply(targetRelationId).catch(() => {});
      }
    } catch { /* ignore constraint errors */ }
  }

  // ── SOS mode: auto-generate a human-like reply and schedule it ──────────────
  async function triggerSosReply(relationId: number) {
    const [relation] = await db
      .select()
      .from(relationsTable)
      .where(eq(relationsTable.id, relationId))
      .limit(1);

    if (!relation?.sosMode || !relation.userId) return;

    // ── Protection rafale : ne générer qu'une seule réponse SOS par fenêtre de 30 min ──
    // Si un message SOS est déjà en attente pour cette relation, on ignore.
    const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000);
    const existing = await db
      .select({ id: scheduledMessagesTable.id })
      .from(scheduledMessagesTable)
      .where(
        and(
          eq(scheduledMessagesTable.relationId, relationId),
          eq(scheduledMessagesTable.status, "pending"),
          gte(scheduledMessagesTable.createdAt, thirtyMinAgo),
        )
      )
      .limit(1);
    if (existing.length > 0) return; // une réponse est déjà programmée, on ne surenchérit pas

    // ── Récupère les 40 derniers messages pour le contexte et le style ──────────
    const allRecent = await db
      .select({
        content: whatsappMessagesTable.content,
        isMe: whatsappMessagesTable.isMe,
        sentAt: whatsappMessagesTable.sentAt,
      })
      .from(whatsappMessagesTable)
      .where(eq(whatsappMessagesTable.relationId, relationId))
      .orderBy(desc(whatsappMessagesTable.sentAt))
      .limit(40);
    allRecent.reverse();

    // Style d'écriture : les 15 derniers messages envoyés par l'utilisateur
    const myMessages = allRecent.filter((m) => m.isMe).slice(-15);
    const styleExamples = myMessages.map((m) => `- "${m.content}"`).join("\n");

    // Conversation récente (les 20 derniers messages, tous expéditeurs)
    const recentContext = allRecent.slice(-20);
    const contextStr = recentContext
      .map((m) => `${m.isMe ? relation.participantMe || "Moi" : relation.participantOther}: ${m.content}`)
      .join("\n");

    // Compte combien de messages consécutifs l'autre a envoyés sans réponse (rafale)
    let burstCount = 0;
    for (let i = allRecent.length - 1; i >= 0; i--) {
      if (!allRecent[i].isMe) burstCount++;
      else break;
    }

    // ── Rafale : si l'autre a envoyé >2 messages consécutifs, forcer réponse courte + 2 min ──
    const isBurst = burstCount > 2;

    // Les derniers messages reçus (pour répondre précisément à ce qu'ils ont dit)
    const lastTheirMsgs = allRecent
      .filter((m) => !m.isMe)
      .slice(-5)
      .map((m) => `  • "${m.content}"`)
      .join("\n");

    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 200,
      system: `Tu es un assistant qui aide ${relation.participantMe || "quelqu'un"} à répondre à ${relation.participantOther} de façon authentique.
RÈGLE ABSOLUE : ta réponse doit être un JSON valide, rien d'autre. Pas de markdown, pas d'explication.`,
      messages: [{
        role: "user",
        content: `STYLE D'ÉCRITURE de ${relation.participantMe || "moi"} — imite exactement (abréviations, longueur, ponctuation, majuscules) :
${styleExamples || "(pas d'exemples disponibles)"}

CONVERSATION (les 20 derniers échanges) :
${contextStr}

CE QUE ${relation.participantOther?.toUpperCase() || "L'AUTRE"} VIENT DE DIRE (réponds à ÇA précisément) :
${lastTheirMsgs}

${isBurst ? `⚠️ RAFALE DE ${burstCount} MESSAGES — réponds avec UN message ultra-court (5 mots max) dans 2 minutes exactement.` : `Décide du délai selon la tension :
- Neutre/bonne ambiance → 0–5 min
- Légère tension → 20–90 min
- Forte tension ou rafale → 120–480 min
- Crise / agressivité → 600–1440 min`}

JSON attendu UNIQUEMENT :
{"message":"<réponds précisément à ce qu'il/elle a dit, dans le style ci-dessus>","delay_minutes":${isBurst ? 2 : "<nombre>"}}`,
      }],
    });

    const raw = (msg.content[0] as { type: string; text: string }).text?.trim() ?? "";

    // Parse JSON — robuste aux backticks ou texte parasite autour
    let replyText: string;
    let delayMin: number;
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      const parsed = JSON.parse(jsonMatch?.[0] ?? raw);
      replyText = String(parsed.message ?? "").trim();
      delayMin  = isBurst ? 2 : Math.max(0, Math.min(1440, Number(parsed.delay_minutes) || 5));
    } catch {
      replyText = raw.replace(/\{[\s\S]*\}/g, "").trim() || raw.slice(0, 200);
      delayMin  = isBurst ? 2 : 30;
    }

    if (!replyText) return;

    const scheduledAt = new Date(Date.now() + delayMin * 60 * 1000);

    await db.insert(scheduledMessagesTable).values({
      userId: relation.userId,
      relationId,
      content: replyText,
      scheduledAt,
      status: "pending",
      sourceType: "sos",
    });

    console.log(`[SOS] Relation ${relationId} — réponse programmée dans ${delayMin} min : "${replyText.slice(0, 60)}"`);
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
      if (jid.includes("@lid")) {
        const lidUser = jid.split("@")[0].split(":")[0];
        const myContactPhone = session.contactPhone?.replace(/\D/g, "");
        if (chatPhone === "" && isMe && myContactPhone && !lidToPhone.has(lidUser)) {
          lidToPhone.set(lidUser, myContactPhone);
          saveLidMapping(lidUser, myContactPhone); // persist to DB
          console.log(`[Baileys:${relationId}] Learned LID from outgoing: ${lidUser} → ${myContactPhone} (saved to DB)`);
        }
        // ── Auto-heal contactPhone mismatch ──────────────────────────────────
        // If outgoing messages consistently go to a resolved phone that differs
        // from the stored contactPhone, the stored value is stale. Update it so
        // incoming messages from the same LID are routed correctly.
        if (isMe && chatPhone !== "" && myContactPhone && !phonesMatch(chatPhone, myContactPhone)) {
          console.log(`[Baileys:${relationId}] Auto-correcting contactPhone: ${myContactPhone} → ${chatPhone}`);
          session.contactPhone = chatPhone;
          writeConfig(relationId, { contactPhone: chatPhone });
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
          // Last-resort: this session is the one receiving the event, store it here
          console.log(`[Baileys:${relationId}] Own msg fallback store — chatPhone=${resolvedPhone} contactPhone=${myContactPhone}`);
          await persistMessage(msg, relationId, true, senderPhone, content, mediaData, sentAt);
        }
      } else {
        // Incoming message — route to the relation whose contactPhone matches chatPhone.
        // Search ALL sessions (WhatsApp may deliver the message to any open web session).
        let stored = false;
        const resolvedPhone = jidToPhone(jid); // may now be resolved after learn step

        if (resolvedPhone === "") {
          // LID not yet in contacts map — store in current session as best effort,
          // but mark as NOT confident so SOS is NOT triggered (can't know the real relation).
          console.log(`[Baileys:${relationId}] ⚠ LID ${jid} not yet resolved, storing in current relation (no SOS)`);
          await persistMessage(msg, relationId, false, senderPhone, content, mediaData, sentAt, false);
          stored = true;
        } else {
          for (const [relId, relSession] of sessions.entries()) {
            const cp = relSession.contactPhone?.replace(/\D/g, "");
            if (phonesMatch(resolvedPhone, cp ?? "")) {
              console.log(`[Baileys:${relationId}→${relId}] Incoming from ${resolvedPhone} (matches ${cp}): "${content.slice(0, 60)}"`);
              // confident=true: phone matched exactly, safe to trigger SOS
              await persistMessage(msg, relId, false, senderPhone, content, mediaData, sentAt, true);
              stored = true;
            }
          }
        }

        if (!stored) {
          // No session matched the resolved phone — fall back to the current session.
          // NOT confident: don't trigger SOS, we don't know whose contact this is.
          const known = [...sessions.values()].map(s => s.contactPhone?.replace(/\D/g, "") ?? "?").join(", ");
          console.log(`[Baileys:${relationId}] ⚠ No match (fallback) — resolvedPhone=${resolvedPhone} | known: [${known}] — storing, no SOS`);
          await persistMessage(msg, relationId, false, senderPhone, content, mediaData, sentAt, false);
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
  sock.ev.on("messaging-history.set", async ({ messages, isLatest }) => {
    console.log(`[Baileys] history-set: ${messages.length} messages (isLatest=${isLatest}) for relation ${relationId}`);

    // Filter by requested history window
    const days = session.historyDays;
    let filtered = messages as WAMessage[];
    if (days !== undefined && days > 0) {
      const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
      filtered = filtered.filter((m) => {
        const ts = Number(m.messageTimestamp) * 1000;
        return ts >= cutoff;
      });
      console.log(`[Baileys] history-set: kept ${filtered.length}/${messages.length} within last ${days} days`);
    } else if (days === 0) {
      // User explicitly requested no history import
      console.log(`[Baileys] history-set: skipping (historyDays=0)`);
      return;
    }

    if (filtered.length === 0) {
      broadcastToSession(relationId, { type: "history-done", imported: 0 });
      return;
    }

    broadcastToSession(relationId, { type: "history-importing", total: filtered.length });
    // Skip audio transcription for history (too slow for bulk); store as [Message vocal]
    await storeMessages(filtered, true);
    session.historyImported = true;
    broadcastToSession(relationId, { type: "history-done", imported: filtered.length });
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

/** GET /api/relations/:id/whatsapp/qr  — SSE stream: qr | connected | history-importing | history-done | disconnected */
router.get("/relations/:id/whatsapp/qr", async (req, res) => {
  const relationId = Number(req.params.id);
  const contactPhone = (req.query.contactPhone as string | undefined)?.replace(/\D/g, "");
  const historyDays = req.query.historyDays !== undefined ? Number(req.query.historyDays) : undefined;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const client = {
    write: (data: string) => res.write(data),
    end: () => res.end(),
  };

  let session = sessions.get(relationId);
  const wantsHistoryImport = historyDays !== undefined && historyDays > 0;

  // If already connected and NO history import requested → confirm status immediately,
  // then keep the SSE connection open so the client receives future state changes
  // (e.g. session drops → "disconnected" event). The client is responsible for
  // closing when it no longer needs live updates.
  if (session?.status === "connected" && !wantsHistoryImport) {
    res.write(`data: ${JSON.stringify({ type: "connected" })}\n\n`);
    session.sseClients.add(client);
    req.on("close", () => { session?.sseClients.delete(client); });
    return;
  }

  // Start / restart logic:
  // - No session at all → start one
  // - Session is "disconnected" → restart (user retried after a drop)
  // - Session is "connected" and user wants history (and not yet imported) → restart with creds wipe
  // - Session is already "connecting" or "qr" → just subscribe, don't restart
  //   (handles browser SSE auto-reconnect after 5-min proxy timeout)
  const sessionBusy = session?.status === "connecting" || session?.status === "qr";

  if (!session || session.status === "disconnected") {
    await startSession(relationId, contactPhone, historyDays);
    session = sessions.get(relationId)!;
  } else if (wantsHistoryImport && session.status === "connected" && !session.historyImported && !session.historyDays) {
    // Connected, user wants history, not yet imported, and no history download already
    // in progress → restart with creds wipe so WhatsApp delivers history on fresh link.
    // Double guard:
    //   - historyImported: true once messages.history-set finished
    //   - historyDays already set: means startSession was already called with history
    //     (active download in progress). A bare SSE reconnect after the 5-min Replit
    //     proxy timeout must NOT re-trigger a creds wipe — it should just subscribe to
    //     the ongoing session and wait for the history-done event.
    await startSession(relationId, contactPhone, historyDays);
    session = sessions.get(relationId)!;
  } else if (!sessionBusy && contactPhone) {
    session.contactPhone = contactPhone;
    writeConfig(relationId, { contactPhone });
    if (historyDays !== undefined) session.historyDays = historyDays;
  }

  session.sseClients.add(client);

  // Immediately report current state to the new client (handles fast auto-reconnect)
  if (session.status === "connected") {
    if (session.historyImported) {
      // History already finished while the SSE was dropped — tell the reconnected client
      // so it doesn't sit waiting forever.
      res.write(`data: ${JSON.stringify({ type: "history-done", imported: 0 })}\n\n`);
    } else {
      res.write(`data: ${JSON.stringify({ type: "connected" })}\n\n`);
    }
  } else if (session.qr) {
    // QR already generated before this client connected
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

/** Send a message via the active WA session for a relation. Returns true if sent. */
export async function sendViaWA(relationId: number, text: string): Promise<boolean> {
  const session = sessions.get(relationId);
  if (!session || session.status !== "connected") return false;
  const phone = session.contactPhone?.replace(/\D/g, "");
  if (!phone) return false;
  const jid = `${phone}@s.whatsapp.net`;
  try {
    await session.socket.sendMessage(jid, { text });
    return true;
  } catch { return false; }
}

export default router;
