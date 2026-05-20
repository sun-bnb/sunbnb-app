---
type: subsystem
slug: payments
status: stable
sources:
  - apps/user/app/api/_lib/payment-provider.ts
  - apps/user/app/api/_lib/stripe.ts
  - apps/user/app/api/_lib/mollie.ts
  - apps/user/app/api/payment/stripe/payment-intent/route.ts
  - apps/user/app/api/payment/mollie/create-payment/route.ts
  - apps/user/app/api/webhooks/stripe/route.ts
  - apps/user/app/api/webhooks/mollie/route.ts
  - apps/user/app/api/reconcile/route.ts
  - apps/user/app/payment/actions.ts
  - packages/data/src/payment.ts
  - .claude/rules/payments.md
related:
  - entity:invoice
  - entity:service-fee
  - flow:reservation-payment
  - flow:order-payment
  - flow:rental-booking
last_verified: 2026-05-20
---

# Subsystem: Payments

Three payment paths (Stripe, Mollie for Platforms, Demo) behind a provider-agnostic abstraction. Webhook + polling + reconciliation as three layers of confirmation.

## Provider matrix

| Provider | Used for | Direction | Money flow |
|---|---|---|---|
| **Stripe** | Consumer reservations & orders; partner subscriptions | Direct charge | Card → Stripe → platform account |
| **Mollie for Platforms** | Consumer reservations & orders for partners using Mollie | Marketplace | Card → Mollie → partner Mollie account (with `applicationFee` routed to platform) |
| **Demo** | `NEXT_PUBLIC_DEMO_MODE=true` | Faked | No real money; `paymentRef = pi_demo_<timestamp>` |

Per-site provider choice: stored on `Site` (via `setPaymentProvider` action in `apps/partner/app/sites/[id]/site-actions.ts`). Mollie requires the partner has connected via OAuth (`mollieAccessToken` on `PartnerAccount`).

## Provider abstraction

`apps/user/app/api/_lib/payment-provider.ts` is the boundary:

```ts
getPaymentStatus(paymentRef)          // resolves Stripe or Mollie or demo
isPaymentSucceeded(status) / isPaymentFailed(status)  // provider-agnostic
issueRefund(paymentRef)               // routes to the correct provider
```

**Always use these helpers** in code that needs to be provider-agnostic (polling endpoints, reconciliation, refunds). Direct Stripe/Mollie calls belong only inside payment creation routes and webhook handlers.

### Default-deny check

Use `=== 'paid'` (or `isPaymentSucceeded(status)`), NEVER `!== 'unpaid'`. Unknown payment types must fail closed.

### Demo detection

`isDemoPayment(ref)` in `apps/user/app/api/_lib/stripe.ts` — checks for `pi_demo_` prefix. **Always check before any provider API call.** Demo payments otherwise look identical to real ones in downstream code (invoice creation runs unchanged).

### Entity id validation

`isValidEntityId(value)` — checks for CUID or UUID v4. Used at the entry of payment-intent routes so a malformed id never reaches Stripe.

## Stripe specifics

- Client: `getStripeClient()` — throws if `STRIPE_SECRET_KEY` missing
- Webhook signature: `Stripe.webhooks.constructEvent(body, sig, STRIPE_WEBHOOK_SECRET)`. **Reject malformed.**
- Events handled: `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded`
- PI metadata: stores `reservationId` / `orderId` / `rentalBookingPaymentRef` to find the row on webhook
- Amount: stored in cents (multiply by 100), currency from `Site` or platform default

## Mollie specifics

- Client: `getMollieClientForPartner(accessToken)` — partner-scoped, never global
- Token freshness: `getValidMollieToken(partnerAccount)` — refreshes via OAuth if expired
- Payment lookup on webhook: `findPartnerTokenForPayment(paymentId)` walks `PartnerAccount` rows to find the owning partner (the webhook gives only a payment id, not which account it belongs to)
- Payment id format: `/^tr_[A-Za-z0-9]{1,50}$/` — webhook validates before fetch
- Redirect URL: origin validated against `APP_URL` / `NEXT_PUBLIC_APP_URL` to prevent open redirect
- `applicationFee`: platform commission, routed to platform account

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
| Stripe | `apps/user/app/api/webhooks/stripe/route.ts` | `stripe-signature` header via `STRIPE_WEBHOOK_SECRET` |
| Mollie | `apps/user/app/api/webhooks/mollie/route.ts` | Payment id format regex + provider state fetch |

Both routes call into `processConfirmed*` from `@repo/data/payment` — same idempotent logic as the polling fallback. Double-firing is safe.

## Reconciliation

`apps/user/app/api/reconcile/route.ts`:

- Requires `RECONCILIATION_SECRET` env var (returns 503 if unset; mandatory)
- Caller must present matching `Authorization: Bearer <secret>` or equivalent (read route for the exact header check)
- Sweeps reservations / orders / rental bookings in `processing` state; queries the provider; runs `processConfirmed*` if status is succeeded
- The safety net for missed webhooks; should be wired to a cron in production

## Refunds

`issueRefund(paymentRef)` in `apps/user/app/api/_lib/payment-provider.ts`:
- Stripe: creates a `Refund` on the PI
- Mollie: creates a refund on the partner's payment

Triggered from `apps/user/app/reservations/[id]/actions.ts#cancelReservation` (and similar order/rental cancel actions). Updates reservation `status: refunded` on success.

## Configuration

Env vars (all required for the providers you use):

- `STRIPE_SECRET_KEY`, `STRIPE_PUBLIC_KEY`, `STRIPE_WEBHOOK_SECRET`
- `MOLLIE_CLIENT_ID`, `MOLLIE_CLIENT_SECRET`, `MOLLIE_REDIRECT_URI`
- `NEXT_PUBLIC_DEMO_MODE` — boolean-ish, enables demo path
- `RECONCILIATION_SECRET` — required (503 if unset)
- `APP_URL` / `NEXT_PUBLIC_APP_URL` — used for redirect URL validation
- `CRON_SECRET` — for cron-triggered reconcile in production

## Invariants

1. **Idempotency end-to-end.** Webhook, polling, and reconciliation can all fire for the same payment. Each downstream `processConfirmed*` is idempotent.
2. **All money math via `round()`** from `@repo/data`. VAT-inclusive everywhere; reverse-VAT for splits.
3. **No client-supplied prices.** Server fetches from DB.
4. **Webhook signature verification is non-negotiable.** Don't add a debug bypass.
5. **Generic error messages on payment failures.** Never leak internal details (PI id, Mollie error.detail, DB row id) to the client. Pattern: `"Payment could not be processed. Please try again or contact support."`

## Related

- `[[entity:invoice]]` — created downstream of every confirmed payment
- `[[entity:service-fee]]` — drives the commission line
- `[[flow:reservation-payment]]`, `[[flow:order-payment]]`, `[[flow:rental-booking]]` — three flows that all feed into this subsystem

## Common pitfalls

- **Skipping `isDemoPayment` check** before calling Stripe — Stripe will 404 on a `pi_demo_*` id.
- **Hardcoding currency.** Use site / platform config.
- **Calling Stripe SDK at module load.** Lazy-init via `getStripeClient()`.
- **Forgetting `applicationFee` on Mollie.** Then the platform takes nothing.
- **Trusting `payment_intent` query params on the return URL.** Always re-verify with the provider.
- **Logging full webhook payloads.** Contains PII / partial card data.
- **Re-issuing refunds because the first one's response was lost.** Provider also has idempotency keys — use them where available.
