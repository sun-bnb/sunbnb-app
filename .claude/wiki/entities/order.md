---
type: entity
slug: order
status: stable
sources:
  - packages/data/prisma/schema.prisma#model-Order
  - packages/data/prisma/schema.prisma#model-OrderItem
  - packages/data/prisma/schema.prisma#model-Product
  - packages/data/src/reservation-status.ts
  - packages/data/src/payment.ts#processConfirmedOrder
  - apps/user/app/reservations/[id]/actions.ts#createOrder
  - apps/partner/app/sites/[id]/orders
related:
  - entity:reservation
  - entity:invoice
  - entity:service-fee
  - flow:order-payment
last_verified: 2026-05-20
---

# Order

An F&B order placed during (or attached to) a Reservation. Has its own lifecycle and its own invoice on confirmation.

## Schema essentials

`Order` (`packages/data/prisma/schema.prisma`):

- Identity: `id`, `userId`, `siteId`, `anonId?`.
- Linkage: `reservationId?` (the in-context reservation), `seatId?` (an `InventoryItem.id` if seat-specific).
- Money: `price` (net), `tax`, `totalPrice` (gross — what the customer pays before service fee), `paymentAmount?`, `paymentRef?`.
- Invoice link: `invoiceId?` (unique).
- Status: `status` (one field — combines payment + fulfilment for orders).

`OrderItem`:
- `orderId`, `productId`, `quantity`, snapshot of `name`, `price` (net), `tax` (rate), `totalPrice` (gross).
- Snapshot fields capture pricing at time of order — Product price changes don't retroactively alter past orders.

`Product`:
- `name`, `price` (net), `tax` (rate), `totalPrice` (gross), `siteId`, `active`. Per-product VAT (unlike sunbeds, which use site-wide VAT).

## Status lifecycle

```
pending → processing → complete → accepted → preparing → ready → delivered → completed
                                ↘ rejected
                                ↘ discarded
       ↘ payment_failed
       ↘ canceled
       ↘ refunded
```

`complete` means **paid**. `accepted` → `delivered` is the partner-side fulfilment chain in `apps/partner/app/sites/[id]/orders`. `completed` is the terminal "settled" state. Constants in `packages/data/src/reservation-status.ts` under `ORDER_*`.

## Invariants

1. **Server enforces DB prices.** `createOrder` looks up each Product by id and uses its `totalPrice`. Client-supplied price is ignored.
2. **Quantity must be positive integer.** Validated in `createOrder`.
3. **`active: false` or `soldOut: true` products cannot be ordered.** Action returns `{ status: 'error' }`.
4. **`appSalesEnabled` on the Site must be true** for consumer-app ordering (separate from in-person F&B).
5. **One Invoice per confirmed order** (1:1 via `invoiceId`), plus the corresponding platform-side invoice.
6. **Per-item VAT, not site-wide.** Unlike reservations, each `OrderItem` carries its own `tax` rate (from the source Product).
7. **Service fee is ADDED to customer total.** (Reservations *deduct* the fee from partner revenue; orders *add* the fee on top.) See `[[entity:service-fee]]`.

## Related entities

- `[[entity:reservation]]` — orders are typically (not always) created in-context of a reservation.
- `[[entity:invoice]]` — generated on payment confirmation.
- `[[entity:service-fee]]` — adds a line to the customer total; computed at order creation via `calculateOrderServiceFee`.

## Related flows

- `[[flow:order-payment]]` — full order → payment → invoice flow.

## Common pitfalls

- **Mixing reservation-fee logic and order-fee logic.** Reservations deduct; orders add. Look at which `process*` function you're modelling after.
- **Using site-wide VAT for orders.** Orders use per-item VAT from the snapshot fields in `OrderItem`.
- **Forgetting to set `paymentAmount` separately from `totalPrice`.** `paymentAmount` is what the customer actually paid (includes service fee); `totalPrice` is item total only.
- **Treating order status as a single linear chain.** It branches (`rejected`, `discarded`, `canceled`, `refunded`).
- **Allowing edit of completed orders.** Terminal states are terminal; no field mutations.
