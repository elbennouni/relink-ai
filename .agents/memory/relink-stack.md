---
name: ReLink AI stack decisions
description: Key architectural decisions for ReLink AI — what belongs where and why
---

## SSE endpoints
- chatWithAgent, analyzeMessage, buildMemory all stream via SSE
- Frontend must use `fetch` + `ReadableStream`, never the generated orval hooks
- Backend uses `anthropic.messages.stream()` and writes `data: ${JSON.stringify(data)}\n\n` to res

## api-zod lib
- Removed the orval zod output block (caused TS2308 naming collisions between generated zod constants and TS types)
- `lib/api-zod/src/index.ts` is `export {}` — empty on purpose
- Backend validation uses manual zod schemas inline in route files

**Why:** orval generated both a `HealthCheckResponse` zod schema AND a `HealthCheckResponse` TypeScript type with identical names, causing compile errors.

**How to apply:** Never add `import ... from "@workspace/api-zod"` in backend routes; write zod schemas inline with `import { z } from "zod"`.

## Anthropic integration
- Client: `import { anthropic } from "@workspace/integrations-anthropic-ai"`
- Env vars injected automatically via Replit secrets: AI_INTEGRATIONS_ANTHROPIC_BASE_URL + AI_INTEGRATIONS_ANTHROPIC_API_KEY
- api-server tsconfig must reference `../../lib/integrations-anthropic-ai`
