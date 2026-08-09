---
type: flow
slug: walk-in
status: stable
sources:
  - apps/partner/app/sites/[id]/manage/actions.ts
  - apps/partner/app/api/reservations-cleanup/route.ts
  - packages/data/src/reservation-payment.ts
  - apps/user/app/api/webhooks/mollie/route.ts
  - packages/data/src/reservation-status.ts
  - apps/partner/CLAUDE.md
related:
  - entity:reservation
  - subsystem:auth
  - flow:reservation-payment
last_verified: 2026-06-18
---

# Flow: Walk-In / On-Site Management

The partner manage page (`apps/partner/app/sites/[id]/manage`) operates the on-site sunbed grid: walk-ins, holds, comps, bed-blocks, check-ins, departures, no-shows, plus rental pickup/return. **Token-gated, not session-authenticated** — so on-site staff can use it without an account.

## Trigger

Staff opens `/sites/[id]/manage?accessKey=<token>` (or `/sites/[id]/manage` with a stored token cookie). All server actions on this page accept an optional `accessKey` parameter.

## Pre-conditions

- A `SecurityToken` row exists with: `userId === site.userId`, `expires` in the future, `resources` includes `'all'` or `'manage_site'`.
- The token is presented on every action call.

The token check is **not** session auth — it allows un-logged-in staff/devices to manipulate state on a specific site. Sessions still work in parallel for the site owner.

## The core model: every occupancy is one `Reservation` row

Every way to occupy a bed on the floor — walk-in, hold, comp, block, or an inbound online booking — is **a single `Reservation` row** carrying three orthogonal axes:

| Axis | Field | Answers | Time-driven? |
|---|---|---|---|
| **Booking period** | `from` → `to` | which calendar days the bed is held | yes — drives grid visibility + GC eligibility |
| **Operational status** | `operationalStatus` (`OP_*`) | what's happening within the stay | no — event-driven (operator taps) |
| **Payment status** | `status` | how/whether money changed hands | mostly fixed at creation |

A bed renders occupied when a **non-terminal** reservation's `[from, to]` overlaps **today**. There is no "indefinite" occupancy — everything is a bounded window.

## Actions: occupancy *creators* vs *transitions*

All in `apps/partner/app/sites/[id]/manage/actions.ts`; each validates the token (or session owner) first. The key split: a handful of actions **create** a new today-scoped row; the rest **mutate or delete** an existing one.

### Creators — insert a new today-scoped `Reservation`

| Action | `status` / `operationalStatus` | Period | Notes |
|---|---|---|---|
| `reserveItem(siteId,itemId,guestName?,…,until?)` | `paid-in-cash` / `walked-in`, `checkedInAt`=now | today, **or `until` +1..90d** | The **only** multi-day floor action |
| `holdBed(…)` | `held` / `expected`, amount 0 | today only | "Pencil someone in", no payment |
| `compBed(…)` | `paid-in-cash` / `comp`, `isComp:true`, amount 0 | today only | Free occupancy; amount 0 ⇒ no invoice |
| `blockBed(…,notes?)` | `paid-in-cash` / `blocked` | today only | Maintenance / out-of-service |

All four auto-include the bed's SunbedGroup/pair siblings and run through `reserveWithConflictGuard` (`@repo/data/reservations`) — availability-check + insert in one `$transaction` with `SELECT … FOR UPDATE`, so a sibling already booked is rejected, not double-booked.

### Transitions — mutate the existing row (no new row)

| Action | Effect | Guard |
|---|---|---|
| `checkInReservation` | `expected` → `checked-in` (+`checkedInAt`) | from `expected` only |
| `markDeparted` | → `departed` (+`departedAt`) | from `checked-in`/`walked-in` |
| `markNoShow` | → `no-show` | from `expected` only |
| `convertHoldToWalkIn(…,until?)` | held row → `paid-in-cash`/`walked-in` **in place**; optional `until` extend (race-safe) | finds the `held` row |
| `moveReservation` / `moveReservationToSeats` | re-point items to new beds — **same `id`**, clock/payment/invoice preserved | not `departed`/`no-show` |
| `updateReservationNotes` | edit `internalNotes` | — |
| `refundReservation` | stamp `refundedAt`, **bed stays occupied**; idempotent | online `complete` only |
| `cancelReservation` | `complete` → `canceled` (or `refunded` if `refundedAt`), **keeps row for audit**, frees bed | idempotent on terminal |
| `collectReservationPayment` / `getCollectStatus` / `cancelCollection` | take an online QR payment for a walk-in → `complete` (see § Collecting a walk-in payment) | walk-in / `paid-in-cash` |

