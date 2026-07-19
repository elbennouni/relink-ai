import { Router } from "express";
import multer from "multer";
import { openai } from "@workspace/integrations-openai-ai-server";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

router.post("/transcribe", upload.single("audio"), async (req, res) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: "Aucun fichier audio fourni" });
      return;
    }

    const mimeType = req.file.mimetype || "audio/webm";
    const ext = mimeType.includes("ogg") ? "ogg"
      : mimeType.includes("mp4") ? "mp4"
      : mimeType.includes("wav") ? "wav"
      : mimeType.includes("mpeg") || mimeType.includes("mp3") ? "mp3"
      : "webm";

    const file = new File([req.file.buffer], `audio.${ext}`, { type: mimeType });

    const result = await openai.audio.transcriptions.create({
      model: "gpt-4o-mini-transcribe",
      file,
      response_format: "json",
      language: "fr",
    });

    res.json({ text: result.text });
  } catch (err) {
    console.error("[transcribe]", err);
    res.status(500).json({ error: "Transcription échouée" });
  }
});

export default router;
