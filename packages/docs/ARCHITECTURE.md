# Sunbnb — Architecture

> High-level architecture of the Sunbnb platform. Module-specific ARCHITECTURE.md files will provide deeper detail for each app and package.

---

## 1. System Overview

Sunbnb is a beach booking platform that connects consumers (find and reserve sunbeds, rent equipment, order food & drinks) with site partners (manage inventory, track rentals, track revenue, fulfil orders). The platform collects a configurable service fee on every transaction.

```
┌──────────────────────────────────────────────────────────────────┐
│                        Internet / CDN                            │
│                     (Vercel Edge Network)                        │
└────────┬──────────────────┬──────────────────┬───────────────────┘
         │                  │                  │
    ┌────▼────┐       ┌─────▼─────┐      ┌────▼────┐
    │  User   │       │  Partner  │      │  Admin  │
    │  App    │       │  App      │      │  App    │
    │ :3002   │       │  :3001    │      │  :3003  │
    └────┬────┘       └─────┬─────┘      └────┬────┘
         │                  │                  │
         └────────┬─────────┴──────────────────┘
                  │
         ┌────────▼────────┐
         │   @repo/data    │    Prisma client, business logic,
         │   @repo/ui      │    shared UI components
         └────────┬────────┘
                  │
         ┌────────▼────────┐
         │   PostgreSQL    │    + PostGIS extension
         │   (Neon)        │
         └─────────────────┘
```

### External Services

```
┌─────────────┐  ┌─────────────┐  ┌──────────────┐  ┌──────────┐
│   Stripe    │  │   Mollie    │  │ Google Maps  │  │  Resend  │
│  Payments   │  │  Platforms  │  │  + Places    │  │  Email   │
└──────┬──────┘  └──────┬──────┘  └──────┬───────┘  └────┬─────┘
       │                │                │                │
       └────────────────┴────────────────┴────────────────┘
                              │
                        ┌─────▼─────┐
                        │  Vercel   │
                        │  Blob     │
                        │  Storage  │
                        └───────────┘
```

---

## 2. Monorepo Structure

The codebase is a **Turborepo** monorepo with **npm workspaces**. Turborepo orchestrates builds, dev servers, and linting with task dependencies defined in `turbo.json`.

### Workspace Layout

| Path | Package Name | Purpose |
|---|---|---|
| `apps/user` | — | Consumer-facing Next.js app |
| `apps/partner` | — | Partner portal Next.js app |
| `apps/admin` | — | Platform admin Next.js app |
| `packages/data` | `@repo/data` | Prisma client, schema, migrations, shared business logic |
| `packages/ui` | `@repo/ui` | Shared React UI components |
| `packages/docs` | — | Architecture and documentation |
| `packages/eslint-config` | `@repo/eslint-config` | Shared ESLint configurations |
| `packages/typescript-config` | `@repo/typescript-config` | Shared `tsconfig.json` presets |

### Dependency Graph

```
apps/user ──────┐
apps/partner ───┤──▶ @repo/data ──▶ Prisma / PostgreSQL
apps/admin ─────┤──▶ @repo/ui
                │──▶ @repo/eslint-config
                └──▶ @repo/typescript-config
```

All three apps import `@repo/data` for database access and business logic, and `@repo/ui` for shared components. They do **not** import from each other.

### Task Pipeline

| Task | Depends On | Caching |
|---|---|---|
| `build` | `^build` (packages first) | `.next/**` (excluding cache) |
| `dev` | — | Not cached, persistent |
| `lint` | `^lint` | Cached |

Environment variables are declared in `turbo.json` → `globalEnv` to ensure correct cache invalidation when secrets change.

---

## 3. Application Layer

All three apps are **Next.js 14** applications using the **App Router** (`app/` directory). They share the same structural conventions.

### Rendering Strategy

| Component Type | Data Strategy | Example |
|---|---|---|
| Server Components (default) | Direct Prisma queries, no API layer | Site detail pages, dashboard |
| Client Components (`'use client'`) | RTK Query polling, server actions, `fetch()` | Payment forms, map interactions |
| Server Actions (`'use server'`) | Direct Prisma mutations with auth checks | Reservation creation, account updates |
| API Routes (`route.ts`) | Request/response handlers for webhooks, external APIs | Stripe/Mollie webhooks, Places proxy |

### HTTPS in Development

Both `partner` and `user` apps use a custom `server.js` that wraps Next.js in an HTTPS server using local `mkcert` certificates (`./certificates/`). This satisfies OAuth provider requirements and Secure cookie policies during development.

- Partner: `https://local.sunbnb.app:3001`
- User: `https://local.sunbnb.app:3002`
- Admin: `https://local.sunbnb.app:3003`

### Security Headers

All apps set the following response headers via `next.config.mjs`:

- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`
- `Permissions-Policy: camera=(), microphone=(), geolocation=(self)`

---

## 4. Data Layer

### Database

**PostgreSQL** hosted on **Neon**, with the **PostGIS** extension for geospatial queries. Accessed exclusively through Prisma 7 using the `@prisma/adapter-pg` driver adapter.

### Prisma Client

Defined in `packages/data/index.ts`. Uses the **singleton pattern** with `globalThis` caching to prevent connection pool exhaustion during development hot reloads. All apps import it as:

```typescript
import prisma from '@repo/data/PrismaCient'
```

### Schema Organisation

The Prisma schema (`packages/data/prisma/schema.prisma`) defines all models in a single file. Key domain areas:

- **Auth** — User, Account, Session, VerificationToken, Authenticator, PasswordResetToken
- **Partner Management** — PartnerAccount, SecurityToken, Subscription, SubscriptionPlan
- **Sites & Inventory** — Site, SiteBrand, SiteWorkingHours, InventoryItem, ItemGroup, Product
- **Bookings** — Reservation (M:N with InventoryItem), Order, OrderItem
- **Equipment Rentals** — RentalItem, RentalBooking (with operational status tracking)
- **Billing** — Invoice, InvoiceLine, ServiceFee, Settings

### PostGIS

Site locations are stored as `geometry` columns with GiST indexes. Spatial queries use raw SQL via Prisma's `$queryRaw`:

- `ST_DistanceSphere` — distance between user and site
- `ST_MakePoint` — point creation from lat/lng
- `ST_Centroid` / `ST_Collect` / `ST_Extent` — map bounds calculation

---

## 5. Authentication

All apps use **NextAuth v5** with the **JWT strategy** (no database sessions). The NextAuth config is per-app (`app/auth.ts`), but all share the same Prisma adapter and User table.

| App | Providers | Notes |
|---|---|---|
| User | Google, Facebook, Credentials (email + bcrypt) | Anonymous users supported via `anonId` (UUID in localStorage) |
| Partner | Google | Single OAuth provider |
| Admin | Google | Restricted to sudo users |

### Anonymous Users

The user app supports anonymous booking via **QR code / POS flows**. An `anonId` is generated client-side (UUID, stored in `localStorage('sunbnb-anonId')`), passed to server actions and API routes, and stored on reservations/orders. This enables payment and receipt access without login.

### Authorisation Patterns

- **Server Actions**: Check `auth()` at the top; verify resource ownership before mutation
- **API Routes**: Use `getRequestIdentity()` + `verifyOwnership()` from a shared `_lib/auth.ts`
- **Partner App**: `authorizeSite()` verifies the user owns the site or has `sudo` privileges

---

## 6. Payment System

The platform supports two payment providers, selectable per partner site:

### Stripe

- **Integration**: Stripe PaymentIntents + Elements (embedded card form)
- **Webhooks**: POST `/api/webhooks/stripe` — signature-verified via `STRIPE_WEBHOOK_SECRET`
- **Flow**: Create PaymentIntent → embedded form → confirm → webhook or polling confirms status
- **Refunds**: Issued from server actions via `stripe.refunds.create()`

### Mollie for Platforms

- **Integration**: OAuth-based, payments created on partner's Mollie account
- **Business Model**: Partner is Merchant of Record; platform commission via `applicationFee`
- **Webhooks**: POST `/api/webhooks/mollie` — fetches payment from partner's account to verify
- **Flow**: Create payment → redirect to Mollie checkout → webhook or polling confirms status

### Demo Mode

Controlled by `NEXT_PUBLIC_DEMO_MODE` env var. Generates fake `pi_demo_*` payment references and immediately runs the invoice creation pipeline. Allows testing the full booking flow without real payment providers.

### Reconciliation

A dedicated endpoint (POST `/api/reconcile`) finds reservations and orders stuck in `processing` state and resolves them by checking the actual payment provider status. Protected by `RECONCILIATION_SECRET`. Can be triggered by Vercel Cron or manually.

### Service Fee Model

Platform revenue is collected as a service fee on every transaction. Fee resolution follows a **three-tier cascade**:

1. **Site-level** — fee configured on the specific site
2. **Partner-level** — fee configured on the partner account
3. **Platform-level** — global default from Settings

Each fee can be `fixed` (flat amount) or `percentage` (multiplier, e.g. 0.10 = 10%). Two service codes: `sunbed-rental` (deducted from partner revenue) and `food-and-beverage` (added to customer total).

### Invoice Pipeline

All confirmed payments produce invoices via idempotent processors:

- `processConfirmedReservation(id)` — creates partner + platform invoice lines per item
- `processConfirmedOrder(id)` — creates partner + platform invoice lines per order item + single fee line

---

## 7. State Management (Client)

Client-side state in both apps uses **Redux Toolkit** with **RTK Query** for server-state caching.

| Concern | Tool | Example |
|---|---|---|
| UI state | Redux slices (via `createKeyValueSlice` factory) | Selected items, map center, panel position |
| Server state | RTK Query | Reservation polling, Places autocomplete |
| Forms | React `useFormState` + server actions | Account settings, site settings |
| Auth state | NextAuth `useSession()` | Header user dropdown |

RTK Query is used primarily for **polling** (payment verification) and **caching** (places autocomplete, reservation data).

---

## 8. External Integrations

### Google Maps

- **Server-side**: `GOOGLE_MAPS_API_KEY` used in server-only Places API proxy routes (autocomplete, details). Input-validated and length-limited to prevent API key abuse.
- **Client-side**: Separate `NEXT_PUBLIC_GOOGLE_MAPS_CLIENT_KEY` (HTTP-referrer-restricted) passed as prop from server components. Falls back to the server key if not yet configured.
- **Library**: `@vis.gl/react-google-maps` for interactive maps (site discovery, inventory editor, sunbed selection).

### Vercel Blob

Image uploads (site covers, product photos, brand backgrounds) use `@vercel/blob` via `put()` in server actions. Remote patterns whitelisted in `next.config.mjs`.

### Resend

Password reset emails sent via the Resend API (`RESEND_API_KEY`). Initialised lazily to avoid build-time env var requirements.

### Internationalisation

All apps use **next-intl** with server-side locale detection from `Accept-Language` headers. Message bundles in `messages/{en,es,fi}.json`. The user app has the fullest coverage; the partner app has minimal translations.

---

## 9. Deployment

### Hosting

All apps deploy to **Vercel** in the **Frankfurt (`fra1`)** region. Each app is a separate Vercel project linked to the same Git repository.

### Branch Strategy

```
main ──promote-to-test.sh──▶ test ──deploy-to-production.sh──▶ production
```

| Branch | Vercel Environment | Purpose |
|---|---|---|
| `main` | Preview | Active development |
| `test` | Preview (staging) | Pre-production validation |
| `production` | Production | Live traffic |

Promotion scripts are simple shell scripts that merge between branches and push.

### Cron Jobs

| Job | App | Schedule | Purpose |
|---|---|---|---|
| `/api/reservations-cleanup` | Partner | Every 15 min | Deletes stale pending/processing reservations older than 15 min |
| `/api/cron/send-reminders` | User | Daily 07:00 UTC | Sends reminder emails for today's reservations (protected by `CRON_SECRET`) |

### Environment Configuration

Environment variables are managed per-app in Vercel's dashboard. `turbo.json` declares all environment variables in `globalEnv` to ensure Turborepo invalidates build caches when secrets change. See `PROJECT_CONTEXT.md` for the full variable list.

---

## 10. Cross-Cutting Concerns

### Error Handling

Server actions return `{ status: 'ok' | 'error', errors?: string[] }`. UI components display success/error banners with auto-dismiss.

### Security

Comprehensive hardening applied across all apps (documented in `PROJECT_CONTEXT.md` § Security Hardening):

- All server actions and API routes verify authentication and resource ownership
- Input validation (length limits, format checks, numeric range validation)
- Rate limiting on auth endpoints (in-memory sliding window)
- Webhook signature verification (Stripe) and payload format validation (Mollie)
- SHA-256 token hashing for password reset tokens
- IDOR protection on all user-facing data access paths

### Equipment Rental System

Sites can enable an equipment rental feature (surfboards, kayaks, etc.) alongside sunbed bookings. Controlled by a `features` string array on Site (`["sunbeds", "rentals"]`).

- **RentalItem** — inventory definition: name, category, dual pricing (per hour + per day), total quantity, active toggle
- **RentalBooking** — individual booking: quantity, time range, duration type, total price, payment status
- **Operational status flow**: `reserved` → `picked-up` → `returned` (tracked via `operationalStatus`, `pickedUpAt`, `returnedAt`)
- **Availability check** — aggregates booked quantities (excluding returned/cancelled) for overlapping time windows against `totalQuantity`
- **Partner manage page** — staff see active rental bookings with one-tap status buttons ("Give 🤝" / "Back ✓"), plus a walk-in rental modal
- **User booking flow** — tab toggle between ⛱️ Sunbeds and 🏄 Equipment, cart with quantity steppers, hourly/daily pricing
- **Walk-in rentals** — partner creates on-site rentals with 2-tap flow: tap item → tap GO. Duration quick-pick (1h/2h/3h/all day), optional guest name and cash/free payment hidden behind "More options"

Design optimised for outdoor staff (surf instructors) on low-end phones: huge touch targets, high-contrast colors, emoji-based actions, minimal reading.

### Auto-Save Pattern

The partner app uses a debounced auto-save pattern (1.5–2s delay) for form fields. Changes trigger server actions that persist to the database and refresh the site context.

### Image Handling

All image uploads go through server actions → Vercel Blob. Remote image domains are whitelisted in `next.config.mjs`. Images are stored with dimensions for responsive rendering.
