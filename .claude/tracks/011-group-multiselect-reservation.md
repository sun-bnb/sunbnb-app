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
- **P2 DONE (`e16ef74`, 2026-06-20).** `bulkReserve` → single `holdBeds(...)`; `bulkRent` splits
  free seats → one `reserveItems(...)` (all-or-nothing; on conflict surfaces
  `SiteManage.bulkGroupConflict`, keeps selection, skips holds) + per-reservation
  `convertHoldToWalkIn` for pre-existing holds (deduped). `bulkBlock`/`bulkComp` stay per-seat.
  Dropped unused `holdBed`/`reserveItem` imports; new conflict i18n key in en/es/fi. tsc/lint
  clean, partner 1522 unit green. (Registry `index.md` 011 row not updated here — it carries the
  parallel track-012 agent's uncommitted edit; update when 012 docs land.)
- **P3 automated half DONE (`135cbee`, 2026-06-20).** 10 integration tests (manage, 51→61):
  check-in marks the group; depart/no-show free all N seats; cancel via ONE seat's id cancels
  the whole booking + frees every seat; move (same-count + count-change) preserves identity.
  **False-bug caught & corrected:** the verification agent flagged releaseHold/unreserveItem
  `applyToPair=false` as "stranded siblings" — but that's CORRECT partial-free (vacate the tapped
  seat, leave the party booked; the freed seat is rebookable — now asserted). No production change;
  "fixing" it would have made a single Free delete the whole party.
- **Next action: P3 browser-verify (manual).** Run the partner app, open a token-gated manage
  page, multiselect free seats → Reserve and → Rent, confirm ONE reservation spans the seats
  (BedDetail shows the group; check-in/depart/cancel/move behave). Then track is functionally
  complete. (Observation to weigh, not a bug: Cancel-one-seat cancels the whole grouped booking
  while Free-one-seat vacates just that seat — defensible different verbs, but confirm it reads
  right on the floor.)
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
- ✅ **P2 — Wire the manage UI. DONE (`e16ef74`, 2026-06-20).** `bulkReserve` → one `holdBeds`;
  `bulkRent` → one `reserveItems` for free seats (all-or-nothing, aborts before touching holds
  on conflict) + per-reservation `convertHoldToWalkIn` for holds. `bulkBlock`/`bulkComp` stay
  per-seat. `SiteManage.bulkGroupConflict` banner copy in en/es/fi. tsc/lint clean, partner 1522
  unit green.
- ◐ **P3 — Verify downstream + browser-verify.** ✅ **Automated half DONE (`135cbee`):** 10
  integration tests — check-in / depart / no-show / cancel-via-one-seat / move all span the
  grouped row; partial-free correctness for releaseHold/unreserveItem (false-bug caught — see
  Resume here). ☐ **Remaining: browser-verify** the end-to-end multiselect → group → act flow
  on a token-gated manage page. partner 61 integration + 1522 unit, tsc/lint green.

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
- [[track:012-multiday-per-day-operational-state]] — **future integration point.** 012 adds
  per-day `ReservationDay` operational rows for multiday stays. 011's `reserveItems` already
  creates multiday grouped walk-ins (`until`), so when 012 lands, a grouped multiday booking
  must seed per-day rows for ALL its seats. No collision today (012 is scope-only); flag so the
  grouped-create path is covered when 012 is built.

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
