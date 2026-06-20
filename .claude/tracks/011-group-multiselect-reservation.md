# Track 011 — Group multiselect Reserve/Rent into one reservation

**Status:** Scoped, ready to build · **Surface:** `apps/partner` (manage page) · **Schema:** none

## Goal

On the partner manage page, multiselecting several free seats and then **Reserve**
(hold) or **Rent** (walk-in) currently creates **one reservation per seat** — N
separate bookings for what is almost always **one party on N loungers**. Fix it so a
multiselect Reserve/Rent creates a **single reservation spanning the whole selection**,
matching the consumer flow (`saveReservationForMultipleItems`) and the pair-expansion
behavior that already group multiple seats under one `Reservation`.

**Decisions locked (2026-06-20, with the user):**
- **Always group** — a multiselect Reserve/Rent always produces one reservation for the
  whole selection (multiselect = one party). No per-action group/separate toggle. To book
  unrelated seats separately, staff tap them one at a time (the single-tap path is
  unchanged).
- **All-or-nothing** — if any selected seat is already taken, the whole group fails and
  nothing is booked; the staffer fixes the selection and retries. This is what the
  transactional `SELECT … FOR UPDATE` guard does naturally, and matches "it's one booking."
  (Behavior change from today's per-seat partial success.)

## Why this is small

The grouped-create primitive **already exists and is proven**:
- `reserveWithConflictGuard({ itemIds, … })` (`packages/data/src/reservations.ts:140-215`)
  creates ONE `Reservation` with `items: { connect: itemIds.map(…) }` under a
  `SELECT … FOR UPDATE` lock on **all** the rows — atomic check-then-create over the whole
  set. Used today by the consumer multi-seat flow and by pair-expansion.
- Both partner create actions already pass an **array** to it: `reserveItem`
  (`actions.ts:181`) and `holdBed` (`actions.ts:789`) each build `allItemIds` (currently
  `[itemId]` + pair siblings) and hand it to the guard. Grouping = feed the *selection's*
  ids into that array instead of one id + pair.
- Downstream already handles multi-item reservations: the grid resolves the shared
  reservation per seat (`getActiveReservation`); bulk check-in/depart/no-show are already
  reservation-level (`bulkByReservation` dedups); cancel/move operate on the reservation.

So the work is concentrated in the **create path + its tests** — not a sweeping change. No
schema, no migration (the `Reservation`↔`items` relation is already many-to-many).

## Resume here

- **P1 DONE (`ad1bf09`, 2026-06-20).** `reserveItems(siteId, itemIds[], guestName?,
  internalNotes?, accessKey?, until?, employeeId?)` (grouped walk-in: paid-in-cash/walked-in,
  summed `paymentAmount` via `computeWalkInAmount` → one till line) + `holdBeds(siteId,
  itemIds[], accessKey?, guestName?, notes?, employeeId?)` (grouped hold, `paymentAmount` 0).
  Both reuse `reserveWithConflictGuard({ itemIds })` → all-or-nothing for free (integration-
  verified: one taken seat → nothing created). No pair expansion. Singular actions untouched.
  Registered in gated-actions (auth-matrix +10 → 495, coverage-contract + no-inline-money
  green). 16 unit + 13 integration. partner 1522 unit + 118 integration, tsc/lint clean.
- **Next action: P2 — wire the manage UI.** `bulkReserve` → `holdBeds(site.id!, selectedIds,
  apiKey, bulkGuestName, undefined, workerArg)` once; `bulkRent` → `reserveItems(site.id!,
  <free selectedIds>, bulkGuestName, undefined, apiKey, bulkUntil, workerArg)` once, and
  `convertHoldToWalkIn` individually for any pre-existing holds in the selection. Drop the
  per-seat `runBulkSeq` loop for these two verbs. Surface the all-or-nothing conflict via the
  existing `bulkError` banner. Keep selection on failure, clear on success. Prime `/ui partner`.
- **Context needed:**
  - Create primitive: `reserveWithConflictGuard` (`packages/data/src/reservations.ts`).
  - Today's singular actions: `reserveItem` (`actions.ts:122`), `holdBed` (`actions.ts:764`)
    — both already build `allItemIds` → guard. `computeWalkInAmount` is LOCAL to
    `manage/actions.ts`.
  - The bulk callers to rewire: `runBulkSeq` / `bulkReserve` / `bulkRent` (`view.tsx:572-605`);
    the shared `bulkGuestName` / `bulkUntil` / `bulkDays` state; the selection-composition
    gates `allAvailable` / `canRent` (`view.tsx:667-668`).
  - Test spine: `app/test/{gated-actions,auth-matrix,coverage-contract,no-inline-money}.ts`,
    `manage/actions.integration.test.ts`.
- **Blocked by:** nothing.

## Roadmap

- ✅ **P1 — Data/action layer: grouped create. DONE (`ad1bf09`, 2026-06-20).** `reserveItems`
  + `holdBeds` over `reserveWithConflictGuard` (one reservation, summed `paymentAmount` → one
  till line, all-or-nothing). Registered in gated-actions (auth-matrix 495, coverage-contract +
  no-inline-money green). 16 unit + 13 integration (incl. conflict-atomicity: one taken seat →
  nothing created; till one summed amount). Singular actions untouched. partner 1522 unit + 118
  integration, tsc/lint clean.
- ☐ **P2 — Wire the manage UI.** `bulkReserve` / `bulkRent` call the grouped action ONCE with
  all selected ids instead of `runBulkSeq` looping per seat. **Mixed free+held Rent rule:**
  group the *free* seats into one new walk-in; convert any *pre-existing holds* individually
  (keep their identity — don't merge holds into the new row). On an all-or-nothing conflict,
  surface a clear message (adapt the existing `bulkError` banner — e.g. "Couldn't book — one
  or more seats are taken"). Keep the selection on failure, clear on success.
- ☐ **P3 — Verify downstream + browser-verify.** Confirm a grouped reservation displays
  correctly across all its seats, and that check-in / depart / no-show / cancel / move all
  behave on the grouped reservation (they're reservation-level already, but verify with a
  real grouped booking). Integration coverage for the move/cancel of a grouped walk-in.
  Browser-verify the end-to-end multiselect → group → act flow. tsc/lint + partner suite green.

## Open decisions (defaults chosen; flag to revisit)

- **Comp / block grouping** — left **per-seat** (a comp isn't a "party"; block is
  out-of-service). Grouping applies to **Reserve + Rent only**. Revisit only if a grouped
  comp is actually wanted.
- **Pairing in a grouped create** — stays `applyToPair=false` (act on exactly the selected
  seats). A selected seat's unselected pair sibling is NOT pulled in. (Single-tap pair
  expansion is unchanged.)
- **Mixed free+held Rent** — group free seats into one new walk-in; convert pre-existing
  holds individually. Merging holds + free into a single row is deliberately out of scope
  (high complexity, low value).
- **All-or-nothing messaging** — exact copy for the conflict case (which/how many seats were
  taken) is a P2 detail; lean on the generic banner first, refine if noisy.

## Links

- [[track:006-alonso-staff-ui]] — the multiselect + bulk-action manage UI this refines
  (slices 1–4: selection mechanics, bulk create/free, paid lane, Move).
- [[track:008-employee-model]] — the till the summed `paymentAmount` feeds (one line per
  grouped walk-in instead of N).
- [[track:010-floor-reservation-lookup]] — sibling manage-page track; same token-gated
  create actions (`reserveItem` / `convertHoldToWalkIn`).
- Reference for grouped multi-seat create done right: the consumer
  `saveReservationForMultipleItems` (`apps/user/app/sites/[id]/actions.ts`).

## Log

- **2026-06-20** — Track scoped. User noticed multiselect Reserve/Rent produces a separate
  reservation per seat (confirmed: `runBulkSeq` loops per-seat with `applyToPair=false`,
  `view.tsx:572-605`; each `reserveItem`/`holdBed` creates a single-seat reservation). Root
  cause is purely the partner *create* path — the data layer (`reserveWithConflictGuard`)
  already creates one reservation over an `itemIds[]` array, and downstream already handles
  multi-item reservations. Decided: **always group** (multiselect = one party; no toggle) and
  **all-or-nothing** (transactional guard; one taken seat fails the whole group). Sub-cases
  defaulted: comp/block stay per-seat; pairing stays `applyToPair=false`; mixed free+held Rent
  groups the free seats + converts holds individually. No schema/migration.
