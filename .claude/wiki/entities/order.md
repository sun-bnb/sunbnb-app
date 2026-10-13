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
last_verified: 2026-10-13
---

# Order

An F&B order — placed from a sunbed reservation (site-anchored) or as a round on a dine-in tab (restaurant-anchored). Has its own lifecycle and its own invoices on confirmation.

## Schema essentials

`Order` (`packages/data/prisma/schema.prisma`):

- Identity: `id`, `userId` (anonymous orders use the site owner's id to satisfy the FK; `anonId` identifies the guest), `anonId?`.
- Anchor: `siteId?` and/or `restaurantId?` (CHECK `order_owner_chk` requires one; sunbed F&B orders carry `siteId`, standalone-restaurant tab orders only `restaurantId`).
- Linkage: `reservationId?`, `seatId?` (an `InventoryItem.id`), `tabId?` + `tableId?` (dine-in tab round — paid via the tab, see `[[subsystem:table-reservations]]`).
- Money: `price` (net), `tax` (summed VAT amount), `totalPrice` (gross), `paymentAmount?` (= `totalPrice` at creation — no fee on top), `paymentRef?`.
- Invoices: `invoices[]` (N:1 via `Invoice.orderId` — PARTNER + PLATFORM).
- Status: `status` (one field — combines payment + fulfilment), with `acceptedAt` / `readyAt` / `deliveredAt`, `rejectReason?`, `notes?`.

`OrderItem`:
- `orderId`, `productId`, `quantity`, snapshot of `name`, `price` (line net = unit × qty), `tax` (rate), `totalPrice` (line gross), `category`, `notes?`.
- Snapshot fields capture pricing at time of order — Product price changes don't retroactively alter past orders.

`Product`:
- `name`, `price` (net), `tax` (rate), `totalPrice` (gross), `siteId`, `active`, `soldOut`, `category`. Per-product VAT (unlike sunbeds, which use site-wide VAT).

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

1. **Server enforces DB prices.** `createOrder` looks up each Product by id (scoped to the site, `active: true`) and uses its `price`/`totalPrice`. Client-supplied price is ignored.
2. **Quantity must be a positive integer** (≤ 50 distinct items, ≤ 200 total). Validated in `createOrder`.
3. **`active: false` or `soldOut: true` products cannot be ordered.** Action returns `{ status: 'error' }`.
4. **`appSalesEnabled` on the Site must be true** for consumer-app ordering (separate from in-person F&B).
5. **Invoicing is idempotent on invoice existence.** `processConfirmedOrder` returns early if `order.invoices` is non-empty (or, online, status is already `complete`); tab orders are invoiced as a group by `processConfirmedTabPayment`, never here.
6. **Per-item VAT, not site-wide.** Unlike reservations, each `OrderItem` carries its own `tax` rate (from the source Product).
7. **Fee is a B2B commission to the partner, not a consumer charge.** The customer pays the product total; the partner books it gross and the commission is carved out as the provider's application fee — same as reservations. See `[[entity:service-fee]]`.

## Related entities

- `[[entity:reservation]]` — orders are typically (not always) created in-context of a reservation.
- `[[entity:invoice]]` — generated on payment confirmation.
- `[[entity:service-fee]]` — the `food-and-beverage` commission, resolved at payment creation (not at order creation) and billed B2B to the partner.

## Related flows

- `[[flow:order-payment]]` — full order → payment → invoice flow.

## Common pitfalls

- **Assuming the order fee is a consumer charge or reduces booked revenue.** It's a B2B commission to the partner: the partner books gross and the commission is carved out via the application fee — same as reservations.
- **Using site-wide VAT for orders.** Orders use per-item VAT from the snapshot fields in `OrderItem`.
- **Assuming `siteId` is always set.** Dine-in tab orders may be restaurant-only; `processConfirmedOrder` and `/api/payment/create` reject site-less orders.
- **Treating order status as a single linear chain.** It branches (`rejected`, `discarded`, `canceled`, `refunded`).
- **Treating `complete` as "done".** `complete` = paid; the partner-side fulfilment chain runs after it, and `completed` is the terminal state.
