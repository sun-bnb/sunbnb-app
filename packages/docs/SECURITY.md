# Sunbnb — Security Architecture

> Comprehensive overview of security measures, design decisions, and hardening applied across the Sunbnb platform. Last updated March 2026.

---

## 1. Authentication

### NextAuth v5 (Auth.js)

All three apps (user, partner, admin) use **NextAuth v5 beta** with a **JWT session strategy** and a shared Prisma adapter.

- **Providers:** Google OAuth, Facebook OAuth (user app only), email/password credentials
- **Session token:** Signed JWT stored in a `Secure; HttpOnly; SameSite=Lax` cookie (`__Secure-authjs.session-token` in production, `authjs.session-token` in development)
- **Passwords:** Hashed with **bcrypt** (`bcryptjs` v3). Minimum length: 6 characters, enforced server-side in both account creation and password reset flows.
- **Custom error propagation:** `CredentialsSignin` errors use a custom `code` property to distinguish between "wrong password", "user not found", etc., without leaking information in the URL beyond a code string.

### Admin Access Control

The admin app enforces a two-tier gate:

1. **`adminUser` allowlist** — The `signIn` callback checks the `AdminUser` table. Only emails pre-registered by a sudo admin can sign in at all. All others receive `AccessDenied`.
2. **`sudo` flag** — Every server action and page in the admin app calls `requireSudo()`, which verifies the authenticated user has `user.sudo === true` in the database. This prevents any standard user (even if they somehow pass the allowlist) from performing admin operations.

### Middleware (Admin)

A Next.js middleware (`apps/admin/middleware.ts`) acts as a defence-in-depth layer. It checks for a session token cookie on every request and redirects unauthenticated requests to `/sign-in` before they reach any server component. Public routes (`/sign-in`, `/forgot-password`, `/reset-password`, `/api/auth/*`, `/api/health`) are excluded.

### Partner & User Auth

- **Partner app:** Server actions use `auth()` to get the session, then `authorizeSite(siteId)` to verify the calling user owns the target site. Every mutation checks both authentication and ownership.
- **User app:** API routes use `getRequestIdentity(request)` to extract either a `userId` (from session) or an `anonId` (from query/body param). `verifyOwnership(identity, entity)` ensures the requesting user/anonymous session owns the reservation or order being accessed.

### Anonymous Users

The user app supports unauthenticated browsing and booking via an `anonId` (a client-generated UUID stored in `localStorage` under `sunbnb-anonId`). Reservations and orders created by anonymous users are linked to this `anonId`. Ownership is verified server-side by comparing the `anonId` on the entity with the one supplied in the request.

---

## 2. Password Reset

Password reset is handled by a shared module (`packages/data/src/password-reset.ts`) used by all three apps.

### Token Security

- A random token is generated with `crypto.randomBytes(32)`.
- Only the **SHA-256 hash** of the token is stored in the database (`SecurityToken` table). The raw token is sent to the user's email.
- On reset, the submitted raw token is hashed and compared against the stored hash — the plaintext is never persisted.
- Tokens expire after **1 hour**.
- Used tokens are deleted immediately after successful password reset.
- **Per-email rate limit:** A maximum of 3 active tokens per email per hour is enforced at the database level (counting unexpired tokens).

### Origin Validation

The `ALLOWED_ORIGINS` environment variable (comma-separated) controls which origins are accepted for password reset links. If set, any request with an unrecognised `Origin` header is silently rejected (returns `{ ok: true }` to avoid leaking information). This prevents an attacker from injecting a malicious domain into the reset email link.

### Rate Limiting

- **Forgot-password:** IP-based rate limiting (5 attempts per 15 minutes) on all three apps. When rate-limited, a success-like response is returned to avoid leaking the rate-limit state to attackers.
- **Reset-password:** IP-based rate limiting (5 attempts per 15 minutes) to prevent brute-force token guessing.

---

## 3. API & Route Security

### HTTP Security Headers

All apps set the following headers via `next.config.mjs`:

| Header | Value | Purpose |
|--------|-------|---------|
| `X-Frame-Options` | `DENY` | Prevent clickjacking |
| `X-Content-Type-Options` | `nosniff` | Prevent MIME-type sniffing |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Limit referrer leakage |
| `X-DNS-Prefetch-Control` | `on` | DNS prefetch for performance |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` | Enforce HTTPS (2 years) |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` | Disable unused browser features |

