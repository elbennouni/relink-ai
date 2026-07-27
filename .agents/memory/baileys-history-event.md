---
name: Baileys history sync event names
description: Correct event names and config for importing WhatsApp message history with Baileys 7.x
---

## Rules

- The event that fires when Baileys delivers historical messages is **`messaging-history.set`**, NOT `messages.history-set`.
- `messaging-history.set` is buffered by Baileys' event buffer and only emitted after `ev.flush()` completes (triggered by `doAppStateSync`).
- Payload shape: `{ chats, contacts, messages: WAMessage[], isLatest?, progress?, syncType?, chunkOrder? }`

## Required makeWASocket config for history import

```ts
makeWASocket({
  syncFullHistory: true,                        // tells WA to send full history
  shouldSyncHistoryMessage: () => true,         // Baileys default returns false for FULL type — MUST override
  ...
})
```

**Why:** Baileys' default `shouldSyncHistoryMessage` is `({ syncType }) => syncType !== HistorySyncType.FULL`, which silently drops all FULL-sync chunks even when `syncFullHistory: true`. Both overrides are required together.

## How to apply

Any time history import is wired up, set both options and listen to `messaging-history.set` (with `messaging-` prefix, not `messages.`).
