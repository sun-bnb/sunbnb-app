---
type: entity
slug: reservation
status: stable
sources:
  - packages/data/prisma/schema.prisma#model-Reservation
  - packages/data/src/reservation-status.ts
  - packages/data/src/payment.ts#processConfirmedReservation
  - packages/data/src/reservations.ts#reserveWithConflictGuard
  - apps/user/app/sites/[id]/actions.ts#saveReservationForMultipleItems
  - apps/partner/app/sites/[id]/manage/actions.ts
related:
  - entity:invoice
  - entity:order
  - entity:service-fee
  - flow:reservation-payment
  - flow:walk-in
  - subsystem:reservation-state-machine
  - subsystem:payments
last_verified: 2026-10-13
---

# Reservation

A booking of one or more inventory items (sunbeds) at a Site for a date/time range. The central transactional entity in the consumer flow.

## Schema essentials

`Reservation` (`packages/data/prisma/schema.prisma`):

- Identity: `id`, `userId` (FK → User), `anonId?` (anonymous flow), `siteId` (FK → Site), `employeeId?` (staff who created it).
- Items: M:N `InventoryItem` via implicit join `InventoryItemToReservation`. `itemId?` is a legacy single-item link.
- Time: `from`, `to` (DateTime, anchored to the venue's timezone — see `[[subsystem:venue-timezone]]`), `type` (default `"hours"` — sunbed bookings use `"days"`).
- Days: `days[]` → `ReservationDay` (one row per civil date, `@@unique([reservationId, date])`) carrying per-day `operationalStatus` / `checkedInAt` / `departedAt` — **authoritative** for operational reads; the parent columns are parallel-written legacy.
- Money: `paymentAmount?`, `paymentRef?` (provider identified by prefix — `@repo/data/payment-refs`), `isComp`, `refundedAt?`, `tillEntries[]` (cash/card-present evidence, `[[subsystem:employee-till]]`).
- Invoices: `invoices[]` (N:1 via `Invoice.reservationId` — PARTNER + PLATFORM + credit notes).
- Split lineage: `splitFromId?` / `splitInto[]` — a subset of seats peeled into a new reservation (track 018).
- Partner-side fields: `guestName?`, `guestContact?`, `guestEmail?`, `internalNotes?`, `reminderSentAt?`.
- Index `@@index([siteId, from, to])` serves every overlap query.

## Status lifecycle

Status values are **String columns**, not Prisma enums. Constants live in `packages/data/src/reservation-status.ts` — always import from there. The meaning of a status *combination* (kind / pay / occupancy) and every legal transition is defined by the state machine — see `[[subsystem:reservation-state-machine]]`; don't re-derive it here.

- **`status` (payment):** `pending`, `processing`, `complete`, `paid-in-cash` (hyphen — walk-ins, comps and blocks), `held` (floor hold, no payment/invoice), `payment_failed`, `canceled`, `refunded`.
- **`operationalStatus`:** `expected`, `checked-in`, `walked-in`, `departed`, `no-show`, `comp` (`OP_COMP`, paired with `isComp`), plus the raw `'blocked'` written by `blockBed`.
- **Groupings:** `BLOCKING_STATUSES` (`pending`, `processing`, `complete`, `paid-in-cash`, `held`), `PAID_STATUSES` (`complete` only), `TERMINAL_STATUSES` (`payment_failed`, `canceled`, `refunded`), `RESERVATION_STATUSES` (full set).

## Invariants

1. **Status fields use module constants.** Raw strings like `'expected'` or `'paid-in-cash'` outside `reservation-status.ts` are a smell.
2. **Availability check + create are one operation.** All creation paths go through `reserveWithConflictGuard` (`packages/data/src/reservations.ts`) — `SELECT … FOR UPDATE` on the items, then `findConflictingReservation`, then create, in one transaction.
3. **`paymentAmount` is set from DB pricing, not from the client.** See `[[entity:service-fee]]`.
4. **Invoicing is idempotent.** `processConfirmedReservation` returns if the reservation is already `complete` or has any invoice; a paid reservation has one PARTNER + (usually) one PLATFORM invoice (`[[entity:invoice]]`). `held` and comps are never invoiced.
5. **Anonymous reservations carry `anonId`.** `userId` is still set (FK); ownership (`verifyOwnership`) matches either.
6. **Partner-side transitions go through the state machine.** Manage actions (`checkInReservation`, `markDeparted`, `markNoShow`, `unreserveItem`, …) execute table rows via `applyTransition` (`@repo/data/reservation-machine-apply`); don't write raw status updates.

## Creation paths

| Path | Where | Notes |
|---|---|---|
| Online booking | `apps/user/app/sites/[id]/actions.ts#saveReservationForMultipleItems` | Auth or anonId; multi-item; price from DB |
| POS / QR (anonymous) | `apps/user/app/q/[site]/[unit]` (canonical; legacy `sites/[id]/pos/...` redirects) → same action | URL keyed by **site code + unit address** (`/q/S-K7M2X9/1-1-1`), never ids, so the card survives a parcel rebuilt in place (track 022) |
| Walk-in (partner) | `apps/partner/app/sites/[id]/manage/actions.ts#reserveItem` / `reserveItems` | Token-gated via `accessKey`; `status: paid-in-cash`, `operationalStatus: walked-in` |
| Hold / comp / block (partner) | same file — `holdBed(s)`, `compBed(s)`, `blockBed(s)` | `held` / `paid-in-cash`+`comp` / `paid-in-cash`+`blocked` |
| Calendar (partner) | `apps/partner/app/calendar/actions.ts#createPartnerReservation` | Authenticated partner action |

## Related entities

- `[[entity:order]]` — F&B orders are scoped to a Reservation (`Order.reservationId`).
- `[[entity:invoice]]` — generated post-payment.
- `[[entity:service-fee]]` — affects the partner-side invoice line amounts.

## Related flows

- `[[flow:reservation-payment]]` — the full booking → payment → confirmation journey (Mollie, Stripe Connect, Viva, demo).
- `[[flow:walk-in]]` — partner manage page lifecycle (check-in, departure, no-show, hold, comp, bed-block).

## Common pitfalls

- **Hardcoding a status string.** Always import from `@repo/data/reservation-status`. This has bitten before.
- **Treating `operationalStatus` and `status` as the same thing.** They are independent (`complete` + `no-show` is legal). And read occupancy from today's `ReservationDay`, not the parent column.
- **Reading `paid-in-cash` as "a cash sale".** It is shared by walk-ins, comps and blocks; use `deriveState` to get the kind.
- **Forgetting `anonId` in ownership checks.** A reservation created via POS will never match by `userId`.
- **Bypassing `reserveWithConflictGuard`.** Two clients booking the same sunbed for the same window — the check must hold the row lock through the create.
- **Mock divergence.** Tests use mocked `@repo/data/PrismaCient` — if you add a field to the Prisma model and need it in tests, update `apps/<app>/__mocks__/@repo/data/PrismaCient.ts`.
