---
type: flow
slug: reservation-payment
status: stable
sources:
  - apps/user/app/sites/[id]/actions.ts#saveReservationForMultipleItems
  - apps/user/app/payment/Payment.tsx
  - apps/user/app/api/payment/mollie/create-payment/route.ts
  - apps/user/app/api/payment/create/route.ts
  - apps/user/app/api/webhooks/mollie/route.ts
  - apps/user/app/api/reservations/[id]/route.ts
  - apps/user/app/payment/actions.ts#initiateDemoReservationPayment
  - packages/data/src/payment.ts#processConfirmedReservation
related:
  - entity:reservation
  - entity:invoice
  - entity:service-fee
  - subsystem:payments
  - subsystem:auth
last_verified: 2026-10-08
---

# Flow: Reservation Payment

End-to-end booking → payment → invoice → confirmation email. The online path **branches at payment creation by the site's effective provider** ([[track:028-multi-provider-payments]]): **Mollie** keeps its dedicated route; **Stripe Connect** and **Viva Smart Checkout** go through the neutral `POST /api/payment/create`; **Demo** fakes the provider. All paths converge from confirmation onward (`onPaymentState` → `processConfirmedReservation`). See [[subsystem:payments]] for the provider matrix.

## Trigger

User clicks "Book" after selecting sunbeds and a date range in the consumer app (`apps/user`).

## Pre-conditions

- User is authenticated, or has an `anonId` in localStorage (`sunbnb-anonId`) for POS/QR flow.
- Site has `status: "active"`, has `appSalesEnabled` if direct online booking.
- Selected `InventoryItem`s have `status: "active"`.
- Time window does not overlap an existing `BLOCKING_STATUSES` reservation for any selected item (server-checked).

## Sequence — Mollie (the real-payment path)

1. **Create reservation** — `apps/user/app/sites/[id]/actions.ts#saveReservationForMultipleItems`
   - Auth/anonId check
   - Availability re-check inside the same operation
   - `paymentAmount` calculated from DB (`InventoryItem.price` × duration logic), not from client input
   - Insert `Reservation` with `status: pending`
