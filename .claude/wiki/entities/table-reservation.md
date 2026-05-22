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
related:
  - entity:restaurant
  - subsystem:table-reservations
  - flow:table-booking
  - entity:reservation
last_verified: 2026-05-22
---

# TableReservation

A booking of a `Table` at a `[[entity:restaurant]]` for a time window and party size. Created by a
consumer (signed-in or anonymous) or by staff. **Free unless a no-show deposit is required** — chunk
1e added the deposit model + state machine, but the actual Stripe/Mollie collection + invoice
cascade is the remaining app-layer seam, so deposit-required bookings currently sit at
`depositStatus: pending`. Contrast with the sunbed `[[entity:reservation]]` (fully paid).

## Schema essentials

`TableReservation` (`schema.prisma#model-TableReservation`):

- Identity: `id`, `restaurantId` (FK), `tableId?` (**nullable** — "may be assigned at check-in"),
  `userId?` / `anonId?` (one identifies the customer), `bookingGroupId?` (combination bookings —
  one row per member table, all sharing this id; cancel/seat/depart operate on the group).
- Booking: `from`, `to` (DateTime), `partySize`.
- Status (two independent dimensions — see below): `status`, `operationalStatus`.
- Guest: `guestName`, `guestEmail`, `guestPhone?`, `specialRequests?`; `internalNotes?` (staff-only).
- Timestamps: `seatedAt?`, `departedAt?`, `reminderSentAt?` (set by the daily reminder cron — chunk 1f).
- Deposit (chunk 1e): `depositAmount?`, `depositStatus?` (`none|pending|held|charged|refunded|
  released`), `paymentRef?` (set once a deposit is collected by the app).
- Indexes: `[restaurantId, from]`, `[tableId, from, to]`, `[bookingGroupId]` (overlap + group queries).

`Table` (`schema.prisma#model-Table`) — the reservable unit:

- `number` (unique per restaurant), `label?`, `capacity`, `minPartySize` (default 1),
  `maxPartySize?` (soft cap to steer big parties to bigger tables).
- Floor-plan: `shape` (`square|round|rect|oval|booth|bar`), `width`/`height` (metres),
  `schematicX/Y`, `rotation`, per-side `seats{Top,Right,Bottom,Left}?` (null = auto-distribute).
- Attributes (chunk 1b): `combinable` (eligible for a `TableCombination`), `features[]` (validated
  set: `accessible`/`window`/`outdoor`/`high_top`/`communal`/`quiet`; availability can require them).
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

Deposit lifecycle (`DEPOSIT_STATUS`, chunk 1e): `none` / `pending` (required, awaiting collection) →
`held` (collected) → `charged` (kept after no-show) | `refunded` (timely cancel) | `released`
(guest seated). State transitions live in `reservations/actions.ts`
(`markDepositHeld`/`chargeNoShowDeposit`/`refundDeposit`/`releaseDeposit`); the money movement is the
app-layer seam.

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
6. **Deposits are recorded, not yet collected.** A deposit-required booking persists `depositAmount`
   + `depositStatus: pending`; the provider charge/refund + invoice cascade is the remaining seam, so
   don't assume money has moved from the status alone.

## Creation & transition paths

| Path | Where | Notes |
|---|---|---|
| Consumer booking | `apps/user/.../sites/[id]/table/actions.ts#bookTableForSite` → core `createTableReservation` | Resolves `Site.restaurantId`; auth or `anonId`; `tableId` required |
| Consumer combo booking | `…/table/actions.ts#bookCombinationForSite` → `createCombinationReservation` | Large parties; N linked rows share `bookingGroupId` |
| Consumer modify / cancel | `…/table/actions.ts#modifyTableBooking` / `cancelTableBooking` → `modifyTableReservation` / `cancelTableReservation` | Ownership by `userId|anonId`; modify re-checks availability+pacing |
| Public widget / API | `apps/user/app/api/restaurants/[id]/book` (POST, CORS, rate-limited) → core create | Anonymous; restaurant-keyed; single-table or combination |
| Staff transitions | `apps/partner/app/restaurants/[id]/reservations/actions.ts` → `markSeated`/`markDeparted`/`markNoShow`/`cancelReservationAsStaff`/`modifyReservationAsStaff`/`chargeNoShowDeposit`/`updateReservationInternalNotes` | Auth via `requireRestaurantOwnerWithFlag` |

## Related

- `[[entity:restaurant]]` — the owning aggregate and its booking config.
- `[[flow:table-booking]]` — the end-to-end consumer journey + staff lifecycle.
- `[[subsystem:table-reservations]]` — availability engine + package boundaries.

## Common pitfalls

- **Hardcoding a status string** instead of importing the constant (now incl. `DEPOSIT_STATUS`).
- **Forgetting `anonId`** in ownership — POS/anonymous bookings never match by `userId`.
- **Assuming a deposit was collected** — `depositStatus: pending` means recorded, not charged.
- **Bypassing the in-transaction availability/pacing re-check** — reintroduces double-booking / over-pacing.
- **Confusing `status` and `operationalStatus`** — a `confirmed` reservation can be `no_show`.
- **Forgetting combo grouping** — cancel/seat/no-show must act on the whole `bookingGroupId`, not one row.
- **`tableId` is nullable in schema but required by `createTableReservation`** — the create path
  always assigns a concrete table (host-driven auto-assign is deferred to P2).
