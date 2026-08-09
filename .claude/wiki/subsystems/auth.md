---
type: subsystem
slug: auth
status: stable
sources:
  - apps/user/app/auth.ts
  - apps/partner/app/auth.ts
  - apps/admin/app/auth.ts
  - apps/user/app/api/_lib/auth.ts
  - .claude/rules/auth.md
  - packages/data/src/password-reset.ts
  - apps/partner/app/api/_lib/mollie-permissions.ts
related:
  - entity:reservation
  - entity:settlement
  - flow:walk-in
  - flow:reservation-payment
  - subsystem:payments
last_verified: 2026-08-09
---

# Subsystem: Auth

Three apps, three auth profiles. All use **NextAuth v5 (beta) with JWT strategy**. No database sessions.

## Per-app auth models

### `apps/user` — Consumer

- Providers: Google, Facebook, Credentials (email/password with bcrypt)
- Strategy: JWT
- Anonymous fallback: `anonId` (UUID) in `localStorage('sunbnb-anonId')` — used for POS / QR flow where the user never logs in
- Custom sign-in page: `/account`

Identity extraction in API routes:

```ts
// apps/user/app/api/_lib/auth.ts
getRequestIdentity(request, bodyAnonId?)
  → { userId?: string, anonId?: string }
```

Ownership check:

```ts
verifyOwnership(identity, entity)
  // returns true if identity.userId === entity.userId
  //          OR identity.anonId  === entity.anonId
```

**Always call `verifyOwnership` before returning or mutating** user-scoped resources (reservations, orders, rental bookings).

### `apps/partner` — Venue operator

- Providers: Google, Facebook, Credentials (email/password), plus an `impersonation` Credentials provider consuming a single-use signed token from the admin app
- Strategy: JWT, `maxAge` **8 hours**
- Guard: `app.tsx` redirects unauthenticated visitors to `/api/auth/signin` (except public routes: `/info`, `/manage`, site-slug pages)
- Authorization helpers:
  - `requireSiteOwner(siteId)` / `authorizeSite(siteId)` / `verifySiteOwnership(siteId)` — checks `session.user.id === site.userId`
  - Sudo users (`User.sudo: true`) bypass ownership checks in admin app only — **not** the partner app

**Every mutation** in the partner app goes through one of these helpers.

**`maxAge` is an idle timeout, not an absolute one.** Under the `jwt` strategy `@auth/core` re-signs the token with a fresh expiry on *every* session read (`src/lib/actions/session.ts` — `updateAge` is consulted only in the database-session branch), so an operator is never logged out mid-shift. An overnight close-to-open gap does exceed 8h, so partners sign in roughly daily. That cadence is load-bearing, not incidental: the Mollie granted-scope check runs in the `jwt` callback at sign-in only, so session length is what paces how promptly a partner learns their OAuth grant is missing a scope — see `[[subsystem:payments]]`.

### `apps/admin` — Platform admin

- Provider: Google OAuth (also Credentials per `app/api/auth/forgot-password`, `reset-password` routes)
- Guard: `requireSudo()` at the start of every action
- `requireSudo()` reads the session, looks up the user, checks `user.sudo === true`. Throws if not.

Two `requireSudo` error messages differ across files (`'sudo required'` vs `'Unauthorized — sudo required'`) — known inconsistency.

### `apps/partner/app/sites/[id]/manage` — Special case

The manage page is **public route, token-gated** — not authenticated. See `[[flow:walk-in]]`.

- `SecurityToken` table stores `id`, `expires`, `resources[]`, `userId`. No FK to User.
- Every manage action accepts an optional `accessKey` parameter.
- Validation: token exists, not expired, `resources` includes `'all'` or `'manage_site'`, `token.userId === site.userId`.
- Token issuance: `/security` page in partner app (CRUD).

## Anonymous identity (user app)

For POS / QR flows where a consumer scans a sunbed code and books without signing in:

1. Client generates a UUID on first visit, stores in `localStorage('sunbnb-anonId')`
2. Anonymous reservations carry `anonId` instead of `userId`
3. Anonymous demo payment actions accept `anonId` as a parameter
4. Ownership check matches by `anonId` instead of `userId`

`anonId` is **not authenticated** — possessing the UUID is the proof. Compromise scope: a leaked `anonId` lets an attacker see/cancel the matching reservations. Not used for anything financially sensitive beyond the booking itself.

## Password reset

Owned by `packages/data/src/password-reset.ts`. Surfaced by:
- `apps/user/app/api/auth/forgot-password/route.ts` and `reset-password/route.ts`
- `apps/partner/app/api/auth/forgot-password/route.ts` and `reset-password/route.ts`
- `apps/admin/app/api/auth/forgot-password/route.ts` and `reset-password/route.ts`

Rules (canonical in `password-reset.ts`):

1. **Tokens are SHA-256 hashed before storage.** `hashToken(raw)` is the helper. The plaintext token only appears in the email link.
2. **Origin validation** — the link URL's origin must be in `ALLOWED_ORIGINS` (comma-separated env var). Prevents email hijacking.
3. **Per-email rate limit:** 3 resets per hour.
4. **Per-IP rate limit:** 5 attempts per 15 min on `forgot-password`, on `reset-password`. Uses in-memory sliding window from `packages/data/src/rate-limit.ts` — resets on cold start (per-process).
5. **Password strength enforced at redemption:** 8+ chars with upper + lower + digit. (Note: the `reset-password` API route in user app validates ">= 6 chars" — known mismatch with the canonical 8-char rule.)
6. **Previous tokens invalidated** when a new request for the same email comes in.
7. **Token expiry enforced** at redemption time.

## Configuration

Env vars:
- `AUTH_SECRET` — JWT signing secret. Required.
- `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` — Google OAuth.
- `AUTH_FACEBOOK_ID`, `AUTH_FACEBOOK_SECRET` — Facebook OAuth (user app only).
- `ALLOWED_ORIGINS` — comma-separated, required for password reset.
- `RESEND_API_KEY` — for sending reset emails.

## Invariants

1. **Status of session is never inferred from headers.** Always `auth()` (NextAuth v5) — never read JWT cookies manually.
2. **`User.sudo` grants platform admin access** — across admin app. Does **not** bypass partner-app site ownership checks.
3. **Anonymous (`anonId`) flows never have access to sudo or partner data.** Their scope is their own reservations/orders.
4. **Token-gated manage actions never check `session.user`.** They are designed to work without a session.
5. **`accessKey` validation must be applied per action**, not at a middleware layer — each action calls the validator.

## Related

- `[[entity:reservation]]` — ownership is the most common gate
- `[[entity:settlement]]` — sudo-only
- `[[flow:walk-in]]` — the token-gated path
- `[[flow:reservation-payment]]` — ownership checks on payment-verification polling

## Common pitfalls

- **Adding a new mutation to the partner app without `requireSiteOwner`.** Always check.
- **Using `session.user.id` in the manage page.** It will be undefined for token-only access.
- **Storing the plaintext reset token in the DB.** Always hash with `hashToken()` first.
- **Trusting `anonId` for anything beyond ownership of self-owned records.** It is not authentication.
- **Forgetting `ALLOWED_ORIGINS` in a new env** — password reset will fail-closed.
- **Reading `maxAge` as an absolute session lifetime, or expecting `updateAge` to throttle the refresh.** Under the JWT strategy it is a pure idle timeout; anything needing a guaranteed periodic re-login must stamp its own absolute-expiry claim in the `jwt` callback.