2. **Enter payment step** — the booking flow mounts the in-page `Payment` component (`apps/user/app/payment/Payment.tsx`, rendered from `sites/[id]/Reservation.tsx` + the POS variants) for the new reservation — there is no standalone `/payment` route
3. **Create the payment — branches by provider.** `Payment.tsx` picks the endpoint with `checkout-endpoint.ts#usesLegacyMollieEndpoint(site.paymentProvider)` (the prop only picks a URL; the server re-resolves the provider from the reservation's site).
   - **Mollie (default / unknown)** — POST `apps/user/app/api/payment/mollie/create-payment/route.ts`
     - Entity id format validated (`isValidEntityId`)
     - Created on the PARTNER's Mollie account (OAuth access token from `PartnerAccount.mollieAccessToken`)
     - `applicationFee` collected by the platform (Mollie for Platforms model)
     - `redirectUrl` origin validated against `APP_URL` / `NEXT_PUBLIC_APP_URL` — prevents open redirect
     - Reservation updated: `paymentRef = tr_…`, `status: processing`
   - **Stripe / Viva** — POST `apps/user/app/api/payment/create/route.ts` with `{ kind: 'reservation', reservationId, anonId, redirectUrl }`
     - Provider resolved server-side; a Mollie venue gets 400 "Use the Mollie endpoint"
     - `createOnlineCheckout` (`@repo/data/checkout`) computes amount + commission like the Mollie path, then the adapter creates a Stripe **direct-charge** Checkout Session on the connected account (`application_fee_amount` = commission + processing pass-through) or a Viva Smart Checkout order
     - Ref written through `markReservationCheckoutStarted`: `stripe_cs_…` or `vso_…`, `status: processing`
4. **Redirect to the provider's hosted checkout** — user pays (and picks a method) on Mollie's / Stripe's / Viva's page, then returns to `/payment/complete?reservationId=...` (Stripe appends `stripeSession`; Viva returns via `/api/payment/viva/return`, which re-fetches before redirecting)
5. **Confirm via webhook** — every webhook re-fetches state from the provider, then calls `onPaymentState` (`apps/user/app/api/_lib/payment-events.ts`):
   - Mollie `apps/user/app/api/webhooks/mollie/route.ts` — `paymentId` format validated (`/^tr_[A-Za-z0-9]{1,50}$/`), fetched from the partner's Mollie account
   - Stripe `apps/user/app/api/webhooks/stripe-connect/route.ts` — signature-verified, requires `event.account`, re-fetches the session on that account
   - Viva `apps/user/app/api/webhooks/viva/route.ts` — unsigned; re-fetches the transaction, orderCode must match
   - Routes to `processConfirmedReservation` on `paid`; marks `payment_failed` on failed/canceled/expired
6. **Polling fallback** — `/payment/complete` mounts `VerifyPayment`, which polls GET `apps/user/app/api/reservations/[id]/route.ts`; the route re-verifies via `getPaymentStatus` (`apps/user/app/api/_lib/payment-provider.ts`) and runs `processConfirmedReservation(id)` if the webhook hasn't already.
7. **Invoice creation** — `processConfirmedReservation`:
   - **Idempotent** — bails if reservation already has `invoiceId`
   - Loads fee context (`loadFeeContext` — see `[[entity:service-fee]]`)
   - Creates PARTNER invoice with per-sunbed lines at the full listed price (gross)
   - Creates PLATFORM invoice — the commission, a B2B invoice billed to the partner; for Stripe refs also a VAT-exempt `payment-processing` line + `Invoice.processingFee` (the pass-through)
   - Sequential numbering with `FOR UPDATE` lock per issuer type
   - Hash chain extended (`computeInvoiceHash`)
   - Reservation updated: `status: complete`, `invoiceId` set
8. **Confirmation email** — `packages/data/src/reservation-emails.ts#sendConfirmationEmail` via Resend
9. **Client redirect** — polling sees `status: complete`, navigates to `/reservations/[id]`

Webhook + polling + `/api/reconcile` are three layers of confirmation; all call the same idempotent `processConfirmedReservation`, so double-firing is safe.

## Sequence — Demo (differences only)

Demo mode is enabled by `NEXT_PUBLIC_DEMO_MODE`.

3. **No provider payment** — `apps/user/app/payment/actions.ts#initiateDemoReservationPayment`
   - Generates `paymentRef = pi_demo_${timestamp}`
   - Calls `processConfirmedReservation` immediately (wrapped in try/catch for resilience)
4. **Fake redirect** — `DemoCheckoutForm` redirects to `/payment/complete` reusing the `payment_intent` query shape (a legacy Stripe-shaped contract the demo path kept)
5–6. **Polling** — same as Mollie; `isDemoPayment(ref)` (in `apps/user/app/api/_lib/payment-ids.ts`) short-circuits the provider check, treating `pi_demo_*` as succeeded

Invoice creation is real even in demo mode — only the payment provider call is faked.

## Side effects

- DB writes: `Reservation` (insert + status updates), `Invoice` (×2), `InvoiceLine` (multiple), `InventoryItemToReservation` (join rows).
- Email: confirmation via Resend (one to user, possibly one to partner per config).
- External calls: the effective provider's API — Mollie, Stripe (on the connected account) or Viva — for create + retrieve + refund on cancel.

## Failure modes

| Failure | Detection | Recovery |
|---|---|---|
| User abandons payment before confirm | Reservation stuck in `processing` | `/api/reservations-cleanup` (partner app, every 15 min) deletes stale pending/processing reservations older than 15 min |
| Mollie webhook misses (network flake) | Reservation `status: processing` despite paid on Mollie side | (a) User reloads `/payment/complete` → polling endpoint catches up; (b) `/api/reconcile` cron sweep |
| Mollie webhook bad payment id | 400 response from webhook route | Format-validated (`/^tr_…/`); legitimate retries re-fetch state from the provider |
| Mollie payment cancel/expire | Webhook receives `canceled`/`expired` | Reservation marked `payment_failed` / `canceled` |
| Demo mode `processConfirmedReservation` throws | Caught in `initiateDemoReservationPayment` try/catch | Surface as `{ status: 'error' }` to client |
| Race: two clients book same item same window | Second booking should fail availability re-check | Currently best-effort — see Common pitfalls in `[[entity:reservation]]` |
| Stripe / Viva webhook misses | Reservation `processing` despite paid | Same polling + reconcile safety nets (`getPaymentStatus` branches on the ref prefix) |
| Neither `RECONCILIATION_SECRET` nor `CRON_SECRET` set | `/api/reconcile` returns 503 | Set one (the `*/15` Vercel cron sends `CRON_SECRET`) |

## Related

- `[[entity:reservation]]` — the entity being created
- `[[entity:invoice]]` — created at step 7
- `[[entity:service-fee]]` — affects invoice line composition
- `[[subsystem:payments]]` — provider abstraction details
- `[[subsystem:auth]]` — ownership checks on polling routes
- `[[flow:order-payment]]` — same pattern (same fee handling) for F&B orders, with per-item VAT
