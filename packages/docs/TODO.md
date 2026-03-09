# Security Follow-Up Tasks

## Environment Variables (Vercel)

| Variable | App(s) | Priority | Action |
|---|---|---|---|
| `NEXT_PUBLIC_GOOGLE_MAPS_CLIENT_KEY` | user | High | Create an HTTP-referrer-restricted Google Maps API key and set it in Vercel. The server-side `GOOGLE_MAPS_API_KEY` is used as a fallback until this is configured. |
| `RECONCILIATION_SECRET` | user | High | Generate with `openssl rand -base64 32` and set in Vercel. The `/api/reconcile` endpoint returns 503 without it. |
| `ALLOWED_ORIGINS` | all (via packages/data) | Medium | Comma-separated list of app origins (e.g. `https://app.sunbnb.com,https://partner.sunbnb.com`). Password reset silently refuses unrecognised origins. |

## Code-Level Improvements (Non-Blocking)

### 1. OAuth Account Linking — Password Verification on First Link

- **File:** `apps/user/app/auth.ts` (GoogleProvider, FacebookProvider)
- **Issue:** `allowDangerousEmailAccountLinking: true` lets OAuth sign-in link to existing credentials-only accounts by matching email. An attacker with OAuth control of an email address could access a credentials-only account.
- **Mitigation:** Add a password verification step when an OAuth provider first links to an account that only has credentials. This is a UX/security tradeoff — the current setting is required for smooth onboarding.

### 2. Rate Limiter — Upgrade to Redis/Upstash

- **File:** `packages/data/src/rate-limit.ts`
- **Issue:** The current rate limiter is in-memory per serverless instance. Each Vercel cold start gets a fresh map, so sustained distributed attacks can bypass it.
- **Recommendation:** Swap to a Redis or Upstash-backed rate limiter for durable, cross-instance enforcement. The current implementation is sufficient for single-instance burst protection.
