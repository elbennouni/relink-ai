import { Router } from "express";
import { db } from "@workspace/db";
import { whatsappMessagesTable, relationsTable } from "@workspace/db";
import { eq, and, inArray, lt, desc, like, gte, count, max, min, sql } from "drizzle-orm";
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

  // Support multiple date/time formats across locales
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
      const date = new Date(
        `${year}-${m.padStart(2, "0")}-${d.padStart(2, "0")}T${h.padStart(2, "0")}:${min}:00`
      );
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

/** Batch-insert parsed messages, skipping duplicates via hash check. */
async function batchInsert(
  relationId: number,
  parsed: { sender: string; content: string; sentAt: Date; isMe: boolean }[],
  importSource: string
): Promise<{ imported: number; duplicates: number; dates: Date[] }> {
  if (parsed.length === 0) return { imported: 0, duplicates: 0, dates: [] };

  // Build hash → message map
  const withHash = parsed.map((m) => ({
    ...m,
    hash: hashMessage(m.sender, m.content, m.sentAt),
  }));
  const allHashes = withHash.map((m) => m.hash);

  // Single query to find already-stored hashes — chunk to avoid hitting param limits
  const CHUNK = 500;
  const existingHashes = new Set<string>();
  for (let i = 0; i < allHashes.length; i += CHUNK) {
    const slice = allHashes.slice(i, i + CHUNK);
    const rows = await db
      .select({ h: whatsappMessagesTable.contentHash })
      .from(whatsappMessagesTable)
      .where(
        and(
          eq(whatsappMessagesTable.relationId, relationId),
          inArray(whatsappMessagesTable.contentHash, slice)
        )
      );
    rows.forEach((r) => { if (r.h) existingHashes.add(r.h); });
  }

  const toInsert = withHash.filter((m) => !existingHashes.has(m.hash));
  const dates: Date[] = [];

  // Batch-insert in chunks of 500 rows
  for (let i = 0; i < toInsert.length; i += CHUNK) {
    const slice = toInsert.slice(i, i + CHUNK);
    await db.insert(whatsappMessagesTable).values(
      slice.map((m) => ({
        relationId,
        sender: m.sender,
        content: m.content,
        isMe: m.isMe,
        sentAt: m.sentAt,
        importSource,
        contentHash: m.hash,
      }))
    ).onConflictDoNothing();
    slice.forEach((m) => dates.push(m.sentAt));
  }

  return {
    imported: toInsert.length,
    duplicates: withHash.length - toInsert.length,
    dates,
  };
}

function dateRange(dates: Date[]) {
  if (!dates.length) return { from: null, to: null };
  const sorted = [...dates].sort((a, b) => a.getTime() - b.getTime());
  return {
    from: sorted[0].toISOString().split("T")[0],
    to: sorted[sorted.length - 1].toISOString().split("T")[0],
  };
}

// ── Import endpoints ──────────────────────────────────────────────────────────

// POST /api/relations/:relationId/import/whatsapp  (file content as text)
router.post("/relations/:relationId/import/whatsapp", async (req, res) => {
  const relationId = Number(req.params.relationId);
  if (isNaN(relationId)) { res.status(400).json({ error: "ID invalide" }); return; }

  const [relation] = await db
    .select()
    .from(relationsTable)
    .where(eq(relationsTable.id, relationId))
    .limit(1);
  if (!relation) { res.status(404).json({ error: "Relation introuvable" }); return; }

  const { content } = req.body;
  if (!content || typeof content !== "string") {
    res.status(400).json({ error: "Impossible de lire ce fichier." });
    return;
  }

  const parsed = parseWhatsappExport(content, relation.participantMe);
  if (parsed.length === 0) {
    res.status(400).json({ error: "Aucun message détecté. Vérifiez le format de l'export." });
    return;
  }

  const { imported, duplicates, dates } = await batchInsert(relationId, parsed, "whatsapp_file");
  const [stats] = await db
    .select({ count: count() })
    .from(whatsappMessagesTable)
    .where(eq(whatsappMessagesTable.relationId, relationId));

  res.json({ imported, duplicates, totalMessages: stats?.count ?? 0, dateRange: dateRange(dates) });
});

// POST /api/relations/:relationId/import/paste
router.post("/relations/:relationId/import/paste", async (req, res) => {
  const relationId = Number(req.params.relationId);
  if (isNaN(relationId)) { res.status(400).json({ error: "ID invalide" }); return; }

  const { text, participantMe } = req.body;
  if (!text || typeof text !== "string") {
    res.status(400).json({ error: "Aucun texte fourni." });
    return;
  }

  const parsed = parseWhatsappExport(text, participantMe);
  if (parsed.length === 0) {
    res.status(400).json({ error: "Aucun message détecté. Vérifiez le format du texte collé." });
    return;
  }

  const { imported, duplicates, dates } = await batchInsert(relationId, parsed, "paste");
  const [stats] = await db
    .select({ count: count() })
    .from(whatsappMessagesTable)
    .where(eq(whatsappMessagesTable.relationId, relationId));

  res.json({ imported, duplicates, totalMessages: stats?.count ?? 0, dateRange: dateRange(dates) });
});

