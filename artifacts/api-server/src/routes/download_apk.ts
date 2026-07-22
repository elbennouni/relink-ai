import { Router } from "express";
import fs from "fs";

const router = Router();

const APK_CACHE = "/tmp/relink-ai.apk";

// EAS build URL — update this after each new build
const EAS_APK_URL =
  "https://expo.dev/artifacts/eas/aewTgiNz7O81oOOYoW5oMhjM4rpgSa9dgjSc3in68c4.apk";

async function fetchAndCacheApk(): Promise<void> {
  const res = await fetch(EAS_APK_URL, { redirect: "follow" });
  if (!res.ok || !res.body) throw new Error(`EAS fetch failed: ${res.status}`);

  const { createWriteStream } = await import("fs");
  const { pipeline } = await import("stream/promises");
  const { Readable } = await import("stream");

  const writer = createWriteStream(APK_CACHE);
  // @ts-ignore
  await pipeline(Readable.fromWeb(res.body), writer);
}

// Public download route — no auth required
router.get("/download/apk", async (req, res) => {
  try {
    if (!fs.existsSync(APK_CACHE)) {
      res.setHeader("Content-Type", "text/plain");
      res.write("Préparation de l'APK en cours, réessaie dans 60 secondes…\n");
      res.end();
      fetchAndCacheApk().catch(console.error);
      return;
    }

    const stat = fs.statSync(APK_CACHE);
    res.setHeader("Content-Type", "application/vnd.android.package-archive");
    res.setHeader("Content-Disposition", 'attachment; filename="relink-ai.apk"');
    res.setHeader("Content-Length", stat.size);
    fs.createReadStream(APK_CACHE).pipe(res);
  } catch (err) {
    console.error("APK download error:", err);
    if (!res.headersSent) res.status(500).json({ error: "Download failed" });
  }
});

// Pre-cache on startup
fetchAndCacheApk().catch(() => {
  console.log("[APK] Cache will be populated on first request");
});

export default router;