### Input Validation

- **Google Places proxy** (`/api/places/autocomplete`, `/api/places/details`): Input length limit (200 chars), regex validation on `placeId` (`/^[A-Za-z0-9_-]+$/`).
- **Site search** (`searchSites`): Latitude/longitude validated as numeric with range checks (-90/90 latitude, -180/180 longitude).
- **Account forms:** Server-side trim, length limits, and email format validation on all user-facing forms.
- **Availability endpoint:** Date parameters validated as required, parseable, correctly ordered, and within a maximum 90-day range.
- **Settlement actions:** Date period validation (start < end, valid ISO dates).
- **Fee management:** Charge type, service code, and amount validation with nullable field handling.
- **Mollie webhook:** Payment ID format validation (`/^tr_[A-Za-z0-9]{1,50}$/`) to reject malformed webhook calls.
- **Mollie payment creation:** `redirectUrl` origin validated against `APP_URL` to prevent open redirect.

### Server Actions

All admin server actions (`settlements/actions.ts`, `fees/actions.ts`, `sites/actions.ts`, `platform/actions.ts`, `users/actions.ts`) call `requireSudo()` as the first line, which:
1. Verifies the session exists (`auth()`)
2. Loads the user from DB and checks `sudo === true`
3. Throws an error if either check fails

Partner server actions use the same pattern with `auth()` + `authorizeSite()`.

### Health Endpoint

The admin health endpoint (`/api/health`) returns only basic status (`healthy`/`degraded` + timestamp) to unauthenticated users. Full operational details (DB latency, site/user counts) are only included when the caller is an authenticated sudo user.

---

## 4. IDOR Protection (Insecure Direct Object Reference)

Several user-facing routes were hardened to prevent IDOR attacks:

- **Reservation pass** (`/reservations/[id]/pass`): Requires authentication or `anonId` ownership — users cannot view another user's reservation pass.
- **Reservation receipt** (`/reservations/[id]/receipt`): Same ownership verification for both reservation and order receipt paths.
- **Payment complete** (`/payment/complete`): Verifies the requesting user/anonymous session owns the reservation/order being marked as complete.
- **Demo payment actions:** `anonId` is passed as a parameter and verified against the entity for anonymous user flows.

---

## 5. Payment Security

### Dual Provider Architecture

The platform supports both **Stripe** and **Mollie** payment providers, configurable per site.

- **Stripe:** Uses PaymentIntents + Elements. Webhook signature verification via `STRIPE_WEBHOOK_SECRET`.
- **Mollie for Platforms:** Uses OAuth-based partner access tokens with automatic refresh. Application fees are charged on each transaction.
- **Demo mode:** Controlled by `NEXT_PUBLIC_DEMO_MODE` (server-set). Demo payments use a `pi_demo_` prefix and bypass real payment provider calls.

### Webhook Security

- **Stripe:** Webhook payloads are verified using `stripe.webhooks.constructEvent()` with the `STRIPE_WEBHOOK_SECRET`.
- **Mollie:** Payment ID format is validated with regex before any database lookup or API call.

### Reconciliation

The `/api/reconcile` endpoint requires a `RECONCILIATION_SECRET` (returns 503 if unset). This ensures only authorised systems (cron jobs, admin tools) can trigger payment reconciliation.

### Invoice Integrity

- Invoices use a composite uniqueness constraint (`entityType` + `entityId`) preventing duplicate invoice creation.
- `FOR UPDATE` row locking is used during invoice creation to prevent race conditions in concurrent payment flows.
- Financial rounding uses consistent 2-decimal-place rounding throughout all fee calculations.

---

## 6. Data Layer Security

### Prisma Singleton

The Prisma client uses a `globalThis` caching pattern (`packages/data/index.ts`) to prevent connection pool exhaustion during hot reloads in development and across serverless function invocations.

### Database Access Patterns

- No raw user input is interpolated into SQL — all queries use Prisma's parameterised query builder or tagged template literals (`prisma.$queryRaw\`...\``).
- PostGIS spatial queries use `prisma.$queryRawUnsafe()` but only with server-computed numeric values (latitude/longitude already validated).

### Sensitive Data Handling

