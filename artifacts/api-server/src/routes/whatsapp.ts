import { Router } from "express";
import { db } from "@workspace/db";
import { whatsappMessagesTable, relationsTable } from "@workspace/db";
import { eq, and, like, gte, lte, lt, desc, count, max, min, sql } from "drizzle-orm";
import { z } from "zod";
import crypto from "crypto";
import { anthropic } from "@workspace/integrations-anthropic-ai";

const router = Router();

// ── Helpers ──────────────────────────────────────────────────────────────────

function hashMessage(sender: string, content: string, sentAt: Date): string {
  return crypto
    .createHash("sha256")
    .update(`${sender}|${content}|${sentAt.toISOString()}`)
    .digest("hex")
    .slice(0, 16);
}

/** Parse WhatsApp export text into messages */
function parseWhatsappExport(text: string, participantMe?: string): {
  sender: string; content: string; sentAt: Date; isMe: boolean;
}[] {
  const lines = text.split("\n");
  const results: { sender: string; content: string; sentAt: Date; isMe: boolean }[] = [];

  // Support both formats: [DD/MM/YYYY, HH:MM] and DD/MM/YYYY HH:MM
  const headerRe = /^[\[‎]?(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})[,\s]+(\d{1,2}):(\d{2})(?::?\d{2})?[\]‎]?\s*[-–]\s*([^:]+):\s*(.*)/;

  let current: { sender: string; content: string; sentAt: Date } | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const match = line.match(headerRe);
    if (match) {
      if (current) {
        results.push({
          ...current,
          isMe: participantMe
            ? current.sender.toLowerCase().trim() === participantMe.toLowerCase().trim()
            : results.length % 2 === 1,
        });
      }
      const [, d, m, y, h, min, sender, content] = match;
      const year = y.length === 2 ? `20${y}` : y;
      const date = new Date(`${year}-${m.padStart(2, "0")}-${d.padStart(2, "0")}T${h.padStart(2, "0")}:${min}:00`);
      current = { sender: sender.trim(), content: content.trim(), sentAt: date };
    } else if (current && line && !line.startsWith("‎")) {
      current.content += "\n" + line;
    }
  }

  if (current) {
    results.push({
      ...current,
      isMe: participantMe
        ? current.sender.toLowerCase().trim() === participantMe.toLowerCase().trim()
        : false,
    });
  }

  return results;
}

// ── Import endpoints ──────────────────────────────────────────────────────────

// POST /api/relations/:relationId/import/whatsapp
router.post("/relations/:relationId/import/whatsapp", async (req, res) => {
  const relationId = Number(req.params.relationId);
  if (isNaN(relationId)) { res.status(400).json({ error: "ID invalide" }); return; }

  const [relation] = await db.select().from(relationsTable).where(eq(relationsTable.id, relationId)).limit(1);
  if (!relation) { res.status(404).json({ error: "Relation introuvable" }); return; }

  const { content } = req.body;
  if (!content || typeof content !== "string") {
    res.status(400).json({ error: "Impossible de lire ce fichier." });
    return;
  }

  const parsed = parseWhatsappExport(content, relation.participantMe);
  if (parsed.length === 0) {
    res.status(400).json({ error: "Aucun message détecté." });
    return;
  }

  let imported = 0, duplicates = 0;
  const dates: Date[] = [];

  for (const msg of parsed) {
    const hash = hashMessage(msg.sender, msg.content, msg.sentAt);
    const [existing] = await db
      .select({ id: whatsappMessagesTable.id })
      .from(whatsappMessagesTable)
      .where(and(eq(whatsappMessagesTable.relationId, relationId), eq(whatsappMessagesTable.contentHash, hash)))
      .limit(1);

    if (existing) { duplicates++; continue; }

    await db.insert(whatsappMessagesTable).values({
      relationId,
      sender: msg.sender,
      content: msg.content,
      isMe: msg.isMe,
      sentAt: msg.sentAt,
      importSource: "whatsapp_file",
      contentHash: hash,
    });
    imported++;
    dates.push(msg.sentAt);
  }

  const [stats] = await db.select({ count: count() }).from(whatsappMessagesTable).where(eq(whatsappMessagesTable.relationId, relationId));

  res.json({
    imported,
    duplicates,
    totalMessages: stats?.count ?? 0,
    dateRange: {
      from: dates.length ? dates.reduce((a, b) => a < b ? a : b).toISOString().split("T")[0] : null,
      to: dates.length ? dates.reduce((a, b) => a > b ? a : b).toISOString().split("T")[0] : null,
    },
  });
});

