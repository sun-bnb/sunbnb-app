---
type: subsystem
slug: payments
status: stable
sources:
  - apps/user/app/api/_lib/payment-provider.ts
  - apps/user/app/api/_lib/payment-ids.ts
  - apps/user/app/api/_lib/mollie.ts
  - apps/user/app/api/payment/mollie/create-payment/route.ts
  - apps/user/app/api/webhooks/mollie/route.ts
  - apps/user/app/api/reconcile/route.ts
  - apps/user/app/payment/actions.ts
  - packages/data/src/payment.ts
  - apps/user/service/siteService.ts#searchSites
  - apps/partner/app/api/_lib/mollie-permissions.ts
  - apps/partner/app/api/_lib/mollie.ts
  - .claude/rules/payments.md
related:
  - entity:invoice
  - entity:service-fee
  - flow:reservation-payment
  - flow:order-payment
  - flow:rental-booking
  - subsystem:auth
last_verified: 2026-08-09
---

# Subsystem: Payments

**Consumer payment is Mollie-for-Platforms + Demo** behind a provider-agnostic abstraction. Webhook + polling + reconciliation as three layers of confirmation. Consumer Stripe was **removed** (2026-05-23) — see [[track:003-stripe-connect-compliance]]; Stripe now only powers **partner subscriptions** (a separate concern, partner app, platform-as-merchant).

## Provider matrix

| Provider | Used for | Direction | Money flow |
|---|---|---|---|
| **Mollie for Platforms** | All real consumer reservations & orders | Marketplace | Card → Mollie → partner Mollie account (with `applicationFee` routed to platform) |
| **Demo** | `NEXT_PUBLIC_DEMO_MODE=true` | Faked | No real money; `paymentRef = pi_demo_<timestamp>` |
| **Stripe** | Partner **subscriptions only** (not consumer) | Direct charge | Card → Stripe → platform account (correct for SaaS billing) |

Per-site consumer provider: stored on `Site` (via `setPaymentProvider` in `apps/partner/app/sites/[id]/site-actions.ts`) — **only `'mollie'` is accepted** (`VALID_PAYMENT_PROVIDERS = { 'mollie' }`), and it requires the partner has connected via OAuth (`mollieAccessToken` on `PartnerAccount`). The earlier consumer-Stripe path (platform-collecting reservation/order PaymentIntents) was deleted; if it ever returns it must be built on Stripe Connect from the start ([[track:003-stripe-connect-compliance]]).

## Discovery visibility gate (payment capability)

Consumer site discovery — `apps/user/service/siteService.ts#searchSites`, the only such query (it powers both the `/sites` SSR list and the `/api/sites` coordinate search) — **hides any venue that can't actually take payment**. A `Site` is listed only when:

- **all its services are off-platform** — `type`, `order_payment_type`, and `rental_payment_type` are each `IS DISTINCT FROM 'paid'` (paid on-site / outside the platform; no online payment), **OR**
- the owning **`PartnerAccount` has completed Mollie onboarding** — `mollieAccessToken IS NOT NULL` **AND** `mollieOnboardingStatus = 'completed'`.

Rationale: a venue advertising an online-paid service it has no way to charge is unusable for the guest, so it's gated out of discovery. The clause references **only Mollie** — Stripe is not part of consumer payability today.

The same `searchSites` WHERE also requires `status = 'active'`, a name, a valid non-zero location, a cover image, ≥1 `active` `InventoryItem`, ≥1 `SiteWorkingHours`, and (for `type = 'paid'`) a positive `price` + a `vat`. Restaurants have no separate consumer-discovery query yet — they're reached via their linked Site, so this gate governs their consumer visibility too.

## Provider abstraction

`apps/user/app/api/_lib/payment-provider.ts` is the boundary:

```ts
getPaymentStatus(paymentRef)          // resolves Mollie or demo
isPaymentSucceeded(status) / isPaymentFailed(status)  // provider-agnostic
issueRefund(paymentRef)               // routes to Mollie (demo: no-op)
```

**Always use these helpers** in code that needs to be provider-agnostic (polling endpoints, reconciliation, refunds). Direct Mollie calls belong only inside the payment creation route and webhook handler.

