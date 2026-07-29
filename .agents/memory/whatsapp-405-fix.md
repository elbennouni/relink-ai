---
name: WhatsApp 405 fix — no creds wipe
description: Why we stopped wiping creds.json before history import and what replaced it
---

## The rule
**Never delete `.baileys-sessions/<id>/creds.json` before a history import.** Only purge the DB messages (whatsapp_messages table). Creds must be kept.

**Why:** Wiping creds forces Baileys to do a fresh device registration on the next connect (`not logged in, attempting registration...`). WhatsApp rate-limits registrations per IP — multiple clients on the same Replit IP hitting this simultaneously causes cascading 405 blocks that grow with each retry.

**How to apply:** `startSession` no longer calls `fs.rmSync(dir, ...)`. The block that used to wipe now only runs `db.delete(whatsappMessagesTable).where(...)`. Creds stay on disk → Baileys reconnects as a known device → no registration → no 405.

## History still works
`syncFullHistory: true` + `shouldSyncHistoryMessage: () => true` are now set unconditionally (not only when `wantsHistory`). WhatsApp pushes `messaging-history.set` on every reconnect for existing sessions. The `messaging-history.set` handler filters by `contactPhone` + `historyDays` window as before.

## Cooldown (30 s)
After a 405, a 30-second server-side cooldown blocks retries (prevents client spam). `RETRY_COOLDOWN_MS = 30 * 1000`. The UI shows a countdown and disables the button.

## UI history options
Added "Aujourd'hui" (historyDays=1, last 24h) between "Aucun" and "1 semaine". Grid is `grid-cols-6`.
