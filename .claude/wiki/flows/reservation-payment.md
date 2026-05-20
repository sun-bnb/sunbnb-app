---
type: flow
slug: reservation-payment
status: stable
sources:
  - apps/user/app/sites/[id]/actions.ts#saveReservationForMultipleItems
  - apps/user/app/payment/Payment.tsx
  - apps/user/app/api/payment/stripe/payment-intent/route.ts
  - apps/user/app/api/payment/mollie/create-payment/route.ts
  - apps/user/app/api/webhooks/stripe/route.ts
  - apps/user/app/api/webhooks/mollie/route.ts
  - apps/user/app/api/reservations/[id]/route.ts
  - apps/user/app/payment/actions.ts#initiateDemoReservationPayment
  - apps/user/app/api/reconcile/route.ts
  - packages/data/src/payment.ts#processConfirmedReservation
  - packages/data/src/reservation-emails.ts
related:
  - entity:reservation
  - entity:invoice
  - entity:service-fee
  - subsystem:payments
  - subsystem:auth
last_verified: 2026-05-20
---

# Flow: Reservation Payment

End-to-end booking → payment → invoice → confirmation email. Covers all three payment paths (Stripe, Mollie, Demo) — they diverge in step 3–5 and converge from step 6 onward.

## Trigger

User clicks "Book" after selecting sunbeds and a date range in the consumer app (`apps/user`).

## Pre-conditions

- User is authenticated, or has an `anonId` in localStorage (`sunbnb-anonId`) for POS/QR flow.
- Site has `status: "active"`, has `appSalesEnabled` if direct online booking.
- Selected `InventoryItem`s have `status: "active"`.
- Time window does not overlap an existing `BLOCKING_STATUSES` reservation for any selected item (server-checked).

## Sequence — Stripe

1. **Create reservation** — `apps/user/app/sites/[id]/actions.ts#saveReservationForMultipleItems`
   - Auth/anonId check
   - Availability re-check inside the same operation
   - `paymentAmount` calculated from DB (`InventoryItem.price` × duration logic), not from client input
   - Insert `Reservation` with `status: pending`
2. **Navigate** — client routed to `/payment` with the new reservation id
3. **Create Stripe PaymentIntent** — POST `apps/user/app/api/payment/stripe/payment-intent/route.ts`
   - Entity id format validated (`isValidEntityId`)
   - `Stripe.paymentIntents.create({ amount: reservation.paymentAmount × 100, currency, metadata })`
   - Reservation updated: `paymentRef = pi.id`, `status: processing`
4. **Stripe Elements** — `PaymentElement` renders card form (`StripePayment` component)
5. **Confirm** — `stripe.confirmPayment({ confirmParams: { return_url: '/payment/complete?...' } })` — Stripe handles 3DS, then redirects
6. **Verify** — `/payment/complete` mounts `VerifyPayment`, which polls GET `apps/user/app/api/reservations/[id]/route.ts`
   - Route checks Stripe PI status via `getStripePaymentStatus(paymentRef)`
   - On `'succeeded'` → calls `processConfirmedReservation(id)` (`packages/data/src/payment.ts`)
7. **Invoice creation** — `processConfirmedReservation`:
   - **Idempotent** — bails if reservation already has `invoiceId`
   - Loads fee context (`loadFeeContext` — see `[[entity:service-fee]]`)
   - Creates PARTNER invoice with per-sunbed lines + fee line (fee deducted)
   - Creates PLATFORM invoice with commission line
   - Sequential numbering with `FOR UPDATE` lock per issuer type
   - Hash chain extended (`computeInvoiceHash`)
   - Reservation updated: `status: complete`, `invoiceId` set
8. **Confirmation email** — `packages/data/src/reservation-emails.ts#sendConfirmationEmail` via Resend
9. **Client redirect** — polling sees `status: complete`, navigates to `/reservations/[id]`

