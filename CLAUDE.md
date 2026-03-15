# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Sunbnb is a sunbed reservation SaaS platform — a Turborepo monorepo with:
- `apps/partner/` — B2B portal for venue operators (port 3001)
- `apps/user/` — Consumer booking app (port 3002)
- `apps/admin/` — Platform admin (port 3003)
- `packages/data/` — `@repo/data` — Prisma schema, migrations, shared DB client, payment logic, auth, email
- `packages/ui/` — `@repo/ui` — Shared React components (Button, TextField, Card, Code)
- `packages/eslint-config/` — `@repo/eslint-config`
- `packages/typescript-config/` — `@repo/typescript-config`

## App & Package Details

@apps/user/CLAUDE.md
@apps/partner/CLAUDE.md
@apps/admin/CLAUDE.md
@packages/data/CLAUDE.md
@packages/ui/CLAUDE.md

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
cd packages/data && npm run test:integration:setup   # runs prisma migrate deploy against sunbnb_test
```

### Database

```bash
cd packages/data
npm run migrate:local        # local Docker DB (copies .env.local → .env, runs prisma migrate dev, generates client)
npm run migrate:test         # Neon test DB
npm run migrate:production   # production DB

# Prisma Studio
cd packages/data && source .env.local && npx prisma studio

# Sync local DB from test
cd packages/data && source .env.local && ./sync-local-db.sh
```

### Deployment

```bash
./promote-to-test.sh        # merge main → test branch
./deploy-to-production.sh   # merge test → production branch
```

Vercel-managed via git branches: `main` → preview, `test` → test.sunbnb.app, `production` → sunbnb.app. Region: Frankfurt `fra1`.

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
| Framework | Next.js 14 (App Router) |
| Language | TypeScript 5 |
| Database | PostgreSQL + PostGIS (spatial queries, GiST index on geometry) |
| ORM | Prisma 7 with `@prisma/adapter-pg` driver adapter |
| Auth | NextAuth v5 (beta) — JWT strategy |
| Payments | Stripe + Mollie for Platforms (+ demo mode) |
| State | Redux Toolkit + RTK Query (user app) |
| Styling | Tailwind CSS 3 + MUI 5 (progressive migration to pure Tailwind) |
| i18n | next-intl (EN, ES, FI) |
| Maps | Google Maps (`@vis.gl/react-google-maps`) |
| PDF | @react-pdf/renderer |
| Blob storage | Vercel Blob |
| Email | Resend API |
| Testing | Vitest 3 |

## Key Environment Variables

- `POSTGRES_URL` — Database connection string
- `STRIPE_SECRET_KEY`, `STRIPE_PUBLIC_KEY` — Stripe credentials
- `STRIPE_WEBHOOK_SECRET` — Stripe webhook signature verification
- `MOLLIE_CLIENT_ID`, `MOLLIE_CLIENT_SECRET`, `MOLLIE_REDIRECT_URI` — Mollie OAuth (partner app)
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

**Stripe** handles:
- Partner subscriptions (STARTER/PRO/BUSINESS tiers) in partner app
- Direct consumer payments for reservations and F&B orders in user app

**Mollie for Platforms** handles marketplace payments (consumer → Sunbnb → venue operator). Partner tokens stored as `mollieAccessToken` on PartnerAccount, refreshed via OAuth. Platform commission collected as `applicationFee`.

**Demo mode** (`NEXT_PUBLIC_DEMO_MODE`): Generates fake `pi_demo_{timestamp}` refs, runs same invoice creation logic.

**Stripe reservation flow**: User selects sunbeds → reservation created (pending) → `/payment` → POST `/api/payment/stripe/payment-intent` → Stripe Elements → `confirmPayment()` → redirect to `/payment/complete` → VerifyPayment polls GET `/api/reservations/[id]` → `processConfirmedReservation()` creates Invoice + InvoiceLines → status set to `complete`.

**Mollie reservation flow**: POST `/api/payment/mollie/create-payment` → payment created on partner's Mollie account → redirect to Mollie checkout → POST `/api/webhooks/mollie` with payment ID → process based on status. `redirectUrl` validated against `APP_URL`/`NEXT_PUBLIC_APP_URL`.

### Settlement System

`Settlement` records aggregate monthly payouts per partner (DRAFT → CLOSED → APPROVED → PAID). `Invoice` and `InvoiceLine` are generated post-payment. The admin app manages settlement approvals.

## Cross-Cutting Patterns

- **Auto-save**: Debounced (1.5–2s) field changes trigger server actions → refresh site context
- **Image upload**: Vercel Blob `put()` in server actions; remote patterns whitelisted in `next.config.mjs`
- **Error handling**: Server actions return `{ status: 'ok' | 'error', errors?: string[] }`; UI shows auto-dismissing banners
- **i18n**: `next-intl` with `getRequestConfig()` from `Accept-Language` header. Message files in `messages/{en,es,fi}.json`
- **Cron jobs**: `/api/reservations-cleanup` (partner, every 15 min) cleans stale bookings; `/api/cron/send-reminders` (user, daily 07:00 UTC) sends reminder emails
- **Equipment rentals**: Sites enable via `features[]` array (add `"rentals"`). Availability checked by aggregating booked quantities for overlapping time windows

## Known Quirks

- `@repo/data` exports both Prisma client AND duplicated UI components (TextField, Button) — same components also exist in `@repo/ui`
- Export path typo: `"./PrismaCient"` (missing 'l' in Client)
- `messages/en.json` in partner app has typo: `"Acccount"` (triple 'c')
- MUI and Tailwind coexist — progressive migration toward pure Tailwind in partner app
- Brand page (`/sites/[id]/brand`) is partially implemented — client state only, not persisted
- Reservation types include "hours" and "days" but hours mode is mostly disabled in user app UI
