# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Sunbnb is a sunbed reservation SaaS platform — a Turborepo monorepo with:
- `apps/partner/` — B2B portal for venue operators (port 3001)
- `apps/user/` — Consumer booking app (port 3002)
- `apps/admin/` — Platform admin (port 3003)
- `apps/marketing/` — try.sunbnb.app landing page + beach-mockup lead agent (port 3004, [[track:027]])
- `apps/mobile/` — Expo/React Native floor app for on-site staff (iOS + Android), see [[track:024]]
- `packages/data/` — `@repo/data` — Prisma schema, migrations, DB client, payment logic, auth, email
- `packages/agent/` — `@repo/agent` — provider-neutral, Prisma-free AI agent core (model adapter,
  tool loop, turn limits, `vision/`, `geo/`) shared by marketing and the partner assistant ([[track:030]])
- `packages/floor-core/` — `@repo/floor-core` — floor view-model types + `bed-state`/`grid-helpers`
  (partner manage grid + mobile)
- `packages/schematic/`, `packages/schematic-editor/` — shared sunbed/table geometry, renderer and
  editor chrome (wiki `subsystems/schematic-editor.md`)
- `packages/table-reservations-{core,ui}/` — restaurant/table product (wiki `subsystems/table-reservations.md`)
- `packages/ui/` — `@repo/ui` — shared React components
- `packages/eslint-config/`, `packages/typescript-config/` — shared config

## Context system — how knowledge reaches a session

**What loads when.** This file, `.claude/rules/*.md` and the memory index load in every session. A
directory's `CLAUDE.md` (`apps/<app>/`, `packages/<pkg>/`) loads when a file under it is read.
Everything else — `TESTING.md`, `UI.md`, the other pulled siblings below, the wiki, playbooks,
tracks — is pulled on demand. Keep auto-loaded files inside their budgets
(`.claude/context/budgets.json`); move narrative to a pulled sibling or the wiki.

| Surface | Auto-loads with the directory | Pulled on demand |
|---|---|---|
| `apps/user/` | `apps/user/CLAUDE.md` | `TESTING.md` · `UI.md` · `HW-API.md` · `PATTERNS.md` |
| `apps/partner/` | `apps/partner/CLAUDE.md` | `TESTING.md` · `UI.md` · `ASSISTANT.md` · `PATTERNS.md` |
| `apps/admin/` | `apps/admin/CLAUDE.md` | `UI.md` |
| `apps/mobile/` | `apps/mobile/CLAUDE.md` | [[track:024]] |
| `apps/marketing/` | `apps/marketing/CLAUDE.md` | [[track:027]] |
| `packages/data/` | `packages/data/CLAUDE.md` | `TESTING.md` · `EXPORTS.md` · `REFERENCE.md` |
| `packages/agent/` | `packages/agent/CLAUDE.md` | — |
| `packages/ui/` | `packages/ui/CLAUDE.md` | — |

**Layers** (each has its own spec; trust rises down the list, authority rises up it):
- **Canon** — this tree + `.claude/rules/` (declarative rules, always on).
- **Wiki** `.claude/wiki/` — entity/flow/subsystem synthesis. Start at `index.md` for any
  "how does X work end-to-end" question; after shipping something non-trivial run
  `/context-loop:wiki ingest`.
- **Tracks** `.claude/tracks/` — multi-session work: goal, roadmap, log, **Resume here**. Check
  `index.md` (generated) before non-trivial work; `/context-loop:track handoff` before stopping.
- **Playbooks** `.claude/knowledge/<agent>.md` — each dev agent's curated lessons;
  `/context-loop:groom <agent>` curates them.
- **Recall** — one pgvector store holding all of the above plus distilled past sessions, tiered by
  trust: `/context-loop:recall <query> [--surface <agent>]`; credit hits that helped with
  `--credit <ids>`.