// POST /api/relations/:relationId/import/screenshot  (Claude OCR)
router.post("/relations/:relationId/import/screenshot", async (req, res) => {
  const relationId = Number(req.params.relationId);
  if (isNaN(relationId)) { res.status(400).json({ error: "ID invalide" }); return; }

  const { imageBase64, mimeType = "image/jpeg" } = req.body;
  if (!imageBase64) { res.status(400).json({ error: "Aucune image fournie." }); return; }

  const [relation] = await db
    .select()
    .from(relationsTable)
    .where(eq(relationsTable.id, relationId))
    .limit(1);
  if (!relation) { res.status(404).json({ error: "Relation introuvable" }); return; }

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 8192,
    messages: [{
      role: "user",
      content: [
        {
          type: "image",
          source: {
            type: "base64",
            media_type: mimeType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
            data: imageBase64,
          },
        },
        {
          type: "text",
          text: `Extract all WhatsApp messages from this screenshot. Return a JSON array of objects: { "sender": string, "content": string, "timestamp": string|null, "isMe": boolean }. Sender "${relation.participantMe}" means isMe=true. Return only the JSON array.`,
        },
      ],
    }],
  });

  const block = response.content[0];
  const rawText = block.type === "text" ? block.text : "[]";

  let messages: { sender: string; content: string; timestamp: string | null; isMe: boolean }[] = [];
  try {
    const jsonMatch = rawText.match(/\[[\s\S]*\]/);
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
    needsReview: extracted.some((m) => !m.timestamp),
  });
});

// POST /api/relations/:relationId/import/screenshot/confirm
router.post("/relations/:relationId/import/screenshot/confirm", async (req, res) => {
  const relationId = Number(req.params.relationId);
  if (isNaN(relationId)) { res.status(400).json({ error: "ID invalide" }); return; }

  const { messages, defaultDate } = req.body;
  if (!Array.isArray(messages)) { res.status(400).json({ error: "Messages invalides." }); return; }

  const baseDate = defaultDate ? new Date(defaultDate) : new Date();
  const parsed = messages.map((m: any, i: number) => ({
    sender: m.sender,
    content: m.content,
    isMe: m.isMe ?? false,
    sentAt: m.timestamp ? new Date(m.timestamp) : new Date(baseDate.getTime() + i * 60000),
  }));

  const { imported, duplicates } = await batchInsert(relationId, parsed, "screenshot");
  const [stats] = await db
    .select({ count: count() })
    .from(whatsappMessagesTable)
    .where(eq(whatsappMessagesTable.relationId, relationId));

  res.json({
    imported,
    duplicates,
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
  const hash = hashMessage(body.data.sender, body.data.content, sentAt);

  const [msg] = await db
    .insert(whatsappMessagesTable)
    .values({
      relationId,
      sender: body.data.sender,
      content: body.data.content,
      isMe: body.data.isMe,
      sentAt,
      importSource: "manual",
      contentHash: hash,
    })
    .onConflictDoNothing()
    .returning();

  if (!msg) {
    // Was a duplicate
    res.status(200).json({ duplicate: true });
    return;
  }

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
    query = query.where(
      and(gte(whatsappMessagesTable.sentAt, d), lt(whatsappMessagesTable.sentAt, next))
    ) as typeof query;
  }

  const messages = await query
    .orderBy(desc(whatsappMessagesTable.sentAt))
    .limit(limit + 1);

  const hasMore = messages.length > limit;
  const items = hasMore ? messages.slice(0, limit) : messages;

  const [total] = await db
    .select({ count: count() })
    .from(whatsappMessagesTable)
    .where(eq(whatsappMessagesTable.relationId, relationId));

  res.json({
    messages: items
      .map((m) => ({
        id: m.id,
        relationId: m.relationId,
        sender: m.sender,
        content: m.content,
        isMe: m.isMe,
        sentAt: m.sentAt,
        importSource: m.importSource,
      }))
      .reverse(),
    nextCursor: hasMore ? items[items.length - 1].sentAt.toISOString() : null,
    total: total?.count ?? 0,
  });
});

// GET /api/relations/:relationId/messages/stats  (pure SQL, no full table scan in memory)
router.get("/relations/:relationId/messages/stats", async (req, res) => {
  const relationId = Number(req.params.relationId);
  if (isNaN(relationId)) { res.status(400).json({ error: "ID invalide" }); return; }

  const [totRow] = await db
    .select({ count: count() })
    .from(whatsappMessagesTable)
    .where(eq(whatsappMessagesTable.relationId, relationId));

  const total = totRow?.count ?? 0;
  if (!total) {
    res.json({ total: 0, byParticipant: {}, dateRange: { from: null, to: null }, daysWithMessages: 0 });
    return;
  }

  const [minRow] = await db
    .select({ d: min(whatsappMessagesTable.sentAt) })
    .from(whatsappMessagesTable)
    .where(eq(whatsappMessagesTable.relationId, relationId));

  const [maxRow] = await db
    .select({ d: max(whatsappMessagesTable.sentAt) })
    .from(whatsappMessagesTable)
    .where(eq(whatsappMessagesTable.relationId, relationId));

  const bySender = await db
    .select({ sender: whatsappMessagesTable.sender, cnt: count() })
    .from(whatsappMessagesTable)
    .where(eq(whatsappMessagesTable.relationId, relationId))
    .groupBy(whatsappMessagesTable.sender);

  const [daysRow] = await db
    .select({ days: sql<number>`COUNT(DISTINCT DATE(${whatsappMessagesTable.sentAt}))` })
    .from(whatsappMessagesTable)
    .where(eq(whatsappMessagesTable.relationId, relationId));

  const byParticipant: Record<string, number> = {};
  bySender.forEach((r) => { byParticipant[r.sender] = r.cnt; });

  res.json({
    total,
    byParticipant,
    dateRange: {
      from: minRow?.d?.toISOString().split("T")[0] ?? null,
      to: maxRow?.d?.toISOString().split("T")[0] ?? null,
    },
    daysWithMessages: Number(daysRow?.days ?? 0),
  });
});

export default router;
