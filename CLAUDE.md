# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Sunbnb is a sunbed reservation SaaS platform — a Turborepo monorepo with:
- `apps/partner/` — B2B portal for venue operators (port 3001)
- `apps/user/` — Consumer booking app (port 3002)
- `apps/admin/` — Platform admin (port 3003)
- `apps/mobile/` — Expo/React Native floor app for on-site staff (iOS + Android) — scaffolded, building toward v1, see [[track:024]]
- `packages/data/` — `@repo/data` — Prisma schema, migrations, shared DB client, payment logic, auth, email
- `packages/floor-core/` — `@repo/floor-core` — floor view-model types + `bed-state`/`grid-helpers`, shared by the partner manage grid and the mobile app
- `packages/ui/` — `@repo/ui` — Shared React components (Button, TextField, Card, Code)
- `packages/eslint-config/` — `@repo/eslint-config`
- `packages/typescript-config/` — `@repo/typescript-config`

## App & Package Details — read the one you're working in

These are **pointers, not imports**. Each app/package carries its own `CLAUDE.md`; read the one
whose code you are touching rather than carrying all five in every session. Auto-loading the whole
tree cost ~97 KB of context per session regardless of task, which contradicts the pulled-depth
doctrine the agents below already follow.

| Surface | Context | Detail pulled on demand |
|---|---|---|
| `apps/user/` | `apps/user/CLAUDE.md` | `apps/user/TESTING.md` · `apps/user/UI.md` |
| `apps/partner/` | `apps/partner/CLAUDE.md` | `apps/partner/TESTING.md` · `apps/partner/UI.md` |
| `apps/admin/` | `apps/admin/CLAUDE.md` | `apps/admin/UI.md` |
| `apps/mobile/` | `apps/mobile/CLAUDE.md` | [[track:024]] |
| `packages/data/` | `packages/data/CLAUDE.md` | `packages/data/TESTING.md` |
| `packages/ui/` | `packages/ui/CLAUDE.md` | — |

Cross-cutting rules in `.claude/rules/` stay auto-loaded and apply everywhere. When a question spans
surfaces, start at `.claude/wiki/index.md` rather than reading several app files end to end.

## LLM Wiki

A domain-oriented knowledge layer lives at `.claude/wiki/` — synthesized entity pages, end-to-end flow pages, subsystem pages, and operational workflows. Modelled on Karpathy's three-layer wiki pattern.

- **Schema:** `.claude/wiki/README.md` — conventions, page types, status discipline
- **Index:** `.claude/wiki/index.md` — start here when researching, debugging, or designing
- **Log:** `.claude/wiki/log.md` — append-only history of wiki changes

When to consult the wiki: **before** writing code on a non-trivial change, **first** when answering a "how does X work end-to-end" question, and **after** shipping anything non-trivial (run `.claude/wiki/workflows/ingest.md` to fold the change in). The wiki points at canonical sources (this file, the `CLAUDE.md` tree, `.claude/rules/`, the code) — it never replaces them.

## Tracks (long-horizon work)

Durable, resumable units of multi-session work live in `.claude/tracks/` — the **intent layer** of the context system. Each **track** is a goal + status-marked roadmap + append-only log + a "Resume here" contract, persisted so any session (or a parallel agent in a git worktree) can resume exactly where the last one stopped.

- **Spec:** `.claude/tracks/README.md` — what a track is, lifecycle, conventions
- **Registry:** `.claude/tracks/index.md` — start here to see active tracks and their next action
- **Workflows:** `.claude/tracks/workflows/` — create · resume · handoff · close

When to use: **before** starting non-trivial multi-session work, check the registry and resume the relevant track. **Before ending** work on a track, run the `handoff` workflow (update roadmap → append log → rewrite "Resume here"). Run parallel tracks in separate git worktrees.

## Agents & protocol

**Two tiers:** per-surface developer generalists (`user-dev`, `partner-dev`, `admin-dev`, `data-dev`)
for coverage, plus narrow cross-app specialists (e.g. `sunbed-inventory`) for depth. Definitions in
`.claude/agents/`.