**Engine.** The machinery is the `context-loop` plugin ([[track:033]]), enabled in
`.claude/settings.json`; this repo holds only the instance (`.claude/context/{budgets,project}.json`
and the layers above). Each session links `.claude/context/engine` to the installed plugin, so
scripts run as `node .claude/context/engine/scripts/<script>.mjs` and the layer specs are in
`.claude/context/engine/specs/`.

**Health.** `context-health.mjs` prints a one-line summary at session start and on every push;
`/context-loop:context check` is the full report with a fix command per finding. Nothing blocks.

**Agents.** Per-surface generalists (`user-dev`, `partner-dev`, `admin-dev`, `data-dev`) plus
specialists (`sunbed-inventory`) in `.claude/agents/`. Lean definitions, pulled depth: one tiered
recall, the playbook's generated index, then canon. Shared protocol (`kb:` markers, final-report
schema): `.claude/agent-protocol.md`. Shared capabilities are skills: `/schematic`, `/ui`, `/db`.
Architecture is an orchestrator concern (`.claude/rules/architecture.md`); deep design goes to `Plan`.
`AGENTS.md` at the root is turbo-managed (re-added by turbo; opt out via `agentGuidance` in `turbo.json`).

## Commands

### Development

```bash
# Run all apps via Turborepo
npm run dev

# Run individual app (must source env first)
cd apps/partner && source .env.local && npm run dev   # https://local.sunbnb.app:3001
cd apps/user    && source .env.local && npm run dev   # https://local.sunbnb.app:3002
```

Kill a running dev server before moving or creating files in that app (`lsof -ti:<port> | xargs
kill`): Turbopack HMR corrupts its route manifest on file moves. Tooling is npm only — no yarn, no
global installs without asking; prefer the existing scripts.

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

