---
name: Mobile static-build pipeline
description: How the Expo mobile web bundle is built and served — what broke and how it was fixed
---

## The pipeline

- Dev: `pnpm run dev` → Metro live server on the dev Expo URL
- Prod: `pnpm run serve` → `server/serve.js` serves pre-built files from `static-build/`
- Build: `pnpm run build` → `scripts/build.js` runs Metro in headless mode, writes bundles to `static-build/`

## What broke (root cause)

`static-build/` was **completely empty** — the build had never been run. Every deployment ran `serve` on an empty directory, so the mobile app served nothing useful. This was the real reason the mobile "had no database" — not a Clerk key issue.

## Fix applied

1. `_layout.tsx` now fetches `CLERK_PUBLISHABLE_KEY` from `GET /api/config` at runtime (before Clerk initialises). Splash screen is held until both fonts AND the key are ready. Falls back to baked-in `pk_test_` if server unreachable.
2. `proxyUrl` is computed from `BASE` directly (`${BASE}/api/__clerk`) — not from baked-in env var — so it's always correct regardless of which domain was baked in.
3. Build was run once manually: `REPLIT_INTERNAL_APP_DOMAIN=ai-agent-tool-mikam514.replit.app node scripts/build.js` — produced 53 files in `static-build/` with the prod domain baked in 58 times per bundle.

**Why:** `static-build/` is NOT gitignored, so the built files are committed and served at deploy time. Future changes to `_layout.tsx` or any mobile code require re-running the build manually and committing the new `static-build/`.

## Port conflict during build

Metro uses port 8081. `mockup-sandbox` also runs on 8081. Must free 8081 before building: `kill $(lsof -t -i:8081)`, then restart mockup-sandbox after.

## Re-building after code changes

```bash
kill $(lsof -t -i:8081)
cd artifacts/relink-mobile
REPLIT_INTERNAL_APP_DOMAIN=ai-agent-tool-mikam514.replit.app CLERK_PUBLISHABLE_KEY=pk_test_cmVsZXZhbnQtamVubmV0LTU4LmNsZXJrLmFjY291bnRzLmRldiQ node scripts/build.js
# then restart mockup-sandbox workflow
```
