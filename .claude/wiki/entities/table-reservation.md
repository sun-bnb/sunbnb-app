---
type: entity
slug: table-reservation
status: stable
sources:
  - packages/data/prisma/schema.prisma#model-TableReservation
  - packages/data/prisma/schema.prisma#model-Table
  - packages/table-reservations-core/src/status.ts
  - packages/table-reservations-core/src/reservations/actions.ts#createTableReservation
  - packages/table-reservations-core/src/reservations/queries.ts
  - packages/table-reservations-core/src/availability.ts#getRestaurantAvailability
  - apps/user/app/sites/[id]/table/actions.ts#bookTableForSite
related:
  - entity:restaurant
  - subsystem:table-reservations
  - flow:table-booking
  - entity:reservation
last_verified: 2026-10-13
---

# TableReservation

A booking of a `Table` at a `[[entity:restaurant]]` for a time window and party size. Created by a
consumer (signed-in or anonymous) or by staff. **Free unless a no-show deposit is required** — then
the booking is created with `depositStatus: pending` and only becomes real once the deposit payment
confirms (`held`). A kept (no-show) deposit is invoiced via `processChargedTableDeposit`. Contrast
with the sunbed `[[entity:reservation]]` (fully paid).

## Schema essentials

`TableReservation` (`schema.prisma#model-TableReservation`):

- Identity: `id`, `restaurantId` (FK), `tableId?` (**nullable** — "may be assigned at check-in"),
  `userId?` / `anonId?` (one identifies the customer), `bookingGroupId?` (combination bookings —
  one row per member table, all sharing this id; cancel/seat/depart operate on the group).
- Booking: `from`, `to` (DateTime), `partySize`.
- Status (two independent dimensions — see below): `status`, `operationalStatus`.
- Guest: `guestName`, `guestEmail`, `guestPhone?`, `specialRequests?`; `internalNotes?` (staff-only).
- Timestamps: `seatedAt?`, `departedAt?`, `reminderSentAt?` (set by the daily reminder cron — chunk 1f).
- Deposit: `depositAmount?`, `depositStatus?` (`none|pending|held|charged|refunded|
  released`), `paymentRef?` (the deposit payment; provider by prefix, `@repo/data/payment-refs`).
- Invoices: `invoices[]` (via `Invoice.tableReservationId`) — PARTNER + PLATFORM, written only when a
  deposit is kept.
- Indexes: `[restaurantId, from]`, `[tableId, from, to]`, `[bookingGroupId]` (overlap + group queries).

`Table` (`schema.prisma#model-Table`) — the reservable unit:

- `number` (unique per restaurant), `label?`, `capacity`, `minPartySize` (default 1),
  `maxPartySize?` (soft cap to steer big parties to bigger tables).
- Floor-plan: `shape` (`square|round|rect|oval|booth|bar`), `width`/`height` (metres),
  `schematicX/Y`, `rotation`, per-side `seats{Top,Right,Bottom,Left}?` (null = auto-distribute).
- Attributes: `combinable` (eligible for a `TableCombination`), `guestSelectable`, `features[]`
  (validated set: `accessible`/`window`/`outdoor`/`high_top`/`communal`/`quiet`; availability can
  require them), `requiresDeposit` / `depositPerGuest` (per-table deposit inputs).
- Operational: `status` (`active|inactive`), `zone?` (the **section** name; availability can filter
  by it), `staffNote?`, `onlineBookable` (false = walk-in/staff only, hidden from consumer
  availability), `turnTimeMinutes?` (per-table meal-duration override — **still ignored by the
  engine**; folding deferred to a later chunk), `locked` (editor drag-guard).

## Status lifecycle

Two **independent** plain-string dimensions; constants in
`table-reservations-core/src/status.ts` — never hardcode.

- **`status`** (lifecycle): `confirmed → canceled`.
- **`operationalStatus`** (service): `expected → seated → departed` (or `no_show`).

Blocking groups (what occupies a table slot):

- `BLOCKING_TABLE_RESERVATION_STATUSES = [confirmed]`
- `BLOCKING_TABLE_RESERVATION_OP_STATUSES = [expected, seated]`
- A `canceled`, `no_show`, or `departed` reservation **frees** the slot.
- `TERMINAL_TABLE_RESERVATION_OP_STATUSES = [departed, no_show]`.

Deposit lifecycle (`DEPOSIT_STATUS`): `none` / `pending` (required, awaiting payment) → `held`
(collected) → `charged` (kept after no-show) | `refunded` (timely cancel, or on arrival) |
`released` (guest seated, no money movement). State transitions live in core
`reservations/actions.ts` (`markDepositHeld`/`chargeNoShowDeposit`/`refundDeposit`/`releaseDeposit`);
money movement is in the apps:

