import { Router } from "express";
import { db } from "@workspace/db";
import { relationsTable, whatsappMessagesTable, scheduledMessagesTable } from "@workspace/db";
import { count, eq, sql } from "drizzle-orm";
import { getAuth, clerkClient } from "@clerk/express";

const router = Router();

/** Middleware: only isAdmin users (publicMetadata.isAdmin = true) */
async function requireAdmin(req: any, res: any, next: any) {
  const auth = getAuth(req);
  if (!auth?.userId) { res.status(401).json({ error: "unauthorized" }); return; }
  const client = await clerkClient();
  const user = await client.users.getUser(auth.userId);
  if (!user.publicMetadata?.isAdmin) { res.status(403).json({ error: "forbidden" }); return; }
  next();
}

// ── GET /api/admin/stats ────────────────────────────────────────────────────
router.get("/admin/stats", requireAdmin, async (_req, res) => {
  try {
    const [relCount] = await db.select({ value: count() }).from(relationsTable);
    const [msgCount] = await db.select({ value: count() }).from(whatsappMessagesTable);
    const [schedCount] = await db.select({ value: count() }).from(scheduledMessagesTable);

    // User counts via Clerk
    const client = await clerkClient();
    const { totalCount } = await client.users.getCount({});
    // Count premium users (read first 500; adjust as you grow)
    const users = await client.users.getUserList({ limit: 500 });
    const premiumCount = users.data.filter((u) => u.publicMetadata?.isPremium).length;
    const adminCount = users.data.filter((u) => u.publicMetadata?.isAdmin).length;

    res.json({
      totalUsers: totalCount,
      premiumUsers: premiumCount,
      adminUsers: adminCount,
      totalRelations: relCount.value,
      totalMessages: msgCount.value,
      scheduledPending: schedCount.value,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── GET /api/admin/users ─────────────────────────────────────────────────────
router.get("/admin/users", requireAdmin, async (req, res) => {
  try {
    const client = await clerkClient();
    const page = Number(req.query.page ?? 1);
    const limit = 50;
    const offset = (page - 1) * limit;
    const { data: users, totalCount } = await client.users.getUserList({
      limit,
      offset,
      orderBy: "-created_at",
    });

    const mapped = users.map((u) => ({
      id: u.id,
      email: u.emailAddresses?.[0]?.emailAddress ?? "",
      firstName: u.firstName,
      lastName: u.lastName,
      imageUrl: u.imageUrl,
      createdAt: u.createdAt,
      lastSignInAt: u.lastSignInAt,
      isPremium: !!u.publicMetadata?.isPremium,
      isAdmin: !!u.publicMetadata?.isAdmin,
      noLimit: !!u.publicMetadata?.noLimit,
    }));

    res.json({ users: mapped, total: totalCount, page, limit });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── PATCH /api/admin/users/:userId/metadata ──────────────────────────────────
router.patch("/admin/users/:userId/metadata", requireAdmin, async (req, res) => {
  try {
    const client = await clerkClient();
    const { userId } = req.params;
    const { isPremium, isAdmin, noLimit } = req.body ?? {};

    const current = await client.users.getUser(userId);
    const merged = {
      ...current.publicMetadata,
      ...(isPremium !== undefined ? { isPremium: !!isPremium } : {}),
      ...(isAdmin !== undefined ? { isAdmin: !!isAdmin } : {}),
      ...(noLimit !== undefined ? { noLimit: !!noLimit } : {}),
    };

    await client.users.updateUserMetadata(userId, { publicMetadata: merged });
    res.json({ ok: true, metadata: merged });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── DELETE /api/admin/users/:userId ─────────────────────────────────────────
router.delete("/admin/users/:userId", requireAdmin, async (req, res) => {
  try {
    const client = await clerkClient();
    const { userId } = req.params;
    await client.users.deleteUser(userId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── POST /api/admin/setup-native-redirect ───────────────────────────────────
// One-time endpoint: registers the native app redirect URL in the Clerk
// instance that the current server uses (test in dev, live in prod).
// Uses the server-side CLERK_SECRET_KEY so it works with the live key in prod.
router.post("/admin/setup-native-redirect", requireAdmin, async (_req, res) => {
  const urls = [
    "relink-mobile://oauth-native-callback",
    "relink-mobile:///oauth-native-callback",
  ];
  const results: Record<string, unknown> = {};
  for (const url of urls) {
    try {
      const r = await fetch("https://api.clerk.com/v1/redirect_urls", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.CLERK_SECRET_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ url }),
      });
      results[url] = { status: r.status, body: await r.json() };
    } catch (e) {
      results[url] = { error: String(e) };
    }
  }
  res.json({ ok: true, results });
});

// ── GET /api/admin/offer ─────────────────────────────────────────────────────
router.get("/admin/offer", requireAdmin, async (_req, res) => {
  // For now offer config is environment-driven; returns current defaults
  res.json({
    monthlyPrice: Number(process.env.OFFER_MONTHLY_PRICE ?? 19),
    yearlyPrice: Number(process.env.OFFER_YEARLY_PRICE ?? 149),
    currency: process.env.OFFER_CURRENCY ?? "EUR",
    tagline: process.env.OFFER_TAGLINE ?? "Accès complet à toutes les fonctionnalités",
    earlyBirdLabel: process.env.OFFER_EARLY_BIRD_LABEL ?? "Offre de lancement",
  });
});

export default router;
