---
name: WhatsApp LID JID routing
description: How to handle @lid JIDs in Baileys 7.x for incoming/outgoing message routing
---

## Rule
Never filter out `@lid` JIDs — real 1-on-1 chat messages use LID format in modern WhatsApp.
Only filter `@g.us` (groups) and `@broadcast`.

## Why
WhatsApp migrated to device-linked LIDs (`@lid`) in newer accounts. Baileys 7.x-rc delivers
both incoming AND outgoing messages with `@lid` remoteJid when the contact is on a LID-capable
account. When `lidDbMigrated: false` in connection logs, `contacts.upsert` will NOT populate
the `lid` field on contact objects — the map stays empty at cold start.

## How to apply
1. Build `lidToPhone: Map<string, string>` (lid user-part → phone digits), module-level shared.
2. Populate from `contacts.upsert` when contact has both `id` (`@s.whatsapp.net`) and `lid` (`@lid`).
3. Also learn from outgoing messages: when `fromMe=true` and `remoteJid` is `@lid`,
   record `lid → session.contactPhone` immediately (outgoing message proves which contact).
4. In `jidToPhone()`: strip `@server` and `:device` suffix; if `@lid`, look up in map; return "" when unresolved.
5. When unresolved (""), store in current session optimistically (both fromMe directions).

## Device suffix bug (fixed)
`jidToPhone("33612345678:37@s.whatsapp.net")` was returning `"3361234567837"` (wrong).
Fix: `jid.split("@")[0].split(":")[0]` strips both server and device suffix before extracting digits.

## phonesMatch helper
Compare last 9 significant digits to handle country-code prefix differences
(e.g. `33612345678` vs `0612345678` both match).
