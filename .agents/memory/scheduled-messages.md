---
name: Scheduled messages (timer de réponse)
description: How delayed message sending is implemented
---

# Timer de réponse — Scheduled Messages

## DB table
`scheduled_messages` — fields: id, userId, relationId, content, mediaData, scheduledAt, sentAt, status (pending|sent|failed|cancelled), failReason, createdAt

## API routes (all authenticated + requireRelationOwnership)
- POST `/api/relations/:id/messages/schedule` — body: { content, delayMinutes: 30|120|300 }
- GET `/api/relations/:id/messages/scheduled` — list pending
- DELETE `/api/relations/:id/messages/scheduled/:msgId` — cancel

## Background job
- `startScheduledMessageJob()` exported from `artifacts/api-server/src/routes/schedule_message.ts`
- Called in `artifacts/api-server/src/index.ts` after server starts
- Runs every 60s: finds pending msgs where scheduledAt <= now
- Tries `sendViaWA(relationId, text)` from whatsapp_baileys.ts (exported function)
- Falls back to inserting as isMe=true in whatsapp_messages if WA not connected

## Web UI
- **SuggestRepliesDialog**: Clock icon + ChevronDown dropdown next to WA send button → 30min/2h/5h
- **Workspace.tsx left panel**: WA input bar at bottom with Clock icon dropdown for timer
- Pending scheduled count shown as amber badge above the input bar with "Annuler tout" button

## Mobile UI
- Timer button (⏰ clock icon) appears next to send button when text is typed
- Tapping opens a React Native Modal slide-up sheet with 3 delay options
- On selection: calls `/api/relations/:id/messages/schedule`
