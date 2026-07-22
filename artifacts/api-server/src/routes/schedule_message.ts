import { Router } from "express";
import { db } from "@workspace/db";
import { scheduledMessagesTable, relationsTable, whatsappMessagesTable } from "@workspace/db";
import { eq, and, lte, desc } from "drizzle-orm";
import { getAuth } from "@clerk/express";
import { sendViaWA } from "./whatsapp_baileys";

const router = Router();

// POST /api/relations/:id/messages/schedule
router.post("/relations/:id/messages/schedule", async (req, res) => {
  const auth = getAuth(req);
  const userId = auth?.userId;
  if (!userId) { res.status(401).json({ error: "unauthorized" }); return; }

  const relationId = Number(req.params.id);
  if (isNaN(relationId)) { res.status(400).json({ error: "invalid id" }); return; }

  const { content, delayMinutes } = req.body ?? {};
  if (!content?.trim()) { res.status(400).json({ error: "content required" }); return; }

  const allowed = [30, 120, 300];
  const delay = Number(delayMinutes);
  if (!allowed.includes(delay)) {
    res.status(400).json({ error: "delayMinutes must be 30, 120 or 300" });
    return;
  }

  const [relation] = await db.select().from(relationsTable).where(
    and(eq(relationsTable.id, relationId), eq(relationsTable.userId, userId))
  ).limit(1);
  if (!relation) { res.status(404).json({ error: "relation not found" }); return; }

  const scheduledAt = new Date(Date.now() + delay * 60 * 1000);
  const [msg] = await db.insert(scheduledMessagesTable).values({
    userId, relationId, content: content.trim(), scheduledAt, status: "pending",
  }).returning();

  res.json({ id: msg.id, content: msg.content, scheduledAt: msg.scheduledAt, delayMinutes: delay });
});

// GET /api/relations/:id/messages/scheduled
router.get("/relations/:id/messages/scheduled", async (req, res) => {
  const auth = getAuth(req);
  const userId = auth?.userId;
  if (!userId) { res.status(401).json({ error: "unauthorized" }); return; }

  const relationId = Number(req.params.id);
  if (isNaN(relationId)) { res.status(400).json({ error: "invalid id" }); return; }

  const msgs = await db.select().from(scheduledMessagesTable).where(
    and(
      eq(scheduledMessagesTable.userId, userId),
      eq(scheduledMessagesTable.relationId, relationId),
      eq(scheduledMessagesTable.status, "pending"),
    )
  ).orderBy(desc(scheduledMessagesTable.scheduledAt));

  res.json({ scheduled: msgs });
});

// DELETE /api/relations/:id/messages/scheduled/:msgId
router.delete("/relations/:id/messages/scheduled/:msgId", async (req, res) => {
  const auth = getAuth(req);
  const userId = auth?.userId;
  if (!userId) { res.status(401).json({ error: "unauthorized" }); return; }

  const msgId = Number(req.params.msgId);
  if (isNaN(msgId)) { res.status(400).json({ error: "invalid msgId" }); return; }

  await db.update(scheduledMessagesTable).set({ status: "cancelled" }).where(
    and(
      eq(scheduledMessagesTable.id, msgId),
      eq(scheduledMessagesTable.userId, userId),
      eq(scheduledMessagesTable.status, "pending"),
    )
  );

  res.json({ ok: true });
});

// GET /api/relations/:id/messages/sos-pending
// Returns the oldest pending-approval SOS message waiting for confirmation.
router.get("/relations/:id/messages/sos-pending", async (req, res) => {
  const auth = getAuth(req);
  const userId = auth?.userId;
  if (!userId) { res.status(401).json({ error: "unauthorized" }); return; }

  const relationId = Number(req.params.id);
  if (isNaN(relationId)) { res.status(400).json({ error: "invalid id" }); return; }

  const msgs = await db.select().from(scheduledMessagesTable).where(
    and(
      eq(scheduledMessagesTable.userId, userId),
      eq(scheduledMessagesTable.relationId, relationId),
      eq(scheduledMessagesTable.status, "pending-approval"),
    )
  ).orderBy(desc(scheduledMessagesTable.createdAt)).limit(1);

  res.json({ pendingApproval: msgs[0] ?? null });
});

