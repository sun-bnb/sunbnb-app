---
type: entity
slug: reservation
status: stable
sources:
  - packages/data/prisma/schema.prisma#model-Reservation
  - packages/data/src/reservation-status.ts
  - packages/data/src/payment.ts#processConfirmedReservation
  - apps/user/app/sites/[id]/actions.ts#saveReservationForMultipleItems
  - apps/partner/app/sites/[id]/manage/actions.ts
related:
  - entity:invoice
  - entity:order
  - entity:service-fee
  - entity:settlement
  - flow:reservation-payment
  - flow:walk-in
  - subsystem:auth
  - subsystem:payments
last_verified: 2026-05-20
---

# Reservation

A booking of one or more inventory items (sunbeds) at a Site for a date/time range. The central transactional entity in the consumer flow.

## Schema essentials

`Reservation` (`packages/data/prisma/schema.prisma`):

- Identity: `id`, `userId` (FK → User), `anonId?` (anonymous flow), `siteId` (FK → Site).
- Items: M:N relation `InventoryItem` via implicit join `InventoryItemToReservation`. `itemId?` is a legacy single-item link; multi-item bookings use the M:N table.
- Time: `from`, `to` (DateTime), `type` (default `"hours"` — sunbed bookings use `"days"`).
- Money: `paymentAmount?` (Float), `paymentRef?` (Mollie payment id or `pi_demo_*`; legacy rows may carry a Stripe `pi_*` id from before consumer Stripe was removed).
- Invoice link: `invoiceId?` (unique, 1:1 → Invoice).
- Status: `status` (payment), `operationalStatus` (on-site state).
- Walk-in / partner-side fields: `guestName?`, `guestContact?`, `internalNotes?`, `checkedInAt?`, `departedAt?`.

## Status lifecycle

Status values are **String columns**, not Prisma enums. The canonical constants live in `packages/data/src/reservation-status.ts` — always import from there, never hardcode.

### Payment status (`status`)

```
pending → processing → complete
                    ↘ payment_failed
                    ↘ canceled
                    ↘ refunded
(also: paid_in_cash — partner-side path bypassing online payment)
```

### Operational status (`operationalStatus`)

```
expected → checked-in → departed
        ↘ no-show
(also: walked-in — created on-site, never had an "expected" phase)
(also: blocked — bed-block, not a real booking)
```

### Semantic groupings (also in `reservation-status.ts`)

- `BLOCKING_STATUSES` — payment statuses that should be considered as "booked" for availability checks (`pending`, `processing`, `complete`, `paid_in_cash`).
- `PAID_STATUSES` — payment statuses that count as money received (`complete`, `paid_in_cash`).
- `TERMINAL_STATUSES` — statuses that should not be transitioned out of (`canceled`, `refunded`, `payment_failed`).
- `RESERVATION_STATUSES` — full set, for type narrowing.

## Invariants

1. **Status fields use module constants.** A grep for raw strings like `'expected'`, `'checked-in'`, `'paid_in_cash'` outside `reservation-status.ts` is a smell.
2. **Availability is checked server-side.** Client-supplied selection is never trusted. See `apps/user/app/sites/[id]/actions.ts#saveReservationForMultipleItems` and `apps/user/service/availabilityService.ts`.
3. **`paymentAmount` is set from DB pricing, not from the client.** See `[[entity:service-fee]]` for how pricing resolves.
4. **A confirmed reservation has exactly one Invoice** (1:1 via `invoiceId`). The invoice itself implies a *second* invoice on the platform side (`[[entity:invoice]]`).
5. **Anonymous reservations carry `anonId` instead of `userId`.** Ownership check (`verifyOwnership`) compares either.
6. **Status transitions are app-enforced, not DB-enforced.** Use the helpers in `manage/actions.ts` (`checkInReservation`, `markDeparted`, `markNoShow`, `unreserveItem`); don't write raw status updates.

## Creation paths

| Path | Where | Notes |
|---|---|---|
| Online booking | `apps/user/app/sites/[id]/actions.ts#saveReservationForMultipleItems` | Auth or anonId required; multi-item; price from DB |
| POS / QR (anonymous) | `apps/user/app/q/[site]/[unit]` (canonical) — the legacy `sites/[id]/pos/...` redirects here → same action | Uses `anonId` from localStorage. The printed card's URL is keyed by **site code + unit address** (`/q/S-K7M2X9/1-1-1`), never by ids: it names the SPOT, so the card survives a parcel rebuilt in place (track 022) |
| Walk-in (partner) | `apps/partner/app/sites/[id]/manage/actions.ts#reserveItem` | Token-gated via `accessKey`; sets `operationalStatus: walked-in` |
| Calendar (partner) | `apps/partner/app/calendar/actions.ts#createPartnerReservation` | Authenticated partner action |

## Related entities

- `[[entity:order]]` — F&B orders are scoped to a Reservation (`Order.reservationId`).
- `[[entity:invoice]]` — generated post-payment.
- `[[entity:service-fee]]` — affects the partner-side invoice line amounts.
- `[[entity:settlement]]` — aggregates partner-side invoice amounts monthly.

## Related flows

- `[[flow:reservation-payment]]` — the full booking → payment → confirmation journey (Mollie, Demo).
- `[[flow:walk-in]]` — partner manage page lifecycle (check-in, departure, no-show, bed-block).

## Common pitfalls

- **Hardcoding a status string.** Always import from `@repo/data/reservation-status`. This has bitten before.
- **Treating `operationalStatus` and `status` as the same thing.** They are independent. A reservation can be `status: complete, operationalStatus: no-show`.
- **Forgetting `anonId` in ownership checks.** A reservation created via POS will never match by `userId`.
- **Bypassing availability check at creation.** Race window: two clients booking the same sunbed for the same window. The availability check must wrap the create in the same operation.
- **Mock divergence.** Tests use mocked `@repo/data/PrismaCient` — if you add a field to the Prisma model and need it in tests, update `apps/<app>/__mocks__/@repo/data/PrismaCient.ts`.
- **Path typo `@repo/data/PrismaCient`** (missing 'l') is intentional. Do not "fix" it.
