---
name: WhatsApp media handling
description: How images and voice messages are stored and rendered in ReLink AI
---

## Storage
- `whatsapp_messages.media_data` (text) — base64 data URL (`data:<mime>;base64,...`)
- Images: downloaded via `downloadMediaAsDataUrl(msg, "image")` in `storeMessages` when `skipAudio = false` (real-time only, not history bulk)
- Audio/PTT: downloaded + transcribed in parallel via `Promise.all([transcribeWhatsappAudio, downloadMediaAsDataUrl(msg, "audio")])`; transcript → `content`, audio data URL → `media_data`
- History sync (`messages.history-set`): uses `skipAudio = true` — no media download to avoid bulk load

## Frontend rendering (Workspace.tsx)
- `isImage = !!msg.mediaData && msg.mediaData.startsWith("data:image")`
- `isAudio = !!msg.mediaData && msg.mediaData.startsWith("data:audio")`
- **Critical**: must check the prefix, NOT just `!!msg.mediaData` — audio messages also have mediaData and would render broken `<img>` tags otherwise

## Microphone in chat input
- Route: `POST /api/transcribe` using multer (memoryStorage) + OpenAI Whisper `gpt-4o-mini-transcribe`
- Frontend: MediaRecorder API, hold-to-record (onMouseDown/onTouchStart), release to stop + auto-transcribe into chat input
- multer + @types/multer installed in api-server

## `[Image]` placeholder
- Old messages without mediaData show a photo icon placeholder (ImagePlus) instead of broken text
- Messages with `[Image]` content + no mediaData = historical/imported, cannot be retroactively downloaded
