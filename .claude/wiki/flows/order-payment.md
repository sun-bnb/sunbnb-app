---
type: flow
slug: order-payment
status: stable
sources:
  - apps/user/app/reservations/[id]/actions.ts#createOrder
  - apps/user/app/api/order-payment/mollie/create-payment/route.ts
  - apps/user/app/api/orders/[id]/route.ts
  - apps/user/app/payment/actions.ts#initiateDemoOrderPayment
  - packages/data/src/payment.ts#processConfirmedOrder
  - packages/data/src/payment.ts#calculateOrderServiceFee
related:
  - entity:order
  - entity:invoice
  - entity:service-fee
  - flow:reservation-payment
  - subsystem:payments
last_verified: 2026-05-23
---

# Flow: Order Payment

F&B order placement → payment → invoice. Structurally similar to `[[flow:reservation-payment]]` but with **service fee added to customer total**, **per-item VAT**, and **single line per order item**.

## Trigger

User opens the menu inside an active reservation (`/reservations/[id]`, in `Menu` component) and submits a basket.

## Pre-conditions

- Site has `appSalesEnabled: true`.
- The user owns the parent reservation (or matches via `anonId`).
- Each Product is `active` and not soldOut.
- Quantities are positive integers.

## Sequence

1. **Create order** — `apps/user/app/reservations/[id]/actions.ts#createOrder`
   - Auth or anonId check
   - For each line: server fetches `Product` by id, snapshots `name`, `price` (net), `tax` (rate), `totalPrice` (gross) into `OrderItem`. **Client-supplied price is ignored.**
   - Validates `active`, soldOut, quantity > 0
   - Inserts `Order` (status `pending`) + `OrderItem` rows in a transaction
2. **Calculate service fee** — `calculateOrderServiceFee(orderId)` resolves via the three-tier cascade with `serviceCode: 'food-and-beverage'`. Result is added to customer total.
3. **Create Mollie payment** — POST `apps/user/app/api/order-payment/mollie/create-payment/route.ts`
   - Amount = `order.totalPrice + serviceFee`  ← **fee ADDED, unlike reservations**
   - `paymentRef` stored on Order; `status: processing`
4. **Mollie redirect / Demo** — same patterns as `[[flow:reservation-payment]]`
5. **Verify** — GET `apps/user/app/api/orders/[id]/route.ts` polled by client
   - Checks payment status via `getPaymentStatus` (provider-agnostic)
   - On succeeded → `processConfirmedOrder(id)`
6. **Invoice creation** — `processConfirmedOrder`:
   - **Idempotent** — bails if order already has `invoiceId`
   - Loads fee context for `'food-and-beverage'`
   - PARTNER invoice: one `food-and-beverage` line per item at full price (per-item VAT from `OrderItem.tax`), plus one `sunbnb-service-fee` line (sign convention per source)
   - PLATFORM invoice: commission line
   - Sequential numbering + hash chain (same as reservations)
   - Order: `status: complete`, `invoiceId` set
7. **Order moves into fulfillment** — partner sees it in `apps/partner/app/sites/[id]/orders`; status transitions: `complete → accepted → preparing → ready → delivered → completed`

## Key differences vs `[[flow:reservation-payment]]`

| Aspect | Reservation | Order |
|---|---|---|
| Service fee | **Deducted** from partner revenue (customer pays listed price) | **Added** to customer total (customer pays more) |
| VAT | Site-wide rate (`Site.vat`) | Per-item rate (snapshot in `OrderItem.tax`) |
| Invoice lines | One per sunbed + fee line | One per `OrderItem` + fee line |
| Fulfillment | Operational status separate (`expected → checked-in → departed`) | Fulfilment chained into the single `status` field |
| Status field count | Two (`status`, `operationalStatus`) | One (`status`) |

## Side effects

- DB writes: `Order`, `OrderItem` (multiple), `Invoice` (×2), `InvoiceLine` (multiple).
- External: Mollie API (real); none in demo.
- No automatic email at this time (verify in code before claiming — `[[entity:order]]` does not document order-paid emails as of `last_verified`).

## Failure modes

| Failure | Detection | Recovery |
|---|---|---|
| Abandoned payment | Order `status: processing` | Cleanup cron does not (currently) clean abandoned orders — verify per the partner cron route |
| Webhook miss | Polling on `/api/orders/[id]` is fallback | `/api/reconcile` sweeps orders too |
| Race: two clients order the last unit of a soldOut product | `createOrder` re-checks soldOut at insert — second loses | Returns `{ status: 'error' }` |

## Related

- `[[entity:order]]` — the entity being created
- `[[entity:invoice]]` — created at step 6
- `[[entity:service-fee]]` — added (not deducted) here
- `[[flow:reservation-payment]]` — sibling flow

## Common pitfalls

- **Modelling order fee logic after reservation fee logic.** Direction is reversed. Always check.
- **Calculating fee on net instead of gross.** `calculateServiceFeeAmount` uses gross — match it.
- **Trusting client-side basket totals.** Server recomputes from snapshots.
- **Missing per-item VAT.** Orders don't use `Site.vat`. Each `OrderItem.tax` is its own rate.
