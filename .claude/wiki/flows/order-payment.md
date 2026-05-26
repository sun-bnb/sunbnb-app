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
last_verified: 2026-05-26
---

# Flow: Order Payment

F&B order placement → payment → invoice. Structurally similar to `[[flow:reservation-payment]]` — fee handling is identical (the customer pays the product total; the commission is carved out via Mollie `applicationFee`) — differing only in **per-item VAT** and **single line per order item**.

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
2. **Calculate service fee** — `calculateOrderServiceFee(orderId)` resolves via the three-tier cascade with `serviceCode: 'food-and-beverage'`. This is the platform commission, carved out of the payment via Mollie `applicationFee` — the customer pays the product total, the fee is not added on top.
3. **Create Mollie payment** — POST `apps/user/app/api/order-payment/mollie/create-payment/route.ts`
   - Created on the partner's Mollie account; amount = `order.paymentAmount` (the product total). Commission collected as `applicationFee` (carved out, **not** added) — same as reservations.
   - `paymentRef` stored on Order; `status: processing`
4. **Mollie redirect / Demo** — same patterns as `[[flow:reservation-payment]]`
5. **Verify** — GET `apps/user/app/api/orders/[id]/route.ts` polled by client
   - Checks payment status via `getPaymentStatus` (provider-agnostic)
   - On succeeded → `processConfirmedOrder(id)`
6. **Invoice creation** — `processConfirmedOrder`:
   - **Idempotent** — bails if order already has `invoiceId`
   - Loads fee context for `'food-and-beverage'`
   - PARTNER invoice: one `food-and-beverage` line per item at full price (gross; per-item VAT from `OrderItem.tax`)
   - PLATFORM invoice: the `sunbnb-service-fee` commission line, billed B2B to the partner (recipient = partner; reverse-charge for cross-border EU B2B)
   - Sequential numbering + hash chain (same as reservations)
   - Order: `status: complete`, `invoiceId` set
7. **Order moves into fulfillment** — partner sees it in `apps/partner/app/sites/[id]/orders`; status transitions: `complete → accepted → preparing → ready → delivered → completed`

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
- `[[entity:service-fee]]` — the commission, billed B2B to the partner (same as reservations)
- `[[flow:reservation-payment]]` — sibling flow

## Common pitfalls

- **Assuming orders add the fee to the customer total.** They don't — orders run like reservations: the customer pays the product total and the commission is carved out via `applicationFee`.
- **Calculating fee on net instead of gross.** `calculateServiceFeeAmount` uses gross — match it.
- **Trusting client-side basket totals.** Server recomputes from snapshots.
- **Missing per-item VAT.** Orders don't use `Site.vat`. Each `OrderItem.tax` is its own rate.
