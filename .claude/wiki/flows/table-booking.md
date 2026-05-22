---
type: flow
slug: table-booking
status: stable
sources:
  - apps/user/app/api/restaurants/[id]/availability/route.ts
  - packages/table-reservations-core/src/availability.ts#getRestaurantAvailability
  - apps/user/app/sites/[id]/table/actions.ts#bookTableForSite
  - packages/table-reservations-core/src/reservations/actions.ts#createTableReservation
  - packages/table-reservations-core/src/emails.ts#confirmationEmailHtml
  - apps/user/app/sites/[id]/table/actions.ts#cancelTableBooking
  - apps/partner/app/restaurants/[id]/reservations/actions.ts
related:
  - entity:table-reservation
  - entity:restaurant
  - subsystem:table-reservations
  - subsystem:auth
last_verified: 2026-05-22
---

# Flow: Table Booking

Consumer books a table at a Sunbnb-linked restaurant: availability → slot + party → guest form →
confirm → email, plus modify/cancel, waitlist, and the partner-side service lifecycle. **Usually no
payment step** — bookings are free unless the shift requires a no-show deposit, in which case the
amount is *recorded* (`depositStatus: pending`) but collection is not yet wired (see
`[[subsystem:table-reservations]]` Roadmap).

## Trigger

A consumer on a Sunbnb site detail page (`/sites/[id]`) whose `Site` has a linked restaurant opens
the table-booking surface (`/sites/[id]/table`).

## Pre-conditions

- The `restaurants` feature flag is on (else the route 404s / actions return `feature_disabled`).
- `Site.restaurantId` is set; the restaurant has `RestaurantShift`s **or** `RestaurantHours` for the
  day and at least one `active` + `onlineBookable` table.
- Requested date is within `Restaurant.reservationWindow` days ahead.
- Customer is signed in **or** carries an `anonId` (`sunbnb-anonId` in localStorage).

## Sequence

1. **Availability** — GET `apps/user/app/api/restaurants/[id]/availability/route.ts?date&partySize`
   - Flag-gated; rate-limited 30/min/IP; `date` validated `YYYY-MM-DD`, `partySize` 1–50.
   - Calls `getRestaurantAvailability` (slot times resolved in `Restaurant.timeZone`; shift windows +
     pacing when shifts exist) → `{ slots:[{ from, to, availableTableIds, availableCombinationIds? }],
     mealDurationMinutes }`.
2. **Pick** — the client (`AvailabilityPicker` + `BookingForm`) selects a slot + a `tableId` (or a
   combination), and collects guest details.
3. **Book** — `apps/user/app/sites/[id]/table/actions.ts#bookTableForSite` (or `bookCombinationForSite`)
   - Flag gate; resolves `Site.restaurantId` → restaurant; identity = `session.user.id` or `anonId`.
   - Calls core `createTableReservation` / `createCombinationReservation`. (A public CORS route
     `app/api/restaurants/[id]/book` does the same for an external widget.)
4. **Create (core)** — `reservations/actions.ts#createTableReservation`
   - Validates input; loads the table; enforces restaurant/active/party fit; resolves any required
     deposit + the shift pacing for the slot.
   - **Inside `$transaction`:** counts overlapping `BLOCKING_*` reservations (`SLOT_TAKEN` on overlap)
     **and** re-checks pacing covers (`PACING_FULL` when the window is full); else inserts the
     `TableReservation` (`status: confirmed`, `operationalStatus: expected`, `depositStatus:
     pending|none`). Combination bookings insert N rows sharing `bookingGroupId`.
5. **Confirmation email** — `bookTableForSite` sends `confirmationEmailHtml` via
   `@repo/data/email#sendEmail`. **Fire-and-forget** — wrapped in try/catch; a failed send is logged
   and swallowed, the booking still succeeds.
6. **Redirect** — client routed to `/table-reservations/[id]` (confirmation + cancel control).

## Modify / cancel / waitlist

- **Modify:** `modifyTableBooking` → core `modifyTableReservation` re-checks availability + pacing
  in-txn (excluding the row's own contribution) and recomputes the deposit; staff use
  `modifyReservationAsStaff`.
- **Cancel (consumer):** `cancelTableBooking` → `cancelTableReservation` (idempotent) → cancellation
  email, then **auto-notifies the earliest matching waitlist guest** (`findWaitlistCandidateForFreedReservation`).
- **Cancel (staff):** `cancelRestaurantReservation` → `cancelReservationAsStaff`.
- **Waitlist:** when nothing's available, `joinWaitlistForSite` → `joinWaitlist` records a
  `TableWaitlistEntry`; it's notified when a table frees up.

## Partner service lifecycle

Day view: `getRestaurantReservationsForDay(restaurantId, isoDate)` → `listReservationsForDay`. Staff
transitions (all `revalidatePath`): `markSeated` (`seatedAt`), `markDeparted` (`departedAt`),
`markNoShow`, `modifyReservationAsStaff`, `chargeNoShowDeposit`, `setRestaurantReservationNotes`.
Combination bookings transition as a group. See `[[entity:table-reservation]]` for the status machine.

## Side effects

- DB: `TableReservation` insert + status updates (deposit recorded as `pending` when due — no money
  moved yet). Combination = N rows. Waitlist entries created / marked notified.
- Email: confirmation on book, cancellation on cancel, reminder (daily cron), waitlist-open notify —
  all via Resend, all non-blocking.
- External: none yet (deposit collection via Stripe/Mollie is the unbuilt seam).

## Failure modes

| Failure | Detection | Result |
|---|---|---|
| Slot taken between availability and create | In-transaction overlap count > 0 | `SLOT_TAKEN` → "Slot no longer available" |
| Pacing window full | In-transaction covers ≥ shift cap | `PACING_FULL` → "This time is fully booked" |
| `restaurants` flag off | `isFlagEnabled` / layout | `feature_disabled` / 404 |
| Site has no linked restaurant | `getSiteRestaurant` returns null | "Restaurant not found for this site" |
| Confirmation/cancellation email fails | try/catch around `sendEmail` | Logged + swallowed; booking/cancel still succeeds |
| Past time / bad party / missing identity | `createTableReservation` `validate()` | `{ status: 'error', errors }` |

## Related

- `[[entity:table-reservation]]` — the entity created here + its status machine.
- `[[entity:restaurant]]` — booking config (meal duration, window, hours).
- `[[subsystem:table-reservations]]` — engine + package boundaries + roadmap.
- `[[subsystem:auth]]` — the `userId|anonId` ownership model.

## Common pitfalls

- **Trusting client-supplied amounts** — deposit amounts come from the DB policy, never the client.
- **Skipping the in-transaction availability/pacing re-check** — reopens double-booking / over-pacing.
- **Forgetting `anonId`** when checking ownership on modify/cancel — anonymous bookings won't match `userId`.
- **Treating a failed email as a booking failure** — confirmation/reminder/waitlist sends are non-blocking.
- **Acting on one combo row** — cancel/seat must target the whole `bookingGroupId`.
