# Agent Core (packages/agent, @repo/agent)

Provider-neutral, **Prisma-free** AI agent core shared by the marketing lead agent
(`apps/marketing/lib/agent`) and the partner assistant (`apps/partner/lib/assistant`,
[[track:030]]). Nothing here touches a database or an app's auth — callers bind both.

| Module | What |
|---|---|
| `src/loop.ts` | Generic agent loop: send → validate + run tool calls → feed results back, until text, a stop (refusal / max_tokens) or the step cap |
| `src/model.ts`, `src/claude-model.ts` | Model interface and the Claude adapter (provider content replayed verbatim, thinking blocks included) |
| `src/schema.ts` | Tool input schemas and validation |
| `src/limits.ts` | AI-turn limit primitives (callers own the counters) |
| `src/vision/` | Aerial/plan image extraction descriptors (`aerial-schema.ts`, `extract.ts`) |
| `src/geo/` | Coastline, beach layout, georeferencing, grid fit, land fit |

Rules:
- Keep it Prisma-free and app-free: a new capability that needs the DB takes a callback.
- Imports use `.ts` extensions; consumers need `allowImportingTsExtensions` and
  `transpilePackages: ['@repo/agent']` (see `.claude/knowledge/partner-dev.md`).
- Verify: `cd packages/agent && npm run typecheck && npm run test`.
