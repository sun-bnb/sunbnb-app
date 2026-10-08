---
type: subsystem
slug: payments
status: stable
sources:
  - packages/data/src/payment-refs.ts
  - packages/data/src/payment-providers/readiness.ts
  - packages/data/src/checkout.ts
  - packages/data/src/payment.ts
  - apps/user/app/api/_lib/payment-provider.ts
  - apps/user/app/api/_lib/payment-events.ts
  - apps/user/app/api/webhooks/mollie/route.ts
  - .claude/rules/payments.md
related:
  - entity:invoice
  - entity:service-fee
  - flow:reservation-payment
  - flow:order-payment
  - flow:rental-booking
  - subsystem:auth
last_verified: 2026-10-08
---

# Subsystem: Payments

**Consumer payment is multi-provider** ([[track:028-multi-provider-payments]]): each partner selects
ONE rail per account — Mollie for Platforms, Stripe Connect, or Viva — from those available in
their country, plus Demo. The rail is identified **only by the `paymentRef` prefix** (no `Payment`
ledger), and the invoicing core (`processConfirmed*`) is provider-neutral. Webhook + polling +
reconciliation remain three layers of confirmation. Stripe additionally powers **partner
subscriptions** (platform-as-merchant — a separate concern).

## Provider matrix

| Rail | Ref prefix (`payment-refs`) | Kind | Money flow | State |
|---|---|---|---|---|
| **Mollie for Platforms** | `tr_` | online | Card → partner's Mollie account; commission as `applicationFee` | live |
| **Stripe Connect** | `stripe_cs_` (Checkout Session) | online | **Direct charge** on the partner's connected account (merchant of record); commission + processing pass-through as `application_fee_amount` | live (test-mode verified) |
| **Viva Smart Checkout** | `vso_<orderCode>` | online | Card → partner's Viva account; ISV fee withheld by Viva, credited monthly (no pass-through) | **stub** until Viva KYC clears |
| **Viva Cloud Terminal** | `viva_<sessionId>` | card-present | Server pushes the sale to the staff phone's Viva Terminal app ([[track:024-card-present-payments]]) | stub / vendor-gated |
| **Stripe Tap to Pay** | `stripe_pi_` (PaymentIntent) | card-present | `card_present` PaymentIntent on the connected account; the floor app's Terminal SDK is the reader | built, Simulator run pending |
| **Demo** | `pi_demo_<timestamp>` | faked | No money; same invoicing path | `NEXT_PUBLIC_DEMO_MODE` |

`providerFromRef(ref)` is the single discriminator — every refund, status poll, webhook and
reconcile branch dispatches on it. Never write a private `startsWith('tr_')`-style check; no
prefix is a prefix of another (hence the namespaced `stripe_*` wrappers).

## Selection model (select-then-connect)

- `PartnerAccount.paymentProvider` = the **selected** provider (`/account/payments` →
  `selectPaymentProvider`, validated against `availableProviders(country)` from the pure,
  founder-editable `payment-providers/availability.ts`). D3: one provider per account, all sites.
- `Site.paymentProvider` = the **effective** provider, never written directly:
  `syncEffectiveProvider` (`payment-providers/selection.ts`) applies `effectiveProviderFor` —
  the selection once `providerReadiness(...).ready`, else the previous effective one if it still
  works (switching never strands a venue mid-onboarding). Partner calls it after every
  connection-state write via `syncEffectiveProviderSafe`.
- Readiness: Mollie = token + onboarding `completed`; Viva = merchant id + `verified`; Stripe =
  `stripeConnectChargesEnabled`. The same predicates are inlined in the discovery SQL (below) and
  pinned by an integration test.
- `cardPresent` (`none | terminal-app | tap-to-pay`) comes from the same availability matrix and
  gates the floor app's card rails (`/api/manage/context`).
- The guest picks a payment *method* on the provider's hosted page, never a PSP (D2).

## Discovery visibility gate (payment capability)

Consumer site discovery — `apps/user/service/siteService.ts#searchSites`, the only such query (it powers both the `/sites` SSR list and the `/api/sites` coordinate search) — **hides any venue that can't actually take payment**. A `Site` is listed only when:

- **all its services are off-platform** — `type`, `order_payment_type`, and `rental_payment_type` are each `IS DISTINCT FROM 'paid'` (paid on-site / outside the platform; no online payment), **OR**
- the owning **`PartnerAccount` is ready for the site's effective provider** (`"Site".payment_provider`): Mollie token + `completed`, Viva merchant id + `verified`, or Stripe `charges_enabled`. Must agree with `payment-providers/readiness.ts` (pinned by `siteService.integration.test.ts`).

Rationale: a venue advertising an online-paid service it has no way to charge is unusable for the guest, so it's gated out of discovery.

