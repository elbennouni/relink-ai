import { Router, type IRouter } from "express";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  res.json({ status: "ok" });
});

// One-time setup: registers native app redirect URLs in the Clerk instance
// used by this server (sk_test_ in dev, sk_live_ in prod). Protected by
// SESSION_SECRET so it cannot be abused. Remove after use.
router.post("/setup-clerk-native", async (req, res) => {
  if (req.headers["x-setup-token"] !== process.env.SESSION_SECRET) {
    res.status(403).json({ error: "forbidden" }); return;
  }
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

export default router;