// POST /api/relations/:relationId/import/paste
router.post("/relations/:relationId/import/paste", async (req, res) => {
  const relationId = Number(req.params.relationId);
  if (isNaN(relationId)) { res.status(400).json({ error: "ID invalide" }); return; }

  const { text, participantMe, participantOther } = req.body;
  if (!text) { res.status(400).json({ error: "Aucun texte fourni." }); return; }

  const parsed = parseWhatsappExport(text, participantMe);

  let imported = 0, duplicates = 0;
  const dates: Date[] = [];

  for (const msg of parsed) {
    const hash = hashMessage(msg.sender, msg.content, msg.sentAt);
    const [existing] = await db
      .select({ id: whatsappMessagesTable.id })
      .from(whatsappMessagesTable)
      .where(and(eq(whatsappMessagesTable.relationId, relationId), eq(whatsappMessagesTable.contentHash, hash)))
      .limit(1);

    if (existing) { duplicates++; continue; }

    await db.insert(whatsappMessagesTable).values({
      relationId,
      sender: msg.sender,
      content: msg.content,
      isMe: msg.isMe,
      sentAt: msg.sentAt,
      importSource: "paste",
      contentHash: hash,
    });
    imported++;
    dates.push(msg.sentAt);
  }

  const [stats] = await db.select({ count: count() }).from(whatsappMessagesTable).where(eq(whatsappMessagesTable.relationId, relationId));

  res.json({
    imported,
    duplicates,
    totalMessages: stats?.count ?? 0,
    dateRange: {
      from: dates.length ? dates.reduce((a, b) => a < b ? a : b).toISOString().split("T")[0] : null,
      to: dates.length ? dates.reduce((a, b) => a > b ? a : b).toISOString().split("T")[0] : null,
    },
  });
});

// POST /api/relations/:relationId/import/screenshot
router.post("/relations/:relationId/import/screenshot", async (req, res) => {
  const relationId = Number(req.params.relationId);
  if (isNaN(relationId)) { res.status(400).json({ error: "ID invalide" }); return; }

  const { imageBase64, mimeType = "image/jpeg" } = req.body;
  if (!imageBase64) { res.status(400).json({ error: "La capture doit être vérifiée." }); return; }

  const [relation] = await db.select().from(relationsTable).where(eq(relationsTable.id, relationId)).limit(1);
  if (!relation) { res.status(404).json({ error: "Relation introuvable" }); return; }

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 8192,
    messages: [{
      role: "user",
      content: [
        {
          type: "image",
          source: { type: "base64", media_type: mimeType as "image/jpeg" | "image/png" | "image/gif" | "image/webp", data: imageBase64 },
        },
        {
          type: "text",
          text: `Extract all WhatsApp messages from this screenshot. Return a JSON array with objects: { "sender": string, "content": string, "timestamp": string|null, "isMe": boolean }. Sender "${relation.participantMe}" is isMe=true. Only return the JSON array, no other text.`,
        },
      ],
    }],
  });

  const block = response.content[0];
  const text = block.type === "text" ? block.text : "[]";

  let messages: { sender: string; content: string; timestamp: string | null; isMe: boolean }[] = [];
  try {
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    messages = jsonMatch ? JSON.parse(jsonMatch[0]) : [];
  } catch {
    messages = [];
  }

  const extracted = messages.map((m, i) => ({
    tempId: `ocr-${Date.now()}-${i}`,
    sender: m.sender || "Inconnu",
    content: m.content || "",
    timestamp: m.timestamp || null,
    isMe: m.isMe ?? false,
  }));

  res.json({
    extractedMessages: extracted,
    confidence: extracted.length > 0 ? 0.85 : 0.3,
    needsReview: extracted.some(m => !m.timestamp),
  });
});

// POST /api/relations/:relationId/import/screenshot/confirm
router.post("/relations/:relationId/import/screenshot/confirm", async (req, res) => {
  const relationId = Number(req.params.relationId);
  if (isNaN(relationId)) { res.status(400).json({ error: "ID invalide" }); return; }

  const { messages, defaultDate } = req.body;
  if (!Array.isArray(messages)) { res.status(400).json({ error: "Messages invalides." }); return; }

  let imported = 0;
  const baseDate = defaultDate ? new Date(defaultDate) : new Date();

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    const sentAt = m.timestamp ? new Date(m.timestamp) : new Date(baseDate.getTime() + i * 60000);
    const hash = hashMessage(m.sender, m.content, sentAt);

    await db.insert(whatsappMessagesTable).values({
      relationId,
      sender: m.sender,
      content: m.content,
      isMe: m.isMe,
      sentAt,
      importSource: "screenshot",
      contentHash: hash,
    }).onConflictDoNothing();

    imported++;
  }

  const [stats] = await db.select({ count: count() }).from(whatsappMessagesTable).where(eq(whatsappMessagesTable.relationId, relationId));

  res.json({
    imported,
    duplicates: messages.length - imported,
    totalMessages: stats?.count ?? 0,
    dateRange: { from: null, to: null },
  });
});

