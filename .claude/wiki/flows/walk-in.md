---
type: flow
slug: walk-in
status: stable
sources:
  - apps/partner/app/sites/[id]/manage/actions.ts
  - apps/partner/CLAUDE.md
  - packages/data/src/reservation-status.ts
related:
  - entity:reservation
  - subsystem:auth
  - flow:reservation-payment
last_verified: 2026-05-20
---

# Flow: Walk-In / On-Site Management

The partner manage page (`apps/partner/app/sites/[id]/manage`) operates the on-site sunbed grid: walk-in reservations, check-ins, departures, no-shows, bed-blocking. **Token-gated, not session-authenticated** — so on-site staff can use it without an account.

## Trigger

Staff opens `/sites/[id]/manage?accessKey=<token>` (or `/sites/[id]/manage` with stored token cookie). All server actions on this page accept an optional `accessKey` parameter.

## Pre-conditions

- A `SecurityToken` row exists with: `userId === site.userId`, `expires` in the future, `resources` includes `'all'` or `'manage_site'`.
- The token is presented on every action call.

The token check is **not** session auth — it allows un-logged-in staff/devices to manipulate state on a specific site. Sessions still work in parallel for the site owner.

## Available actions

All in `apps/partner/app/sites/[id]/manage/actions.ts`. Each validates the token (or the session owner) before mutating.

| Action | What it does | Resulting status |
|---|---|---|
| `reserveItem(siteId, itemId, from, to, guestName?, …)` | Create a walk-in reservation for one item | `status: paid_in_cash`, `operationalStatus: walked-in` |
| `unreserveItem(reservationId)` | Cancel a not-yet-paid reservation | terminal cancel |
| `checkInReservation(reservationId)` | Mark guest as arrived | `operationalStatus: checked-in`, `checkedInAt` set |
| `markDeparted(reservationId)` | Mark guest as departed | `operationalStatus: departed`, `departedAt` set |
| `markNoShow(reservationId)` | Mark no-show after deadline | `operationalStatus: no-show` |
| `updateReservationNotes(reservationId, notes)` | Edit `internalNotes` | (notes only, no status change) |
| `moveReservation(reservationId, newItemId)` | Reassign a reservation to a different bed | (link change) |
| `blockBed(siteId, itemId, from, to)` | Mark a bed unavailable (maintenance, broken, reserved-for-staff) | A `Reservation` row with `operationalStatus: blocked`. Counts as `BLOCKING_STATUSES` |
| `unblockBed(reservationId)` | Remove a bed-block | terminal cancel |
| `markRentalPickedUp(rentalBookingId)` | Rental equipment handed over | `operationalStatus: picked-up`, `pickedUpAt` set |
| `markRentalReturned(rentalBookingId)` | Rental equipment returned | `operationalStatus: returned`, `returnedAt` set |
| `createWalkInRental(siteId, rentalItemId, duration, quantity, guestName?)` | On-site rental booking | See `[[flow:rental-booking]]` |

## Operational state machines

Sunbed reservation operational status:

```
expected → checked-in → departed
        ↘ no-show

walked-in → checked-in → departed
         ↘ no-show

blocked (terminal-by-purpose)
```

Rental booking operational status:

```
reserved → picked-up → returned
```

Constants live in `packages/data/src/reservation-status.ts` under `OP_*`.

## Important rules

1. **`paid_in_cash` is a real payment status.** A walk-in reservation has `status: paid_in_cash` (not `pending`/`processing`). It still counts as a `BLOCKING_STATUS` for availability.
2. **`blocked` is a real operational status** on a `Reservation` row. It's stored as a reservation (so the grid shows it) but is not a customer-facing booking. Don't email about blocked beds.
3. **No-show transitions are deadline-driven.** `Site.noShowDeadlineMinutes` (when set) defines when an `expected` reservation becomes eligible for no-show marking. Currently a manual action, not auto-applied.
4. **Move reservation is a link change**, not a copy. Same `id`, new `itemId` / join row. Beware of double-booking checks — the move should re-check availability for the target.
5. **The manage page is the only public-route mutation surface in the partner app.** Every other partner action goes through Google OAuth.

## Side effects

- DB writes: `Reservation` (status/operational changes), `RentalBooking` (status changes), occasional inserts for walk-in / bed-block.
- No email by default on operational transitions — partner-side state only.

## Failure modes

| Failure | Detection | Recovery |
|---|---|---|
| Invalid / expired `accessKey` | Action returns auth error | Staff must get a fresh token from `/security` |
| Token scope mismatch | Action returns auth error | Token needs `resources` including `'all'` or `'manage_site'` |
| Conflicting walk-in (item already booked for window) | Availability check inside `reserveItem` | `{ status: 'error' }` |
| `markNoShow` before deadline | Action enforces it (where applicable) | Wait until eligible |

## Related

- `[[entity:reservation]]` — the entity being mutated
- `[[subsystem:auth]]` — token model (`SecurityToken`)
- `[[flow:reservation-payment]]` — sibling flow (online path)
- `[[flow:rental-booking]]` — rental-specific actions live here too

## Common pitfalls

- **Treating manage actions like authenticated actions.** They run without an authenticated user. Don't rely on `session.user.id` anywhere in the manage path.
- **Bypassing the token check.** Every action validates. Don't add a new action that skips the check.
- **Forgetting that `blocked` beds count as unavailable.** Availability service excludes them as expected; if you bypass the service, you'll double-book.
- **Mixing sunbed and rental status constants.** Different operational chains.