// POST /api/relations/:id/messages/scheduled/:msgId/approve
// User confirms: move from pending-approval → pending (will be sent by the job)
router.post("/relations/:id/messages/scheduled/:msgId/approve", async (req, res) => {
  const auth = getAuth(req);
  const userId = auth?.userId;
  if (!userId) { res.status(401).json({ error: "unauthorized" }); return; }

  const msgId = Number(req.params.msgId);
  if (isNaN(msgId)) { res.status(400).json({ error: "invalid msgId" }); return; }

  await db.update(scheduledMessagesTable).set({ status: "pending" }).where(
    and(
      eq(scheduledMessagesTable.id, msgId),
      eq(scheduledMessagesTable.userId, userId),
      eq(scheduledMessagesTable.status, "pending-approval"),
    )
  );

  res.json({ ok: true });
});

// POST /api/relations/:id/messages/scheduled/:msgId/cancel-sos
// User dismisses: cancel a pending-approval SOS message
router.post("/relations/:id/messages/scheduled/:msgId/cancel-sos", async (req, res) => {
  const auth = getAuth(req);
  const userId = auth?.userId;
  if (!userId) { res.status(401).json({ error: "unauthorized" }); return; }

  const msgId = Number(req.params.msgId);
  if (isNaN(msgId)) { res.status(400).json({ error: "invalid msgId" }); return; }

  await db.update(scheduledMessagesTable).set({ status: "cancelled" }).where(
    and(
      eq(scheduledMessagesTable.id, msgId),
      eq(scheduledMessagesTable.userId, userId),
      eq(scheduledMessagesTable.status, "pending-approval"),
    )
  );

  res.json({ ok: true });
});

// Helper exported for other routes: cancel all pending-approval SOS messages
// for a relation when the user decides to reply manually.
export async function cancelSosPendingApproval(relationId: number, userId: string) {
  await db.update(scheduledMessagesTable)
    .set({ status: "cancelled" })
    .where(
      and(
        eq(scheduledMessagesTable.userId, userId),
        eq(scheduledMessagesTable.relationId, relationId),
        eq(scheduledMessagesTable.status, "pending-approval"),
      )
    );
}

// ─── Background sender job ────────────────────────────────────────────────────
export function startScheduledMessageJob() {
  const run = async () => {
    try {
      const now = new Date();
      const due = await db.select().from(scheduledMessagesTable).where(
        and(eq(scheduledMessagesTable.status, "pending"), lte(scheduledMessagesTable.scheduledAt, now))
      );

      for (const msg of due) {
        let sent = false;
        try { sent = await sendViaWA(msg.relationId, msg.content); } catch { /* fall through */ }

        if (!sent) {
          // Fallback: store as a manual isMe message in the conversation
          try {
            await db.insert(whatsappMessagesTable).values({
              relationId: msg.relationId,
              sender: "Moi",
              content: msg.content,
              isMe: true,
              sentAt: new Date(),
              importSource: "scheduled",
            } as any);
          } catch { /* best effort */ }
        }

        await db.update(scheduledMessagesTable)
          .set({ status: "sent", sentAt: new Date() })
          .where(eq(scheduledMessagesTable.id, msg.id));

        console.log(`[Scheduled] Sent msg ${msg.id} to relation ${msg.relationId} via ${sent ? "WA" : "DB"}`);
      }
    } catch (err) {
      console.error("[ScheduledMsg job]", err);
    }
  };

  run();
  const interval = setInterval(run, 60_000);
  return () => clearInterval(interval);
}

export default router;
