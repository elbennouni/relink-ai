import { Router } from "express";

const router = Router();

// Temporary public route to download the latest APK from GitHub
router.get("/download/apk", async (req, res) => {
  const token = process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
  if (!token) {
    res.status(503).json({ error: "GitHub token not configured" });
    return;
  }

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
  };

  // Artifact ID from the latest successful build
  const ARTIFACT_ID = "8502305785";

  try {
    // Get the redirect URL
    const zipRes = await fetch(
      `https://api.github.com/repos/elbennouni/relink-ai/actions/artifacts/${ARTIFACT_ID}/zip`,
      { headers, redirect: "manual" }
    );

    const redirectUrl = zipRes.headers.get("location");
    if (!redirectUrl) {
      res.status(502).json({ error: "Could not get download URL from GitHub" });
      return;
    }

    // Fetch the actual zip
    const fileRes = await fetch(redirectUrl);
    if (!fileRes.ok || !fileRes.body) {
      res.status(502).json({ error: "Failed to fetch APK from GitHub" });
      return;
    }

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", 'attachment; filename="relink-ai.zip"');

    const contentLength = fileRes.headers.get("content-length");
    if (contentLength) res.setHeader("Content-Length", contentLength);

    // Stream directly to client
    const reader = fileRes.body.getReader();
    const pump = async () => {
      const { done, value } = await reader.read();
      if (done) { res.end(); return; }
      res.write(Buffer.from(value));
      await pump();
    };
    await pump();
  } catch (err) {
    console.error("APK download error:", err);
    if (!res.headersSent) res.status(500).json({ error: "Download failed" });
  }
});

export default router;