**Lean prompts, pulled depth.** An agent definition carries identity, scope boundary, and *how to
pull* knowledge — never copied route maps or state machines. At task start it queries the recall
store (`.claude/scripts/knowledge-recall.mjs`), reads its playbook (`.claude/knowledge/<agent>.md`),
and consults the live canon. The same doctrine governs this file: see the pointer table above.

**Self-improving.** A produce → curate → promote loop with a trust ladder; agents never edit their
own definitions. Mechanics: `.claude/knowledge/README.md`.

**Shared protocol** (`kb:` markers, final-report schema): `.claude/agent-protocol.md` — every agent
follows it. **Shared capabilities** are skills + a wiki page cited by all, not copied per agent:
`/schematic`, `/ui`, `/db`.

**Architecture is a concern, not an agent** — owned by the orchestrator, governed by
`.claude/rules/architecture.md`; deep design delegates to the `Plan` agent.

## Commands

### Development

```bash
# Run all apps via Turborepo
npm run dev

# Run individual app (must source env first)
cd apps/partner && source .env.local && npm run dev   # https://local.sunbnb.app:3001
cd apps/user    && source .env.local && npm run dev   # https://local.sunbnb.app:3002
```

### Build & Lint

```bash
npm run build        # turbo build
npm run lint         # turbo lint
npm run format       # prettier all .ts/.tsx/.md
```

### Testing

```bash
npm run test                        # turbo runs all unit tests across packages
cd packages/data && npm run test    # unit tests (pure logic, no DB)
cd packages/data && npm run test:integration   # integration tests (requires local Docker Postgres sunbnb_test DB)
cd apps/user && npm run test        # unit + API route + server action tests
```

**Framework**: Vitest 3 — native TypeScript/ESM, configured per-package with `vitest.config.ts`.

**Test DB setup** (for integration tests):
```bash
docker exec sunbnb-postgres psql -U postgres -c "CREATE DATABASE sunbnb_test;"
docker exec sunbnb-postgres psql -U postgres -c "CREATE DATABASE coastline_test;"   # marketing coastline DB (track 027)
cd packages/data && npm run test:integration:setup   # migrate deploy → sunbnb_test, coastline schema → coastline_test
```

### Database

```bash
cd packages/data
npm run migrate:local        # local Docker DB — migrate dev + generate, then migrate deploy to sunbnb_test (lockstep)
npm run migrate:test         # Neon test DB — POSTGRES_URL_TEST via scripts/with-db-url.sh, migrate deploy
npm run migrate:production   # Neon prod DB — POSTGRES_URL_PRODUCTION via scripts/with-db-url.sh, migrate deploy
npm run migrate:check        # exit 2 if schema.prisma has changes no committed migration captures
npm run migrate:status:{local,test,production}   # pending / failed / checksum-drift per env

# Prisma Studio
cd packages/data && source .env.local && npx prisma studio

# Sync local DB from test
cd packages/data && source .env.local && ./sync-local-db.sh
```

Migration workflow doctrine — immutable applied migrations, expand/contract (additive-only per release), migrate-before-deploy — lives in **`.claude/rules/migrations.md`**.

### Deployment

```bash
./promote-to-test.sh        # verify → migrate TEST DB → merge main→test → push (deploys test.sunbnb.app)
./deploy-to-production.sh   # verify → confirm → migrate PROD DB → merge test→production → push (deploys sunbnb.app)
```

Both scripts are **migrate-before-deploy**: the target DB is migrated (via the `.env.local` URLs) *before* the branch is pushed, so Vercel never serves new code against a schema missing its migration. `SKIP_TESTS=1 ./promote-to-test.sh` bypasses the lint/test gate for docs-only promotes (migration guards still run).

Vercel-managed via git branches: `main` → preview, `test` → test.sunbnb.app, `production` → sunbnb.app. Region: Frankfurt `fra1`. Vercel does **not** run migrations on build — the scripts above are the only path that applies them.

**The `main`/preview and `test` environments share the TEST database.** Since `main` runs ahead of `test`, additive migrations must reach the test DB *before* `main` is pushed — the `.githooks/pre-push` hook blocks a `main` push with pending test-DB migrations (run `npm run migrate:test` first). Destructive migrations are deferred to promote time. Full reasoning + the expand/contract split: **`.claude/rules/migrations.md`**.

## Local setup requirements

