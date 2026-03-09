# Security Follow-Up Tasks

## Environment Variables (Vercel)

### 1. `NEXT_PUBLIC_GOOGLE_MAPS_CLIENT_KEY`

- **App(s):** user
- **Urgency: High — deploy before production launch.**
  Without this, the server-side `GOOGLE_MAPS_API_KEY` (which has no HTTP-referrer restriction) is exposed to the browser as a fallback. An attacker can extract it from client JS and use it for unrestricted Maps/Places billing against your account.
- **How to complete:**
  1. Go to [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials).
  2. Create a new API key. Under "Application restrictions", choose **HTTP referrers** and add your production domain(s) (e.g. `https://app.sunbnb.com/*`).
  3. Under "API restrictions", limit to **Maps JavaScript API** and **Places API**.
  4. In Vercel → user app → Settings → Environment Variables, add `NEXT_PUBLIC_GOOGLE_MAPS_CLIENT_KEY` with the new key.
  5. Redeploy. The 6 pages that reference `process.env.NEXT_PUBLIC_GOOGLE_MAPS_CLIENT_KEY` will pick it up.

### 2. `RECONCILIATION_SECRET`

- **App(s):** user
- **Urgency: High — required for payment reconciliation to work.**
  The `/api/reconcile` endpoint returns 503 ("Reconciliation not configured") if this is missing. This means Stripe/Mollie cannot trigger reconciliation jobs.
- **How to complete:**
  1. Generate a strong secret: `openssl rand -base64 32`
  2. In Vercel → user app → Settings → Environment Variables, add `RECONCILIATION_SECRET` for all environments (production, preview, development).
  3. Configure your Stripe/Mollie webhook or cron job caller to pass this secret in the `Authorization: Bearer <secret>` header (or as the query/body parameter used by `apps/user/app/api/reconcile/route.ts`).

### 3. `ALLOWED_ORIGINS`

- **App(s):** all (consumed by `packages/data/src/password-reset.ts`)
- **Urgency: Medium — important before production, not blocking development.**
  Without this, password-reset emails accept any `Origin` header value, meaning an attacker could craft a request with a malicious origin and the reset link would point to their domain. When set, unrecognised origins are silently rejected.
- **How to complete:**
  1. Determine all legitimate app origins: `https://app.sunbnb.com`, `https://partner.sunbnb.com`, `https://admin.sunbnb.com` (plus any preview/staging URLs).
  2. In Vercel → each app → Settings → Environment Variables, add `ALLOWED_ORIGINS` as a comma-separated string, e.g.: `https://app.sunbnb.com,https://partner.sunbnb.com,https://admin.sunbnb.com`
  3. Alternatively, set it once in a shared Vercel environment-variable group if you use one.

---

## Cron & Reservation Emails

### 6. `CRON_SECRET` — Protect Reminder Cron Endpoint

- **App(s):** user
- **Urgency: High — set before production launch.**
  The `/api/cron/send-reminders` endpoint sends reminder emails for today's reservations. Without `CRON_SECRET`, the endpoint is unprotected and anyone who discovers the URL can trigger mass emails.
- **How to complete:**
  1. Generate a strong secret: `openssl rand -base64 32`
  2. In Vercel → user app → Settings → Environment Variables, add `CRON_SECRET` for production.
  3. Vercel Cron automatically sends this as `Authorization: Bearer <CRON_SECRET>` when configured in the same project.

### 7. Cron Schedule Timezone

- **File:** `apps/user/vercel.json`
- **Urgency: Low — adjust when you know your primary market.**
  The cron is set to `0 7 * * *` (7:00 UTC). In Spain/Mediterranean (CEST, UTC+2), this fires at 9:00 AM local time. Verify this is the desired reminder time for your target market, and adjust the hour if needed. Vercel Cron schedules are always in UTC.

### 4. OAuth Account Linking — Password Verification on First Link

- **File:** `apps/user/app/auth.ts`, `apps/partner/app/auth.ts` (GoogleProvider, FacebookProvider)
- **Urgency: Low — nice-to-have, not a launch blocker.**
  `allowDangerousEmailAccountLinking: true` lets OAuth sign-in auto-link to an existing credentials-only account by email match. An attacker who controls a Google/Facebook account with the victim's email could gain access. In practice, this requires the attacker to already own a verified Google/Facebook account with the target email — a rare scenario — and the admin app mitigates this further with an `adminUser` allowlist.
- **How to complete:**
  1. In the `signIn` callback, detect when an OAuth sign-in would link to a user that has a `password` field set but no existing `Account` record for that provider.
  2. Instead of auto-linking, redirect to a page asking the user to confirm by entering their existing password.
  3. Upon successful password verification, programmatically create the `Account` link and continue the sign-in flow.
  4. This is a non-trivial UX change — consider implementing it as a future feature sprint.

### 5. Rate Limiter — Upgrade to Redis/Upstash

- **File:** `packages/data/src/rate-limit.ts`
- **Urgency: Low — current implementation works for moderate traffic.**
  The in-memory `Map`-based rate limiter resets on each Vercel serverless cold start. Under sustained distributed attacks, each new instance starts with a clean slate, effectively bypassing the limit. For normal usage and burst protection, it works fine.
- **How to complete:**
  1. Install `@upstash/ratelimit` and `@upstash/redis` in `packages/data`.
  2. Create an Upstash Redis database at [upstash.com](https://upstash.com) (free tier is sufficient).
  3. Replace the `rateLimit()` function body with Upstash's sliding-window algorithm:
     ```ts
     import { Ratelimit } from '@upstash/ratelimit'
     import { Redis } from '@upstash/redis'
     const redis = Redis.fromEnv()  // reads UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN
     const limiter = new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(5, '15 m') })
     ```
  4. Keep the existing in-memory implementation as a fallback when `UPSTASH_REDIS_REST_URL` is not set, so local dev continues to work without Redis.
  5. Add `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` to Vercel env vars.