- Passwords are never returned from database queries in API responses.
- Password reset tokens are stored as SHA-256 hashes — the plaintext token only exists in the email.
- Mollie access tokens (partner OAuth) are stored encrypted in the `PartnerAccount` table and refreshed automatically when expired.

---

## 7. Cookie Security

- NextAuth session cookies use `Secure` flag in production (HTTPS-only).
- `HttpOnly` attribute prevents JavaScript access to session cookies.
- `SameSite=Lax` provides basic CSRF protection for the session cookie.
- Development uses non-`Secure` cookies to work with local HTTPS (mkcert).

---

## 8. OAuth Security

### `allowDangerousEmailAccountLinking`

All apps use `allowDangerousEmailAccountLinking: true` on OAuth providers (Google, Facebook). This allows OAuth sign-in to auto-link to an existing credentials-based account by email match.

**Risk:** An attacker who controls a Google/Facebook account with the victim's email address could gain access to their credentials-based account.

**Mitigations:**
- **Admin app:** The `adminUser` allowlist blocks any email not pre-approved, making this a non-issue — even with a matching OAuth account, the attacker cannot pass the sign-in callback.
- **Partner/User apps:** The risk requires the attacker to own a verified Google/Facebook account with the target's email — a rare and difficult scenario. A future improvement (documented in TODO.md) would add a password-verification step when OAuth first links to a credentials-only account.

---

## 9. Deployment Security

### Vercel Configuration

- **Region:** All apps deploy to `fra1` (Frankfurt) for EU data residency.
- **Branch strategy:** `main` → test, `test` → production. No direct production pushes.
- **Cron jobs:** Partner app runs `reservations-cleanup` every 15 minutes (Vercel cron in `vercel.json`), cleaning up stale pending/processing reservations.

### Local Development

All apps run with HTTPS via mkcert certificates (`./certificates/local.sunbnb.app-*.pem`), ensuring secure cookies and OAuth callbacks work identically to production.

### Environment Variable Segregation

Secrets (`AUTH_SECRET`, `STRIPE_SECRET_KEY`, `MOLLIE_CLIENT_SECRET`, etc.) are stored in Vercel environment variables, never committed to the repository. Public-facing env vars use the `NEXT_PUBLIC_` prefix and are limited to non-sensitive configuration.

---

## 10. Rate Limiting

### Current Implementation

An in-memory sliding-window rate limiter (`packages/data/src/rate-limit.ts`) with periodic cleanup:

| Route | Key | Limit | Window |
|-------|-----|-------|--------|
| Forgot password (all apps) | `forgot-password:{ip}` | 5 attempts | 15 min |
| Reset password (all apps) | `reset-password:{ip}` | 5 attempts | 15 min |
| Password reset emails (per-email) | Database count | 3 tokens | 1 hour |

### Limitations

The in-memory rate limiter resets on each serverless cold start. For sustained distributed attacks, each new Vercel function instance starts fresh. This is documented as a future improvement (upgrade to Redis/Upstash) in `packages/docs/TODO.md`.

---

## 11. Security Decisions Log

| Decision | Rationale |
|----------|-----------|
| JWT over database sessions | Stateless verification at edge; no DB round-trip for session validation |
| `allowDangerousEmailAccountLinking` enabled | Required for smooth onboarding when users switch between credentials and OAuth; mitigated by allowlist (admin) and rarity of exploit (user/partner) |
| In-memory rate limiter (not Redis) | Sufficient for launch; avoids additional infrastructure dependency; upgrade path documented |
| SHA-256 for token hashing (not bcrypt) | Password reset tokens are high-entropy random bytes — SHA-256 is appropriate and fast. Bcrypt is used for passwords which may have low entropy |
| `DENY` for X-Frame-Options (not `SAMEORIGIN`) | No legitimate reason to embed any Sunbnb app in an iframe |
| Server-side availability check before reservation | Prevents double-booking by checking inventory in the same transaction as the reservation insert |
| Silent responses for sensitive operations | Forgot-password, origin-validation, and rate-limit failures all return success-like responses to prevent enumeration |
| `FOR UPDATE` locking on invoice creation | Prevents duplicate invoices from concurrent webhook/redirect race conditions |
| Health endpoint split (public/sudo) | Basic health status visible on sign-in page for operational awareness; detailed counts restricted to authenticated admins |
