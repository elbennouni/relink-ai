import { Router } from "express";
import { db, pushTokensTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

const router = Router();

/**
 * POST /api/push-token
 * Register or refresh an Expo push token for the authenticated user.
 * Body: { token: string, platform?: "ios" | "android" | "web" }
 */
router.post("/push-token", async (req, res) => {
  const userId = (req as any).userId as string;
  const { token, platform } = req.body as { token?: string; platform?: string };

  if (!token || !token.startsWith("ExponentPushToken[")) {
    res.status(400).json({ error: "Token Expo invalide" });
    return;
  }

  try {
    await db
      .insert(pushTokensTable)
      .values({ userId, token, platform: platform ?? null, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: pushTokensTable.token,
        set: { userId, platform: platform ?? null, updatedAt: new Date() },
      });
    res.json({ ok: true });
  } catch (err) {
    console.error("[PushToken] Error saving token:", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

/**
 * DELETE /api/push-token
 * Unregister the push token on sign-out.
 * Body: { token: string }
 */
router.delete("/push-token", async (req, res) => {
  const userId = (req as any).userId as string;
  const { token } = req.body as { token?: string };
  if (!token) { res.status(400).json({ error: "Token manquant" }); return; }

  await db
    .delete(pushTokensTable)
    .where(and(eq(pushTokensTable.token, token), eq(pushTokensTable.userId, userId)));
  res.json({ ok: true });
});

export default router;