- **Docker** for PostgreSQL + PostGIS: `docker run -d --name sunbnb-postgres -e POSTGRES_PASSWORD=sunbnb -p 5432:5432 postgis/postgis:latest`
- Local connection string: `postgres://postgres:sunbnb@localhost:5432/postgres`
- **mkcert** for local HTTPS: certificates go in `apps/{partner,user}/certificates/`
- **`/etc/hosts`** entry: `127.0.0.1 local.sunbnb.app`
- Each app needs `.env.local` (gitignored); `packages/data/.env.local` is used by Prisma migrations

## Tech stack

| Layer | Technology |
|---|---|
| Monorepo | Turborepo + npm workspaces |
| Framework | Next.js 16 (App Router, Turbopack) · React 19 |
| Language | TypeScript 5 |
| Database | PostgreSQL + PostGIS (spatial queries, GiST index on geometry) |
| ORM | Prisma 7 with `@prisma/adapter-pg` driver adapter |
| Auth | NextAuth v5 (beta) — JWT strategy |
| Payments | Mollie for Platforms · Stripe Connect · Viva (online + Cloud Terminal) · Stripe Tap to Pay (+ demo mode); Stripe Billing for subscriptions |
| State | Redux Toolkit + RTK Query (user app) |
| Styling | Tailwind CSS 4 (CSS-first `@theme` in each app's `app/globals.css`) + MUI 5 (progressive migration to pure Tailwind) |
| i18n | next-intl (EN, ES, FI) |
| Maps | Google Maps (`@vis.gl/react-google-maps`) |
| PDF | @react-pdf/renderer |
| Blob storage | Vercel Blob |
| Email | Resend API |
| Testing | Vitest 3 |

## Key Environment Variables

- `POSTGRES_URL` — Database connection string
- `STRIPE_SECRET_KEY` — Stripe credentials for **partner subscriptions**
- `STRIPE_CONNECT_SECRET_KEY` — Stripe Connect platform key (consumer direct charges, onboarding, Terminal; restricted key scopes in [[track:028]])
- `NEXT_PUBLIC_STRIPE_CONNECT_PUBLIC_KEY` — publishable key for embedded Connect components (partner app)
- `STRIPE_CONNECT_WEBHOOK_SECRET` — Connect payment webhook (`/api/webhooks/stripe-connect`, user app)
- `STRIPE_CONNECT_ACCOUNT_WEBHOOK_SECRET` — Connect `account.updated` webhook (`/api/stripe-connect/webhook`, partner app)
- `STRIPE_SUBSCRIPTION_WEBHOOK_SECRET` — signature verification for the subscription webhook (`/api/subscription/webhook`, partner app)
- `MOLLIE_CLIENT_ID`, `MOLLIE_CLIENT_SECRET`, `MOLLIE_REDIRECT_URI` — Mollie OAuth (partner app)
- `VIVA_MODE` (`stub`|`http`), `VIVA_CHECKOUT_SOURCE_CODE`, `VIVA_CHECKOUT_COLOR` — Viva Smart Checkout (online)
- `VIVA_WEBHOOK_VERIFICATION_KEY` — Viva webhook URL-verification handshake (`GET /api/webhooks/viva`, user app)
- `GOOGLE_MAPS_API_KEY` — Server-side Maps + Places API proxy
- `NEXT_PUBLIC_GOOGLE_MAPS_CLIENT_KEY` — Client-side Maps (HTTP-referrer-restricted; falls back to `GOOGLE_MAPS_API_KEY`)
- `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` — NextAuth
- `AUTH_FACEBOOK_ID`, `AUTH_FACEBOOK_SECRET` — Facebook OAuth (user app only)
- `BLOB_READ_WRITE_TOKEN` — Vercel Blob storage
- `RECONCILIATION_SECRET` — Protects `/api/reconcile` endpoint (required; 503 if unset)
- `ALLOWED_ORIGINS` — Comma-separated origins for password reset email links
- `RESEND_API_KEY` — Resend email service
- `CRON_SECRET` — Protects `/api/cron/send-reminders` (Vercel Cron sends as `Authorization: Bearer`)
- `NEXT_PUBLIC_DEMO_MODE` — Enables demo payment mode (server-controlled)

## Architecture

### Data flow

`packages/data` owns the Prisma schema and exports the shared DB client and types. Both apps import from `@repo/data` — never define Prisma models in the apps. Server components fetch via Prisma directly (no API layer). Client components use RTK Query for polling/caching or call server actions directly.

### Payment Architecture

**Multi-provider consumer rails** ([[track:028]]): each partner selects **one provider per
account** from those available in their country (`/account/payments`, select-then-connect;
`Site.paymentProvider` is the derived *effective* provider). The rail is identified by the
`paymentRef` prefix (`@repo/data/payment-refs`); invoicing is provider-neutral.

- **Mollie for Platforms** — partner OAuth tokens on `PartnerAccount`, commission as `applicationFee`.
- **Stripe Connect direct charges** — the connected account is merchant of record (never a
  platform charge, [[track:003]]); platform = the Sunbnb Test Stripe account; own-form API
  onboarding (`requirement_collection: application`) + embedded components; commission + a
  processing pass-through ride in `application_fee_amount`. Stripe also still bills **partner
  subscriptions** (platform-as-merchant, `STRIPE_SECRET_KEY`).
- **Viva Smart Checkout** online — stub only until the Viva merchant account clears KYC.
- **Demo mode** (`NEXT_PUBLIC_DEMO_MODE`) mints `pi_demo_*` refs through the same invoicing path.

**Agent model** — each payment yields a gross PARTNER invoice plus a separate B2B PLATFORM
commission invoice; they do not sum to the consumer total. The rule is canonical in
`.claude/rules/payments.md`; the subsystem walkthrough is `.claude/wiki/subsystems/payments.md`.

**Card-present** (`apps/mobile`): Viva Cloud Terminal ([[track:024]]) + Stripe Tap to Pay ([[track:028]]).

### Settlement System

`Settlement` records aggregate monthly payouts per partner (DRAFT → CLOSED → APPROVED → PAID). `Invoice` and `InvoiceLine` are generated post-payment. The admin app manages settlement approvals.

## Cross-Cutting Patterns

- **Next 16 conventions** (track 029): `params` / `searchParams` and `cookies()` / `headers()` are Promises — always `await` them (`({ params }: { params: Promise<{ id: string }> })` + `const { id } = await params`); request interception lives in `proxy.ts` (exported `proxy`), not `middleware.ts`; `useActionState` comes from `react` (not `useFormState` from `react-dom`). Dev runs over mkcert HTTPS, so each `next.config.mjs` lists `allowedDevOrigins: ['local.sunbnb.app']`. Turbopack's CSS parser rejects an `@import` placed after other rules — keep imports at the top of a stylesheet
- **Auto-save**: Debounced (1.5–2s) field changes trigger server actions → refresh site context
- **Image upload**: Vercel Blob `put()` in server actions; remote patterns whitelisted in `next.config.mjs`
- **Error handling**: Server actions return `{ status: 'ok' | 'error', errors?: string[] }`; UI shows auto-dismissing banners
- **i18n**: `next-intl` with `getRequestConfig()` from `Accept-Language` header. Message files in `messages/{en,es,fi}.json`
- **Cron jobs**: `/api/reservations-cleanup` (partner, every 15 min) cleans stale bookings; `/api/cron/send-reminders` (user, daily 07:00 UTC) sends reminder emails; `/api/cron/prune-telemetry` (user, daily 03:20 UTC) evicts device telemetry history past the `device-telemetry-retention-days` preference
- **Equipment rentals**: Sites enable via `features[]` array (add `"rentals"`). Supports hourly and daily bookings (`durationType: 'hours' | 'days'`). Availability checked by aggregating booked quantities for overlapping time windows. Categories: surfboard, paddleboard, kayak, pedal boat, snorkel, other

## Known Quirks

- `@repo/data` exports both Prisma client AND duplicated UI components (TextField, Button) — same components also exist in `@repo/ui`
- Export path typo: `"./PrismaCient"` (missing 'l' in Client)
- `messages/en.json` in partner app has typo: `"Acccount"` (triple 'c')
- MUI and Tailwind coexist — progressive migration toward pure Tailwind in partner app
- Reservation types include "hours" and "days" — hours mode is fully supported for equipment rentals across all apps; sunbed reservations use days mode only