// POST /api/relations/:relationId/import/manual
router.post("/relations/:relationId/import/manual", async (req, res) => {
  const relationId = Number(req.params.relationId);
  if (isNaN(relationId)) { res.status(400).json({ error: "ID invalide" }); return; }

  const body = z.object({
    sender: z.string().min(1),
    content: z.string().min(1),
    isMe: z.boolean(),
    sentAt: z.string(),
  }).safeParse(req.body);

  if (!body.success) { res.status(400).json({ error: "Données invalides." }); return; }

  const sentAt = new Date(body.data.sentAt);

  const [msg] = await db.insert(whatsappMessagesTable).values({
    relationId,
    sender: body.data.sender,
    content: body.data.content,
    isMe: body.data.isMe,
    sentAt,
    importSource: "manual",
    contentHash: hashMessage(body.data.sender, body.data.content, sentAt),
  }).returning();

  res.status(201).json({
    id: msg.id,
    relationId: msg.relationId,
    sender: msg.sender,
    content: msg.content,
    isMe: msg.isMe,
    sentAt: msg.sentAt,
    importSource: msg.importSource,
  });
});

// ── Message listing ───────────────────────────────────────────────────────────

// GET /api/relations/:relationId/messages
router.get("/relations/:relationId/messages", async (req, res) => {
  const relationId = Number(req.params.relationId);
  if (isNaN(relationId)) { res.status(400).json({ error: "ID invalide" }); return; }

  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const cursor = req.query.cursor as string | undefined;
  const search = req.query.search as string | undefined;
  const dateFilter = req.query.date as string | undefined;

  let query = db
    .select()
    .from(whatsappMessagesTable)
    .where(eq(whatsappMessagesTable.relationId, relationId))
    .$dynamic();

  if (cursor) {
    query = query.where(lt(whatsappMessagesTable.sentAt, new Date(cursor))) as typeof query;
  }

  if (search) {
    query = query.where(like(whatsappMessagesTable.content, `%${search}%`)) as typeof query;
  }

  if (dateFilter) {
    const d = new Date(dateFilter);
    const next = new Date(d);
    next.setDate(next.getDate() + 1);
    query = query.where(and(gte(whatsappMessagesTable.sentAt, d), lt(whatsappMessagesTable.sentAt, next))) as typeof query;
  }

  const messages = await query
    .orderBy(desc(whatsappMessagesTable.sentAt))
    .limit(limit + 1);

  const hasMore = messages.length > limit;
  const items = hasMore ? messages.slice(0, limit) : messages;

  const [total] = await db.select({ count: count() }).from(whatsappMessagesTable).where(eq(whatsappMessagesTable.relationId, relationId));

  res.json({
    messages: items.map(m => ({
      id: m.id,
      relationId: m.relationId,
      sender: m.sender,
      content: m.content,
      isMe: m.isMe,
      sentAt: m.sentAt,
      importSource: m.importSource,
    })).reverse(),
    nextCursor: hasMore ? items[items.length - 1].sentAt.toISOString() : null,
    total: total?.count ?? 0,
  });
});

// GET /api/relations/:relationId/messages/stats
router.get("/relations/:relationId/messages/stats", async (req, res) => {
  const relationId = Number(req.params.relationId);
  if (isNaN(relationId)) { res.status(400).json({ error: "ID invalide" }); return; }

  const messages = await db
    .select()
    .from(whatsappMessagesTable)
    .where(eq(whatsappMessagesTable.relationId, relationId))
    .orderBy(whatsappMessagesTable.sentAt);

  if (!messages.length) {
    res.json({
      total: 0,
      byParticipant: {},
      dateRange: { from: null, to: null },
      avgResponseTimeMinutes: null,
      daysWithMessages: 0,
    });
    return;
  }

  const byParticipant: Record<string, number> = {};
  const days = new Set<string>();

  for (const m of messages) {
    byParticipant[m.sender] = (byParticipant[m.sender] ?? 0) + 1;
    days.add(m.sentAt.toISOString().split("T")[0]);
  }

  const [minDate] = await db.select({ d: min(whatsappMessagesTable.sentAt) }).from(whatsappMessagesTable).where(eq(whatsappMessagesTable.relationId, relationId));
  const [maxDate] = await db.select({ d: max(whatsappMessagesTable.sentAt) }).from(whatsappMessagesTable).where(eq(whatsappMessagesTable.relationId, relationId));

  res.json({
    total: messages.length,
    byParticipant,
    dateRange: {
      from: minDate?.d?.toISOString().split("T")[0] ?? null,
      to: maxDate?.d?.toISOString().split("T")[0] ?? null,
    },
    avgResponseTimeMinutes: null,
    daysWithMessages: days.size,
  });
});

export default router;
