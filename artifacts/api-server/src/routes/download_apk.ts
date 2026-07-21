import { Router } from "express";
import fs from "fs";
import path from "path";

const router = Router();

const APK_CACHE = "/tmp/relink-ai.apk";

async function fetchAndCacheApk(): Promise<void> {
  const token = process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
  if (!token) throw new Error("No GitHub token");

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
  };

  // Get redirect URL for the artifact zip
  const res = await fetch(
    "https://api.github.com/repos/elbennouni/relink-ai/actions/artifacts/8502305785/zip",
    { headers, redirect: "manual" }
  );

  const redirectUrl = res.headers.get("location");
  if (!redirectUrl) throw new Error("No redirect URL from GitHub");

  // Download the zip
  const zipRes = await fetch(redirectUrl);
  if (!zipRes.ok || !zipRes.body) throw new Error("Failed to download zip");

  const zipPath = "/tmp/relink-apk.zip";
  const { createWriteStream } = await import("fs");
  const { pipeline } = await import("stream/promises");
  const { Readable } = await import("stream");

  const writer = createWriteStream(zipPath);
  // @ts-ignore
  await pipeline(Readable.fromWeb(zipRes.body), writer);

  // Extract APK from zip
  const { execSync } = await import("child_process");
  execSync(`unzip -o ${zipPath} -d /tmp/apk_extract`, { stdio: "pipe" });
  execSync(`mv /tmp/apk_extract/app-debug.apk ${APK_CACHE}`, { stdio: "pipe" });
  execSync(`rm -rf /tmp/apk_extract ${zipPath}`, { stdio: "pipe" });
}

// Public download route — no auth required
router.get("/download/apk", async (req, res) => {
  try {
    // Use cached file if available
    if (!fs.existsSync(APK_CACHE)) {
      res.setHeader("Content-Type", "text/plain");
      res.write("Préparation de l'APK en cours, réessaie dans 60 secondes...\n");
      res.end();
      // Trigger async download for next request
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

// Trigger pre-caching on startup
fetchAndCacheApk().catch(() => {
  console.log("[APK] Cache will be populated on first request");
});

export default router;
