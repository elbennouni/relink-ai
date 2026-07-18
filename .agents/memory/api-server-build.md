---
name: API server build quirks
description: Gotchas that cause the api-server esbuild to fail
---

## zod not resolved
- `zod` must be listed explicitly in `artifacts/api-server/package.json` dependencies
- The catalog entry `"zod": "catalog:"` resolves to ^3.25.76
- **Why:** esbuild bundles the server; workspace catalog packages aren't auto-included

## health.ts must be self-contained
- Never import from `@workspace/api-zod` in health.ts (or anywhere in api-server)
- The api-zod lib exports nothing (`export {}`)
- Simplest health route: just `res.json({ status: "ok" })`

## Frontend useToast location
- `useToast` hook lives in `@/hooks/use-toast` (NOT `@/components/ui/toast`)
- `@/components/ui/toast` exports only the Radix Toast primitives/components
- The design subagent consistently imports from the wrong path — always fix after design runs