- **Collect** — Mollie `apps/user/app/api/table-reservations/[id]/deposit/mollie/route.ts`; Stripe /
  Viva via `/api/payment/create` (`kind: 'table-deposit'`); demo `initiateDemoTableDeposit`. The
  webhook (`apps/user/app/api/_lib/payment-events.ts`, `table-deposit`) calls `markDepositHeld` and
  sends the confirmation email only on the `pending → held` transition.
- **Refund** — partner `refundHeldDeposit` (on seat and on staff cancel) refunds the provider payment,
  then `refundDeposit`.
- **Keep** — `chargeRestaurantReservationDeposit` → `chargeNoShowDeposit` → `processChargedTableDeposit`
  (PARTNER `no-show-deposit` line + PLATFORM commission; see `[[entity:invoice]]`).

## Invariants

1. **Status constants only.** Import from `table-reservations-core/src/status.ts`; raw `'seated'` /
   `'no_show'` strings outside that module are a smell.
2. **Availability is re-checked inside the create transaction.** `createTableReservation` counts
   overlapping blocking reservations *inside* `$transaction`; on overlap it throws `SLOT_TAKEN` and
   rolls back. Preserve this race guard.
3. **Blocking = `status confirmed` AND `op in {expected, seated}`.** Both dimensions gate occupancy.
4. **Dual ownership.** Consumers own via `userId|anonId` (`reservationOwnedBy`); staff act via the
   restaurant's `partnerAccountId` (`requireStaffOwner`). Both are enforced for their respective
   actions.
5. **Pacing + availability re-checked on create AND modify.** `createTableReservation` /
   `modifyTableReservation` re-check overlap and shift pacing inside the txn (modify excludes the
   row's own contribution). See `[[subsystem:table-reservations]]`.
6. **Deposit money follows `depositStatus`, not the booking.** `pending` = nothing collected; only
   `held` has a refundable payment; only `charged` is invoiced. Each transition is a guarded
   source-status check, so webhook retries are no-ops.

## Creation & transition paths

| Path | Where | Notes |
|---|---|---|
| Consumer booking | `apps/user/app/sites/[id]/table/actions.ts#bookTableForSite` → core `createTableReservation` | Resolves `Site.restaurantId`; auth or `anonId`; `tableId` required; returns `requiresDeposit` when a deposit is due |
| Consumer combo booking | `apps/user/app/sites/[id]/table/actions.ts#bookCombinationForSite` → `createCombinationReservation` | Large parties; N linked rows share `bookingGroupId` |
| Consumer modify / cancel | `apps/user/app/sites/[id]/table/actions.ts#modifyTableBooking` / `#cancelTableBooking` → `modifyTableReservation` / `cancelTableReservation` | Ownership by `userId|anonId`; modify re-checks availability+pacing |
| Public widget / API | `apps/user/app/api/restaurants/[id]/book` (POST, CORS, rate-limited) → core create | Anonymous; restaurant-keyed; single-table or combination |
| Staff transitions | `apps/partner/app/restaurants/[id]/reservations/actions.ts` — `markRestaurantReservationSeated`/`…Departed`/`…NoShow`, `cancelRestaurantReservation`, `modifyRestaurantReservation`, `chargeRestaurantReservationDeposit`, `setRestaurantReservationNotes` → core `markSeated`/`markDeparted`/`markNoShow`/… | Auth via `requireRestaurantOwnerWithFlag(restaurantId, 'restaurants')` |

## Related

- `[[entity:restaurant]]` — the owning aggregate and its booking config.
- `[[flow:table-booking]]` — the end-to-end consumer journey + staff lifecycle.
- `[[subsystem:table-reservations]]` — availability engine + package boundaries.

## Common pitfalls

- **Hardcoding a status string** instead of importing the constant (now incl. `DEPOSIT_STATUS`).
- **Forgetting `anonId`** in ownership — POS/anonymous bookings never match by `userId`.
- **Assuming a deposit was collected** — `depositStatus: pending` means awaiting payment; only `held` has money to refund.
- **Bypassing the in-transaction availability/pacing re-check** — reintroduces double-booking / over-pacing.
- **Confusing `status` and `operationalStatus`** — a `confirmed` reservation can be `no_show`.
- **Forgetting combo grouping** — cancel/seat/no-show must act on the whole `bookingGroupId`, not one row.
- **`tableId` is nullable in schema but required by `createTableReservation`** — the create path
  always assigns a concrete table (host-driven auto-assign is deferred to P2).