**Framework**: Vitest 5 — native TypeScript/ESM, configured per-package with `vitest.config.ts`.

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
| Language | TypeScript 6 |
| Database | PostgreSQL + PostGIS (spatial queries, GiST index on geometry) |
| ORM | Prisma 7 with `@prisma/adapter-pg` driver adapter |
| Auth | NextAuth v5 (beta) — JWT strategy |
| Payments | Mollie for Platforms · Stripe Connect · Viva (online + Cloud Terminal) · Stripe Tap to Pay (+ demo mode); Stripe Billing for subscriptions |
| State | Redux Toolkit + RTK Query (user app) |
| Styling | Tailwind CSS 4 (CSS-first `@theme` in each app's `app/globals.css`) + MUI 9 (progressive migration to pure Tailwind) |
| i18n | next-intl (EN, ES, FI) |
| Maps | Google Maps (`@vis.gl/react-google-maps`) |
| PDF | @react-pdf/renderer |
| Blob storage | Vercel Blob |
| Email | Resend API |
| Testing | Vitest 5 |

## Key Environment Variables

Names and purpose only; per-app detail lives in that app's `CLAUDE.md`.

| Variable(s) | Purpose |
|---|---|
| `POSTGRES_URL` | Database connection |
| `STRIPE_SECRET_KEY`, `STRIPE_SUBSCRIPTION_WEBHOOK_SECRET` | Partner subscriptions (platform-as-merchant) |
| `STRIPE_CONNECT_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_CONNECT_PUBLIC_KEY` | Stripe Connect: consumer direct charges, onboarding, Terminal ([[track:028]]) |
| `STRIPE_CONNECT_WEBHOOK_SECRET`, `STRIPE_CONNECT_ACCOUNT_WEBHOOK_SECRET` | Connect payment webhook (user) · `account.updated` webhook (partner) |
| `MOLLIE_CLIENT_ID`, `MOLLIE_CLIENT_SECRET`, `MOLLIE_REDIRECT_URI` | Mollie OAuth (partner) |
| `VIVA_MODE`, `VIVA_CHECKOUT_SOURCE_CODE`, `VIVA_CHECKOUT_COLOR`, `VIVA_WEBHOOK_VERIFICATION_KEY` | Viva Smart Checkout (`stub`\|`http`) + webhook handshake |
| `GOOGLE_MAPS_API_KEY`, `NEXT_PUBLIC_GOOGLE_MAPS_CLIENT_KEY` | Server Maps/Places proxy · referrer-restricted client key |
| `AUTH_SECRET`, `AUTH_GOOGLE_*`, `AUTH_FACEBOOK_*` | NextAuth |
| `BLOB_READ_WRITE_TOKEN`, `ASSISTANT_BLOB_READ_WRITE_TOKEN` | Vercel Blob · private store for assistant uploads |
| `RECONCILIATION_SECRET`, `CRON_SECRET` | `/api/reconcile` (503 if unset) · Vercel Cron bearer |
| `ALLOWED_ORIGINS`, `RESEND_API_KEY` | Password-reset link origins · email |
| `NEXT_PUBLIC_GA4_ID` | GA4 per app/env via `@repo/ui/google-analytics` (consent-gated) |
| `NEXT_PUBLIC_DEMO_MODE` | Demo payment mode |
| `ANTHROPIC_API_KEY`, `PARTNER_ASSISTANT_ENABLED` | Claude API; both required for the partner assistant (else 503) |
| `PARTNER_ASSISTANT_MODEL`, `PARTNER_ASSISTANT_EXTRACTION_MODEL`, `PARTNER_AI_DAILY_TURNS`, `ASSISTANT_NOTIFY_EMAIL` | Assistant model overrides, daily turn budget, budget alert |
| `COASTLINE_POSTGRES_URL` | Coastline DB (marketing `/api/coastline`; assistant aerial land check) |

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

### Settlements (retired)

Settlements are retired ([[track:032]]): consumer payments are direct charges to the partner's own provider account, so the platform never holds funds to pay out. Partner money reporting is the partner accounting page + invoices. The table, `Invoice.settlement_batch_id` and the enum were dropped by `20261013101617_drop_legacy_settlement`.

## Cross-Cutting Patterns

- **Next 16 conventions** (track 029): `params` / `searchParams` and `cookies()` / `headers()` are
  Promises — always `await` them; request interception lives in `proxy.ts` (exported `proxy`), not
  `middleware.ts`; `useActionState` comes from `react`. Dev runs over mkcert HTTPS, so each
  `next.config.mjs` lists `allowedDevOrigins: ['local.sunbnb.app']`. Turbopack's CSS parser rejects
  an `@import` after other rules — keep imports at the top of a stylesheet
- **Auto-save**: Debounced (1.5–2s) field changes trigger server actions → refresh site context
- **Image upload**: Vercel Blob `put()` in server actions; remote patterns whitelisted in `next.config.mjs`
- **Error handling**: Server actions return `{ status: 'ok' | 'error', errors?: string[] }`; UI shows auto-dismissing banners
- **i18n**: `next-intl` with `getRequestConfig()` from `Accept-Language` header. Message files in `messages/{en,es,fi}.json`
- **Cron jobs**: `/api/reservations-cleanup` (partner, 15 min) stale bookings;
  `/api/cron/send-reminders` (user, 07:00 UTC) reminder emails; `/api/cron/prune-telemetry` (user,
  03:20 UTC) device telemetry past retention; `/api/cron/purge-assistant-uploads` (partner, 03:40 UTC)
  assistant blobs past their 30-day TTL
- **Equipment rentals**: Sites enable via `features[]` array (add `"rentals"`). Supports hourly and daily bookings (`durationType: 'hours' | 'days'`). Availability checked by aggregating booked quantities for overlapping time windows. Categories: surfboard, paddleboard, kayak, pedal boat, snorkel, other

## Known Quirks

- `@repo/data` exports both Prisma client AND duplicated UI components (TextField, Button) — same components also exist in `@repo/ui`
- Export path typo: `"./PrismaCient"` (missing 'l' in Client)
- `messages/en.json` in partner app has typo: `"Acccount"` (triple 'c')
- MUI and Tailwind coexist — progressive migration toward pure Tailwind in partner app
- Reservation types include "hours" and "days" — hours mode is fully supported for equipment rentals across all apps; sunbed reservations use days mode only