The same `searchSites` WHERE also requires `status = 'active'`, a name, a valid non-zero location, a cover image, ≥1 `active` `InventoryItem`, ≥1 `SiteWorkingHours`, and (for `type = 'paid'`) a positive `price` + a `vat`. Restaurants have no separate consumer-discovery query yet — they're reached via their linked Site, so this gate governs their consumer visibility too.

## Provider abstraction

- **Create** — Mollie keeps its dedicated create-payment routes (byte-identical). Stripe and Viva go
  through the neutral `POST /api/payment/create` (user app), which resolves the provider
  **server-side from the entity's site** and calls `createOnlineCheckout` (`@repo/data/checkout`:
  `resolveCheckoutIntent` computes amount + commission with the same fee loaders as the Mollie
  paths, then `getOnlineAdapter('stripe'|'viva')`). Clients pick the URL with
  `apps/user/app/payment/checkout-endpoint.ts#usesLegacyMollieEndpoint`.
- **Confirm** — every webhook, poll route and reconcile funnels into one dispatcher,
  `onPaymentState(meta, ref, state)` (`apps/user/app/api/_lib/payment-events.ts`, lifted verbatim
  from the Mollie webhook), with `findPaymentEntity(ref)` to locate the entity.
- **Status / refund** — `getPaymentStatus(ref)`, `isPaymentSucceeded/Failed`, `issueRefund(ref)` in
  `apps/user/app/api/_lib/payment-provider.ts`, and `packages/data/src/refund.ts`, branch on
  `providerFromRef`. Stripe refunds pass `refund_application_fee`.

### Default-deny check

Use `=== 'paid'` (or `isPaymentSucceeded(status)`), NEVER `!== 'unpaid'`. Unknown payment types must fail closed.

### Demo detection

`isDemoPayment(ref)` lives in `@repo/data/payment-refs` (re-exported by `apps/user/app/api/_lib/payment-ids.ts`; the six old copies are gone). **Always check before any provider API call.** Demo payments otherwise look identical to real ones downstream.

### Entity id validation

`isValidEntityId(value)` in `payment-ids.ts` — checks for CUID or UUID v4. Used at the entry of the Mollie create-payment route so a malformed id never reaches the provider.

## Stripe specifics

Two clients in `@repo/data/stripe/client`: `getStripeClient()` = **partner subscriptions**
(`STRIPE_SECRET_KEY`, platform-as-merchant — correct for SaaS billing; webhook
`/api/subscription/webhook`, `STRIPE_SUBSCRIPTION_WEBHOOK_SECRET`) and `getStripeConnectClient()` =
the **Connect platform** (`STRIPE_CONNECT_SECRET_KEY`; platform = the Sunbnb Test account).

- **Accounts**: created with `CONNECT_CONTROLLER` — `requirement_collection`, `losses.payments` and
  `fees.payer` = `'application'`, `stripe_dashboard: 'none'`. Onboarding is our **own-form wizard**
  (`/account/stripe`, Accounts API); management uses embedded components via
  `/api/stripe-connect/account-session`. Consequence: the platform carries disputes/negative
  balances and is billed Stripe's processing fee.
- **Charges**: every consumer call passes `{ stripeAccount }` — **direct charges only**, never a
  platform charge ([[track:003-stripe-connect-compliance]]).
- **Tap to Pay**: `@repo/data/stripe/terminal` (location per site → `Site.stripeTerminalLocationId`,
  connection tokens, `card_present` PaymentIntents); driven by the reservation machine's
  `tapToPay` rows.

### Fee pass-through

`application_fee_amount` = commission + a processing estimate (`fee-policy.ts`,
`STRIPE_PROCESSING_ESTIMATE` 1.5% + €0.25 — one constant). For Stripe refs every
`processConfirmed*` (incl. table deposits) books it on the PLATFORM invoice as a VAT-exempt
`payment-processing` line and sets `Invoice.processingFee` (`payment.ts#platformPassThroughFor`).
Mollie and Viva pass nothing through and leave `processingFee` empty.

## Viva online specifics

`@repo/data/viva/checkout-{types,http,stub}` behind `VIVA_MODE`. Every unverified ISV field name
is confined to the one `vivaOnlineHttp` builder. Return URL `/api/payment/viva/return?t=&s=`
re-fetches before acting. The stub store lives on `globalThis` (Next dev splits API routes and
RSC pages into separate module graphs).

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

Rule: **the body only names a payment — always re-fetch state from the provider and act on that.**

| Webhook | Route | Verification |
|---|---|---|
| Mollie | user `/api/webhooks/mollie` (keep forever — in-flight payments have it baked in) | `tr_` id regex → fetch by id |
| Stripe Connect payments | user `/api/webhooks/stripe-connect` | `stripe-signature` (`STRIPE_CONNECT_WEBHOOK_SECRET`); requires `event.account`, re-fetches session / PaymentIntent with it. Events: `checkout.session.*` (completed, async succeeded/failed, expired), `payment_intent.*` (succeeded, payment_failed, canceled), `charge.refunded` |
| Stripe Connect accounts | partner `/api/stripe-connect/webhook` | `stripe-signature` (`STRIPE_CONNECT_ACCOUNT_WEBHOOK_SECRET`); `account.updated` / `capability.updated` → snapshot columns → `syncEffectiveProviderSafe` |
| Viva Smart Checkout | user `/api/webhooks/viva` | **UNSIGNED** — GET handshake returns `VIVA_WEBHOOK_VERIFICATION_KEY`; POST re-fetches the transaction, requires its orderCode to match (events 1796/1797/1798) |

