# Marketing App (apps/marketing)

try.sunbnb.app — the B2B landing page and the **beach-mockup lead agent**: a prospect names their
beach, the server builds a mockup of it with Sunbnb sunbeds, and an AI sales chat books a demo.
Full design, decisions and roadmap: [[track:027]] (`.claude/tracks/027-beach-mockup-lead-agent.md`).

Port 3004 (`npm run dev` runs `server.cjs` over mkcert HTTPS). No auth; leads are reviewed in the
admin app (`/leads`).

## Where things are

| Path | What |
|---|---|
| `app/page.tsx`, `app/m/` | Landing page · per-lead mockup pages |
| `app/api/chat/route.ts` | One AI chat turn; every failure answers `{ status: 'unavailable' }` — the demo form never depends on the model |
| `app/api/{coastline,places,guide,events,cron}` | Coastline lookup · Google Places proxy · guide · tracking events · cron |
| `lib/agent/` | Lead-agent turn (`run-turn.ts`), tools, system prompt, contact capture, knowledge |
| `lib/beach-layout.ts`, `land-fit.ts`, `coastline.ts`, `inland-water.ts` | Mockup geometry; shared geo lives in `@repo/agent/geo` |
| `lib/limits.ts`, `limit-policy.ts` | Daily AI spend cap and shared counters |
| `lib/tracking-plan.ts`, `track.ts`, `consent.ts` | GA4 / pixel / PostHog plan, consent-gated |
| `eval/` | Agent eval harness (`npm run eval`, `eval:summary`) |

## Invariants

- **The model talks, the server acts.** Contact capture and demo booking are server-side
  (`lib/agent/contact-capture.ts`); the client sends only the new message, never history.
- **The model does not draw the beach.** It returns intent; deterministic code makes geometry.
- Coastline data lives in its own DB (`COASTLINE_POSTGRES_URL`); tests use `coastline_test`.

## Verify

`cd apps/marketing && npm run typecheck && npm run lint && npm run test`