### Default-deny check

Use `=== 'paid'` (or `isPaymentSucceeded(status)`), NEVER `!== 'unpaid'`. Unknown payment types must fail closed.

### Demo detection

`isDemoPayment(ref)` in `apps/user/app/api/_lib/payment-ids.ts` — checks for `pi_demo_` prefix. **Always check before any provider API call.** Demo payments otherwise look identical to real ones in downstream code (invoice creation runs unchanged).

### Entity id validation

`isValidEntityId(value)` in `payment-ids.ts` — checks for CUID or UUID v4. Used at the entry of the Mollie create-payment route so a malformed id never reaches the provider.

## Stripe (subscriptions only — not consumer)

Consumer Stripe was **removed** (2026-05-23). Stripe survives **only** for partner subscription billing — a *separate* subsystem from this consumer-payment one:

- Client: `getStripeClient()` in `apps/partner/app/api/_lib/stripe.ts` — throws if `STRIPE_SECRET_KEY` missing
- Subscription webhook: `apps/partner/app/api/subscription/webhook/route.ts`, signature-verified via `STRIPE_SUBSCRIPTION_WEBHOOK_SECRET` (a distinct secret from the old consumer `STRIPE_WEBHOOK_SECRET`, now unused)
- Platform-as-merchant is **correct** here (the platform bills the partner for SaaS) — unlike the removed consumer path. [[track:003-stripe-connect-compliance]] covers what a compliant consumer Stripe (Connect) would require if it ever returns.

## Mollie specifics

- Client: `getMollieClientForPartner(accessToken)` — partner-scoped, never global
- Token freshness: `getValidMollieToken(partnerAccountId)` — refreshes via OAuth if expired
- Payment lookup on webhook: `findPartnerAccountForPayment(paymentRef)` → `partnerAccountId | null`, resolving which partner owns a payment (the webhook gives only a payment id, not the account); it also resolves dine-in tab `paymentRef`s
- Payment id format: `/^tr_[A-Za-z0-9]{1,50}$/` — webhook validates before fetch
- Redirect URL: origin validated against `APP_URL` / `NEXT_PUBLIC_APP_URL` to prevent open redirect
- `applicationFee`: platform commission, routed to platform account

### Granted scopes can be narrower than requested

A partner's OAuth grant is frozen at the scope set in force when they authorized. Adding a scope to `OAUTH_SCOPE_LIST` affects **new authorizations only** — a refresh-token exchange never widens an existing grant — so a partner who connected earlier keeps the narrower one and the new capability fails with a 403 for them alone. Only re-consent fixes it: `/api/mollie/authorize` sends `approval_prompt=force`, which re-prompts an already-connected partner so the grant is re-issued.

- `OAUTH_SCOPE_LIST` (`apps/partner/app/api/_lib/mollie-permissions.ts`) is the single source of truth for both the authorize URL and the missing-scope check — `OAUTH_SCOPES` in `_lib/mollie.ts` is just its `+`-joined form. A second copy would let the two drift.
- Mollie has **no token-introspection endpoint**, but `GET /v2/permissions` reports every permission with a `granted` boolean for the calling token and requires no scope of its own — so even a minimal legacy grant can answer the question.
- `resolveMissingMollieScopes(userId)` runs in the partner `jwt` callback at sign-in only (one call per login, not per request) and stamps `missingMollieScopes` on the session; the shell renders a reconnect banner from it. It **fails open** — a 401, timeout, malformed body or DB error yields `[]`, never "missing everything", since the output drives a banner telling partners to reconnect their payment provider.
- Detection cadence is therefore tied to session length — see `[[subsystem:auth]]`.

## Demo specifics

`NEXT_PUBLIC_DEMO_MODE=true` enables. Demo actions live in `apps/user/app/payment/actions.ts`:

- `initiateDemoReservationPayment(reservationId, anonId?)`
- `initiateDemoOrderPayment(orderId, anonId?)`
- `initiateDemoRentalPayment(rentalBookingId, anonId?)`