All confirm paths call `processConfirmed*` from `@repo/data/payment` — idempotent, so double-firing
is safe. (The partner subscription webhook is separate — see Stripe specifics.)

## Reconciliation

`apps/user/app/api/reconcile/route.ts` (GET + POST):

- Authorized by `Bearer ${RECONCILIATION_SECRET}` **or** `Bearer ${CRON_SECRET}`; 503 only when neither is set
- Runs as a `*/15` Vercel cron (`apps/user/vercel.json`)
- Sweeps all five kinds — reservations, orders, rental bookings (paid-only), dine-in tabs, table deposits — across every provider via `providerFromRef`
- The safety net for missed webhooks

## Refunds

`issueRefund(ref)` (user) and `packages/data/src/refund.ts` dispatch on `providerFromRef`: Mollie
refund on the partner's payment; Stripe refund on the connected account with
`refund_application_fee` (`stripe_cs_` and `stripe_pi_` alike); Viva terminal via the Cloud Terminal client; Viva online via the Smart Checkout client; demo no-op; an unrecognised ref returns an error rather than guessing Mollie. Open: a refunded
online payment leaves the PLATFORM commission invoice standing (no credit note) — same as Mollie
today.

## Configuration

- Mollie: `MOLLIE_CLIENT_ID`, `MOLLIE_CLIENT_SECRET`, `MOLLIE_REDIRECT_URI`
- Stripe Connect: `STRIPE_CONNECT_SECRET_KEY` (both apps), `NEXT_PUBLIC_STRIPE_CONNECT_PUBLIC_KEY` (partner), `STRIPE_CONNECT_WEBHOOK_SECRET` (user), `STRIPE_CONNECT_ACCOUNT_WEBHOOK_SECRET` (partner)
- Viva online: `VIVA_MODE`, `VIVA_CHECKOUT_SOURCE_CODE`, `VIVA_CHECKOUT_COLOR`, `VIVA_WEBHOOK_VERIFICATION_KEY` (+ the `VIVA_ISV_*` vars in http mode)
- `NEXT_PUBLIC_DEMO_MODE` — enables demo path
- `RECONCILIATION_SECRET` / `CRON_SECRET` — reconcile auth
- `APP_URL` / `NEXT_PUBLIC_APP_URL` — redirect URL validation
- *(subscriptions, partner app)* `STRIPE_SECRET_KEY` + `STRIPE_SUBSCRIPTION_WEBHOOK_SECRET`

## Invariants

1. **Idempotency end-to-end.** Webhook, polling, and reconciliation can all fire for the same payment. Each downstream `processConfirmed*` is idempotent.
2. **All money math via `round()`** from `@repo/data`. VAT-inclusive everywhere; reverse-VAT for splits.
3. **No client-supplied prices.** Server fetches from DB.
4. **Never trust a webhook payload.** Verify what can be verified (Mollie id format, Stripe signature + `event.account`), then re-fetch state from the provider and act on that alone — Viva webhooks are unsigned, so the re-fetch is the only defence.
5. **Provider is resolved server-side.** The neutral create route reads the entity's site's effective provider; a client-sent provider is never trusted.
6. **Generic error messages on payment failures.** Never leak internal details (PI id, Mollie error.detail, DB row id) to the client. Pattern: `"Payment could not be processed. Please try again or contact support."`

## Related

- `[[entity:invoice]]` — created downstream of every confirmed payment
- `[[entity:service-fee]]` — drives the commission line
- `[[flow:reservation-payment]]`, `[[flow:order-payment]]`, `[[flow:rental-booking]]` — three flows that all feed into this subsystem

## Common pitfalls

- **Skipping `isDemoPayment` check** before calling a provider — a `pi_demo_*` id has no provider record.
- **A Stripe call without `{ stripeAccount }`.** It lands on the platform — a platform charge, the exact thing [[track:003-stripe-connect-compliance]] removed.
- **Forgetting `applicationFee` on Mollie.** Then the platform takes nothing.
- **Trusting return-URL query params** (`reservationId` / `payment_intent`). Always re-verify status with the provider before treating a payment as paid.
- **Logging full webhook payloads.** Contains PII / partial card data.
- **Re-issuing refunds because the first one's response was lost.** Provider also has idempotency keys — use them where available.
- **Assuming a connected partner holds every scope we request.** Grants are frozen at authorization time; check `missingMollieScopes` (or expect a 403) rather than treating "connected" as "fully permissioned".