Webhook safety net: `apps/user/app/api/webhooks/stripe/route.ts` handles `payment_intent.succeeded` / `.payment_failed` / `charge.refunded` and runs the same `processConfirmedReservation` if not already done. Signature verified via `STRIPE_WEBHOOK_SECRET`.

## Sequence — Mollie (differences only)

3. **Create Mollie payment** — POST `apps/user/app/api/payment/mollie/create-payment/route.ts`
   - Created on the PARTNER's Mollie account (OAuth access token from `PartnerAccount.mollieAccessToken`)
   - `applicationFee` collected by the platform (Mollie for Platforms model)
   - `redirectUrl` origin validated against `APP_URL` / `NEXT_PUBLIC_APP_URL` — prevents open redirect
   - Reservation updated: `paymentRef = mollie payment id`, `status: processing`
4. **Redirect to Mollie checkout** — user pays on Mollie's hosted page
5. **Mollie webhook** — POST `apps/user/app/api/webhooks/mollie/route.ts`
   - `paymentId` format validated (`/^tr_[A-Za-z0-9]{1,50}$/`)
   - Finds partner via `findPartnerTokenForPayment`
   - Fetches payment from partner's Mollie account
   - Routes to `processConfirmedReservation` on `paid`, marks failed on `failed`/`canceled`/`expired`
6. **Polling fallback** — same as Stripe; the polling route knows about both providers via `getPaymentStatus` in `apps/user/app/api/_lib/payment-provider.ts`

## Sequence — Demo (differences only)

Demo mode is enabled by `NEXT_PUBLIC_DEMO_MODE`.

3. **No PaymentIntent** — `apps/user/app/payment/actions.ts#initiateDemoReservationPayment`
   - Generates `paymentRef = pi_demo_${timestamp}`
   - Calls `processConfirmedReservation` immediately (wrapped in try/catch for resilience)
4. **Fake redirect** — `DemoCheckoutForm` simulates redirect with fake query params
5–6. **Polling** — same as Stripe; `isDemoPayment(ref)` (in `apps/user/app/api/_lib/stripe.ts`) short-circuits the provider check, treats `pi_demo_*` as succeeded

Invoice creation is real even in demo mode — only the payment provider call is faked.

## Side effects

- DB writes: `Reservation` (insert + status updates), `Invoice` (×2), `InvoiceLine` (multiple), `InventoryItemToReservation` (join rows).
- Email: confirmation via Resend (one to user, possibly one to partner per config).
- External calls: Stripe API (intent create + retrieve), Mollie API (payment create + retrieve).

## Failure modes

| Failure | Detection | Recovery |
|---|---|---|
| User abandons payment before confirm | Reservation stuck in `processing` | `/api/reservations-cleanup` (partner app, every 15 min) deletes stale pending/processing reservations older than 15 min |
| Webhook misses (network flake, Stripe outage) | Reservation `status: processing` despite paid PI on Stripe side | (a) User reloads `/payment/complete` → polling endpoint catches up; (b) `/api/reconcile` cron sweep |
| Webhook signature invalid | 400 response from webhook route | Diagnostic: check `STRIPE_WEBHOOK_SECRET` matches dashboard |
| Mollie payment cancel/expire | Webhook receives `canceled`/`expired` | Reservation marked `payment_failed` / `canceled` |
| Demo mode `processConfirmedReservation` throws | Caught in `initiateDemoReservationPayment` try/catch | Surface as `{ status: 'error' }` to client |
| Race: two clients book same item same window | Second booking should fail availability re-check | Currently best-effort — see Common pitfalls in `[[entity:reservation]]` |
| `RECONCILIATION_SECRET` not set | `/api/reconcile` returns 503 | Set the env var (required) |

## Related

- `[[entity:reservation]]` — the entity being created
- `[[entity:invoice]]` — created at step 7
- `[[entity:service-fee]]` — affects invoice line composition
- `[[subsystem:payments]]` — provider abstraction details
- `[[subsystem:auth]]` — ownership checks on polling routes
- `[[flow:order-payment]]` — same pattern but for F&B orders (with fee added rather than deducted)