### Deleters — remove the row, free the bed

`unreserveItem` (walk-in), `releaseHold` (hold), `uncompBed` (comp), `unblockBed` (block) delete the floor row (no invoice trail). `removeFailedReservation` deletes a `payment_failed` row only (guarded so it can never touch a paid/held/active booking). Pair-mode deletes the whole reservation; single-seat mode disconnects just one item when >1 remain.

## Collecting a walk-in payment (QR → Mollie)

A cash walk-in can be upgraded to a real online sale on the floor. `BedDetail.tsx` shows a **Collect payment** button on a `walked-in` bed (paid sites only); `collectReservationPayment`:

1. Computes the amount from **DB chair prices** (`item.price ?? site.price` × days — never client-supplied), persists it.
2. Mints an **`anonId` capability** on the partner-created walk-in (it has none) so the beachgoer's browser can later claim *this one* reservation — same bearer model as an anonymous POS booking.
3. Creates a Mollie payment on the partner's account (platform fee via `applicationFee`) through the shared `createReservationMolliePayment` in `packages/data/src/reservation-payment.ts` — the **same** primitive the consumer online flow uses (extracted like `[[entity:invoice]]`'s refund). Metadata carries `collect:true`.

`status` goes `paid-in-cash → processing` while `operationalStatus` **stays `walked-in`** (the bed never frees). The operator screen polls `getCollectStatus`; the QR encodes the Mollie checkout URL. On **paid** (webhook `[[flow:reservation-payment]]`, or the poll's `reverifyAndFinalizeReservation` fallback → `processConfirmedReservation`): `status → complete`, invoices created, BedDetail swaps the button for a paid badge. The beachgoer is redirected to the standard `/payment/complete?reservationId=&anonId=` → `/reservations/[id]` (PDF receipt + a self-serve "email me a receipt" via `sendReceiptEmail`).

**A failed/expired/abandoned collection reverts to `paid-in-cash`** (never `payment_failed`) so the occupied bed survives — handled on three paths: `cancelCollection` (operator closes the QR), `getCollectStatus` (poll sees failure), and the Mollie webhook (the `collect` metadata branch). Demo mode (`NEXT_PUBLIC_DEMO_MODE`) skips the provider: a `pi_demo_` ref settles as paid on the next poll.

## Operational state machines

```
online booking:  expected → checked-in → departed
                         ↘ no-show
walk-in:         walked-in → departed
                          ↘ no-show            (already present — no check-in step)
                 walked-in → (collect QR) processing → complete (paid online)
                                        ↘ failed → back to paid-in-cash
hold:            expected → convertHoldToWalkIn → walked-in → …
                         ↘ no-show / releaseHold
block, comp:     single-state; cleared by unblock / uncomp
```

Transitions are **event-driven, never timed**. `Site.noShowDeadlineMinutes` only gates *eligibility* in the UI; nothing auto-fires a transition. Constants: `packages/data/src/reservation-status.ts#OP_`.

## Lifespan: two independent clocks

How long a state "remains" has two separate answers — freeing the bed and deleting the row are decoupled:

1. **Freeing the bed is an operational flip.** `markDeparted`/`markNoShow` set `operationalStatus` to `departed`/`no-show`. The conflict/availability guard filters `operationalStatus notIn [departed, no-show]`, so the bed frees **immediately** — even though the row still exists as `paid-in-cash`.
2. **Deleting the row is the cleanup cron's job.** `app/api/reservations-cleanup/route.ts` (Vercel cron, every 15 min) `deleteMany` by age:
   - `pending`/`processing` → `createdAt` older than **15 min** (abandoned online checkouts), **excluding** `walked-in`/`checked-in` occupants — a QR collection flips an already-seated walk-in (old `createdAt`) to `processing`, which would otherwise be swept on the next run
   - `payment_failed` → `createdAt` older than **24 h**
   - `paid-in-cash` **and** `held` → `createdAt < start-of-today` **AND** `to < now`

So an uncleared block/comp/hold/walk-in (all `to` = end of today) is swept by the **first cron run after midnight** — that's the "until further notice" illusion. A walk-in extended with `until` survives until *that* `to` passes. Online `complete` rows are **never** GC'd — after `to` passes they simply stop overlapping today and drop off the grid, but the row is kept for invoicing/audit.

## Period selection (`until`)

The only period control in `/manage` (the calendar toggle in `BedDetail.tsx`), fed to exactly two actions: `reserveItem` and `convertHoldToWalkIn`. **Forward-only**: the stay always starts today (no back-dating), `until` only pushes `to` later, validated not-past and ≤ 90 days. It changes the validity window — not the type (still `paid-in-cash`/`walked-in`). Arbitrary future-dated or historical ranges are **not** creatable here — those go through the calendar's `createPartnerReservation` (`apps/partner/app/calendar/actions.ts`).

## Pool seats

`status:'pool'` overflow loungers (sentinel coords `(0,0)`, number `parcel*10000 + 9900 + seq`). Invisible to consumers (consumer side filters `status:'active'`) and excluded from the headline occupancy summary. `createPoolSeat`/`deletePoolSeat` manage free ones; `addSeatToGroup`/`removeGroupSeat` manage group-extras (a pool seat linked to a `SunbedGroup`). Deletion is rejected while the seat has an active (non-departed/no-show) reservation today.

## Side effects

- DB writes: `Reservation` (inserts for creators; status/operational updates for transitions), `RentalBooking`, `InventoryItem` (pool seats). `refundReservation` calls Mollie via `issueReservationRefund`.
- No email on operational transitions — partner-side state only.

## Failure modes

| Failure | Detection | Recovery |
|---|---|---|
| Invalid / expired `accessKey` | Action returns auth error | Fresh token from `/security` |
| Token scope mismatch | Auth error | Token needs `'all'` or `'manage_site'` |
| Conflicting create (item or sibling already booked in range) | `reserveWithConflictGuard` `outcome:'conflict'` | `{ status:'error', errors:[…] }` |
| Refund fails (Mollie permission/403) | `refundReservation` returns `needsReconnect:true` | UI offers Mollie re-consent; cancel can still proceed. Staff usually **cannot** complete it: the "Enable refunds" link targets `/api/mollie/authorize`, which needs an owner session and 401s on a token-gated `?key=` manage session. The owner is warned separately at partner-app sign-in (`[[subsystem:payments]]` § granted scopes), so the fix normally comes from them, not from whoever hit the failure |
| Extend-via-`until` races a concurrent booking | `convertHoldToWalkIn` re-checks in a `FOR UPDATE` tx | `outcome:'conflict'` |

## Related

- `[[entity:reservation]]` — the entity being mutated
- `[[subsystem:auth]]` — token model (`SecurityToken`)
- `[[flow:reservation-payment]]` — sibling online path
- `[[flow:rental-booking]]` — rental pickup/return + `createWalkInRental`

## Common pitfalls

- **Assuming a state is "indefinite."** Block/comp/hold/walk-in are all today-only rows; they persist only because nobody cleared them and the cron sweeps after `to`.
- **Conflating "bed freed" with "row deleted."** `departed`/`no-show` free the bed instantly; the row lingers until the cron GC.
- **Treating manage actions like authenticated actions.** They run without an authenticated user — never rely on `session.user.id` in the manage path.
- **Forgetting `blocked`/`comp`/`held` count as occupied.** They block via `BLOCKING_STATUSES`; bypassing the availability service double-books.
- **Mixing sunbed and rental status constants.** Different operational chains (`OP_RESERVED/PICKED_UP/RETURNED`).
- **Expecting `/manage` to make future-dated bookings.** It can't — only forward-extend a walk-in via `until`; ranged/future bookings are the calendar's job.
- **Letting a collection strand the walk-in.** Collecting flips an old-`createdAt` walk-in to `processing`: a failed/abandoned one must revert to `paid-in-cash` (all three paths: `cancelCollection`, poll, webhook `collect` branch), and the cleanup cron must skip occupied (`walked-in`/`checked-in`) `processing` rows — else the seated guest's bed is deleted mid-payment.