Each:
1. Generates `paymentRef = 'pi_demo_' + Date.now()`
2. Wraps `processConfirmedReservation/Order/RentalBooking` in try/catch (so demo failures don't crash the UI flow)
3. Returns `{ status: 'ok', paymentRef }` or `{ status: 'error', errors: [...] }`

Anonymous demo payments require `anonId` argument and verify ownership via `anonId`.

## Webhooks

| Webhook | Route | Verification |
|---|---|---|
| Mollie | `apps/user/app/api/webhooks/mollie/route.ts` | Payment id format regex + provider state fetch |

The Mollie webhook calls into `processConfirmed*` from `@repo/data/payment` — same idempotent logic as the polling fallback and reconcile. Double-firing is safe. (The partner subscription webhook is separate — see the Stripe section above.)

## Reconciliation

`apps/user/app/api/reconcile/route.ts`:

- Requires `RECONCILIATION_SECRET` env var (returns 503 if unset; mandatory)
- Caller must present matching `Authorization: Bearer <secret>` or equivalent (read route for the exact header check)
- Sweeps reservations / orders / rental bookings in `processing` state; queries the provider; runs `processConfirmed*` if status is succeeded
- The safety net for missed webhooks; should be wired to a cron in production

## Refunds

`issueRefund(paymentRef)` in `apps/user/app/api/_lib/payment-provider.ts`:
- Mollie: creates a refund on the partner's payment for the full amount
- Demo: no-op

Triggered from `apps/user/app/reservations/[id]/actions.ts#cancelReservation` (and similar order/rental cancel actions). Updates reservation `status: refunded` on success.

## Configuration

Env vars (all required for the providers you use):

- `MOLLIE_CLIENT_ID`, `MOLLIE_CLIENT_SECRET`, `MOLLIE_REDIRECT_URI`
- `NEXT_PUBLIC_DEMO_MODE` — boolean-ish, enables demo path
- `RECONCILIATION_SECRET` — required (503 if unset)
- `APP_URL` / `NEXT_PUBLIC_APP_URL` — used for redirect URL validation
- `CRON_SECRET` — for cron-triggered reconcile in production
- *(subscriptions, partner app — separate subsystem)* `STRIPE_SECRET_KEY` + `STRIPE_SUBSCRIPTION_WEBHOOK_SECRET`. The old consumer `STRIPE_PUBLIC_KEY` / `STRIPE_WEBHOOK_SECRET` are no longer used.

## Invariants

1. **Idempotency end-to-end.** Webhook, polling, and reconciliation can all fire for the same payment. Each downstream `processConfirmed*` is idempotent.
2. **All money math via `round()`** from `@repo/data`. VAT-inclusive everywhere; reverse-VAT for splits.
3. **No client-supplied prices.** Server fetches from DB.
4. **Verify webhook authenticity, never trust the payload.** Mollie sends only a payment id — validate its format, then re-fetch state from the provider; don't add a bypass. (The partner subscription webhook verifies a Stripe HMAC signature.)
5. **Generic error messages on payment failures.** Never leak internal details (PI id, Mollie error.detail, DB row id) to the client. Pattern: `"Payment could not be processed. Please try again or contact support."`

## Related

- `[[entity:invoice]]` — created downstream of every confirmed payment
- `[[entity:service-fee]]` — drives the commission line
- `[[flow:reservation-payment]]`, `[[flow:order-payment]]`, `[[flow:rental-booking]]` — three flows that all feed into this subsystem

## Common pitfalls

- **Skipping `isDemoPayment` check** before calling Mollie — a `pi_demo_*` id has no provider record.
- **Hardcoding currency.** Use site / platform config.
- **Forgetting `applicationFee` on Mollie.** Then the platform takes nothing.
- **Trusting return-URL query params** (`reservationId` / `payment_intent`). Always re-verify status with the provider before treating a payment as paid.
- **Logging full webhook payloads.** Contains PII / partial card data.
- **Re-issuing refunds because the first one's response was lost.** Provider also has idempotency keys — use them where available.
- **Assuming a connected partner holds every scope we request.** Grants are frozen at authorization time; check `missingMollieScopes` (or expect a 403) rather than treating "connected" as "fully permissioned".
