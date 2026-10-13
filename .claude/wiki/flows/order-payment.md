---
type: flow
slug: order-payment
status: stable
sources:
  - apps/user/app/reservations/[id]/actions.ts#createOrder
  - apps/user/app/api/order-payment/mollie/create-payment/route.ts
  - apps/user/app/api/orders/[id]/route.ts
  - apps/user/app/api/payment/create/route.ts
  - packages/data/src/checkout.ts#createOnlineCheckout
  - apps/user/app/payment/actions.ts#initiateDemoOrderPayment
  - packages/data/src/payment.ts#processConfirmedOrder
related:
  - entity:order
  - entity:invoice
  - entity:service-fee
  - flow:reservation-payment
  - subsystem:payments
last_verified: 2026-10-13
---

# Flow: Order Payment

F&B order placement → payment → invoice. Structurally similar to `[[flow:reservation-payment]]` — fee handling is identical (the customer pays the product total; the commission is carved out as the provider's application fee) — differing only in **per-item VAT** and **single line per order item**.

## Trigger

User opens the menu inside an active reservation (`/reservations/[id]`, in `Menu` component) and submits a basket.

## Pre-conditions

- Site has `appSalesEnabled: true`.
- The user owns the parent reservation (or matches via `anonId`).
- Each Product is `active` and not soldOut.
- Quantities are positive integers.

## Sequence

1. **Create order** — `apps/user/app/reservations/[id]/actions.ts#createOrder`
   - Validates `siteId`, item count/quantities (positive ints, ≤ 50 distinct, ≤ 200 total), entity ids; site must have `appSalesEnabled`
   - Session user, or `anonId` (order `userId` = site owner to satisfy the FK); reservation ownership checked when `reservationId` is given
   - Fetches `Product`s scoped to the site with `active: true`, rejects `soldOut`; snapshots `name`, line `price` (net), `tax` (rate), line `totalPrice` (gross) into `OrderItem`. **Client-supplied price is ignored.**
   - Single nested `order.create` with `status: pending`, `paymentAmount = totalPrice`
2. **Create payment** — the provider is resolved server-side from `Site.paymentProvider` (see `[[subsystem:payments]]`):
   - **Mollie** — POST `apps/user/app/api/order-payment/mollie/create-payment/route.ts`: ownership via `verifyOwnership`; payment on the partner's Mollie account for `order.paymentAmount`; commission = `chargeableServiceFee(resolveServiceFee(…, 'food-and-beverage', tier), partnerAccount, order.createdAt)` → `applicationFee` (carved out, **not** added).
   - **Stripe Connect / Viva** — POST `apps/user/app/api/payment/create/route.ts` (`kind: 'order'`) → `createOnlineCheckout` (requires `status: pending`, no existing `paymentRef`; direct charge on the connected account with `application_fee_amount`).
   - **Demo** — `initiateDemoOrderPayment` mints a `pi_demo_*` ref.
   - `paymentRef` stored on Order; `status: processing`
3. **Provider redirect / webhook** — same patterns as `[[flow:reservation-payment]]`; webhooks (`/api/webhooks/{mollie,stripe-connect,viva}`) re-fetch the payment and route by entity type via `apps/user/app/api/_lib/payment-events.ts`.
4. **Verify** — GET `apps/user/app/api/orders/[id]/route.ts` polled by client
   - For a `processing` order with a `paymentRef`: `getPaymentStatus` (provider-agnostic, `_lib/payment-provider.ts`); succeeded → `processConfirmedOrder(id)`; failed → `payment_failed`
5. **Invoice creation** — `processConfirmedOrder`:
   - **Idempotent** — returns if `order.invoices` is non-empty or (online) status is already `complete`; per-issuer series lock taken before the in-transaction re-check
   - Throws for site-less (dine-tab) orders — those are invoiced via `processConfirmedTabPayment`
   - PARTNER invoice: one `food-and-beverage` line per item at full price (gross; per-item VAT from `OrderItem.tax`)
   - PLATFORM invoice: `sunbnb-service-fee` commission line (+ Stripe `payment-processing` pass-through), billed B2B to the partner
   - Per-issuer numbering + hash chain — see `[[entity:invoice]]`
   - Order: `status: complete` (online path only; cash receipts via `skipCommission` leave status alone)
6. **Order moves into fulfillment** — partner sees it in `apps/partner/app/sites/[id]/orders`; status transitions: `complete → accepted → preparing → ready → delivered → completed` (or `rejected` / `discarded`)

## Key differences vs `[[flow:reservation-payment]]`

Fee handling is the **same** as reservations (gross PARTNER invoice + separate B2B commission). The remaining differences:

| Aspect | Reservation | Order |
|---|---|---|
| VAT | Site-wide rate (`Site.vat`) | Per-item rate (snapshot in `OrderItem.tax`) |
| PARTNER invoice lines | One per sunbed | One per `OrderItem` |
| Fulfillment | Operational status separate (`expected → checked-in → departed`) | Fulfilment chained into the single `status` field |
| Status field count | Two (`status`, `operationalStatus`) | One (`status`) |

## Side effects

- DB writes: `Order`, `OrderItem` (multiple), `Invoice` (×2), `InvoiceLine` (multiple).
- External: the venue's payment provider (Mollie / Stripe Connect / Viva); none in demo.
- No order-paid email.

## Failure modes

| Failure | Detection | Recovery |
|---|---|---|
| Abandoned payment | Order `status: processing` | Not cleaned by `/api/reservations-cleanup` (reservations only); `/api/reconcile` re-checks stuck orders |
| Webhook miss | Polling on `/api/orders/[id]` is fallback | `/api/reconcile` sweeps orders too |
| Product sold out mid-basket | `createOrder` checks `soldOut` before insert (not atomic — `soldOut` is a manual flag, not stock) | Returns `{ status: 'error' }` |

## Related

- `[[entity:order]]` — the entity being created
- `[[entity:invoice]]` — created at step 6
- `[[entity:service-fee]]` — the commission, billed B2B to the partner (same as reservations)
- `[[flow:reservation-payment]]` — sibling flow

## Common pitfalls

- **Assuming orders add the fee to the customer total.** They don't — the customer pays the product total and the commission is carved out as the provider's application fee.
- **Passing a dine-tab order to the site order rail.** Tab rounds pay through the tab (`kind: 'tab'`); `processConfirmedOrder` throws on a site-less order.
- **Calculating fee on net instead of gross.** `calculateServiceFeeAmount` uses gross — match it.
- **Trusting client-side basket totals.** Server recomputes from snapshots.
- **Missing per-item VAT.** Orders don't use `Site.vat`. Each `OrderItem.tax` is its own rate.
