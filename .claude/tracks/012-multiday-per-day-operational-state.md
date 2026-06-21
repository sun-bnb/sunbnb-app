---
id: 012-multiday-per-day-operational-state
title: Per-day operational state for multiday sunbed reservations
status: active
created: 2026-06-20
updated: 2026-06-20
worktree: null
---

## Goal

Give multiday sunbed reservations a **per-day operational lifecycle** so the floor view
re-cycles each day. Today a `Reservation` carries ONE operational state for its whole stay
(`operationalStatus` / `checkedInAt` / `departedAt`), but the manage page shows the booking
on every day it overlaps (`from <= todayEnd && to >= todayStart`). The single state never
resets, which produces three failures:

1. **Stale arrival time.** `checkedInAt` (shown in `BedDetail` `OccupantInfo`) is frozen at
   day-1 — meaningless on day 2+. *(Original user report.)*
2. **No daily expected→arrived cycle.** Once checked in on day 1, the bed reads checked-in
   every later morning before the guest has shown up that day.
3. **Double-sell sharp edge.** `bed-state.ts:getActiveReservation` filters out
   `departed`/`no-show`, so departing a multiday guest on day-1 evening makes the bed read
   AVAILABLE on day 2 — even though it's still reserved for days 2–3. Staff work around this
   by never departing multiday guests (→ permanent stale checked-in).

End state: one `ReservationDay` row per (reservation, civil date) with its own
status/checkedInAt/departedAt. Manage/frontdesk read TODAY's row; check-in/depart/no-show
mutate today's row; `bed-state` derives appearance from it. Day 2 auto-starts `expected`;
departing day 1 only affects day 1, the bed stays reserved for the rest of the stay.
Unlocks per-day arrival times, daily no-show, and accurate per-day occupancy.

**Domain assumption (confirm — see Open decisions):** "depart" = *gone for today* (daily
cycle). Early-checkout / release-rest-of-stay is a separate cancel/edit concern, out of scope.

## Resume here

- **Next action:** Finish **P2** — only **occupancy** remains. The availability double-sell is
  DONE (see Log). `@repo/data/analytics.ts:getOccupancyByDay` → per-day: a bed counts occupied on
  day D unless its `(reservation, D)` row is no-show/departed, falling back to the parent
  `operationalStatus` when no row exists (historical months have no rows — keeps their numbers
  stable; only current/future occupancy goes per-day). Mirror the `bed-state.ts:effectiveOpStatus`
  pattern. `@repo/data` → `data-dev`. Accepted as a correction (Q5). LOW immediate value (most
  analytics days are historical → fall back to parent), so fine to defer if other work is hotter.
- **Optional follow-ups (not blocking):** the manage **move/relocate** guards
  (`manage/actions.ts:~468,~543`) and the check-in precondition still read the *parent*
  `operationalStatus` for some decisions — consider per-day (`effectiveOpStatus`) so a
  departed-today multiday booking is still movable; `manage/page.tsx` lazy-upserts sequentially
  (batch with `Promise.all` if perf shows up).
- **Context needed:** This file; P1's `manage/reservation-day.ts` + `bed-state.ts:effectiveOpStatus`;
  `@repo/data/site-day`. Availability is now date-range + payment only (decision below).
- **Blocked by:** nothing — P1 landed (partner tsc clean, 1575 unit + 128 integration green).

## Roadmap

- ✅ **P0 — Schema expand + timezone dependency** (additive migration, no behavior change). DONE
  2026-06-20 — applied to local + `sunbnb_test`; 235 unit (incl. 21 site-day) + 113 integration green.
  `model ReservationDay { reservationId, date, operationalStatus, checkedInAt, departedAt,
  @@unique([reservationId, date]), @@index([date]) }` + `Site.timeZone String?`. New pure
  helper `packages/data/src/site-day.ts` (`siteDayKey`/`siteDayBounds`, DST-aware, null-tz
  fallback) — the single replacement for scattered `dayjs().startOf('day')`. Idempotent
  backfill (today's row mirrors parent op-state; future rows = expected) in `migration.sql`
  with `ON CONFLICT DO NOTHING`. Update **both** partner + user `__mocks__/@repo/data/
  PrismaCient.ts` (`reservationDay` delegate → satisfies `mock-contract.test.ts`). Unit
  tests for `site-day.ts`; data integration test for backfill idempotency.
- ✅ **P1 — Day-row write path + lazy lifecycle (manage).** DONE 2026-06-20 — partner tsc clean,
  1575 unit (+8) + 128 integration green; signatures unchanged (auth-matrix/coverage/mock-contract
  green, no registry edits). New `manage/reservation-day.ts` (`resolveTodayRow` lazy-upsert +
  `applyDayTransition` per-day-row + legacy-mirror in one txn). `page.tsx` windows on
  `siteDayBounds(site)` and lazy-attaches today's row to each non-blocked reservation;
  `bed-state.ts:effectiveOpStatus` derives appearance from today's row (blocked → parent) — the
  **double-sell fix** (parent departed day-1 no longer hides a still-reserved day-2);
  `BedDetail` shows today's `checkedInAt`. `view.tsx` unchanged (forwards the threaded `today`).
  Original P1 line below for reference:
- ░ **P1 (spec, for reference).** `manage/page.tsx` window →
  `siteDayBounds(site.timeZone)`, lazy-upsert today's row per in-range reservation (skip
  `blocked`). `checkInReservation`/`markDeparted`/`markNoShow` mutate today's row **and**
  mirror onto legacy parent fields (expand parallel-write). **Resolve "today" server-side →
  signatures unchanged → no gated-action/auth-matrix churn** (verify both green). `bed-state`,
  `view.tsx`, `BedDetail.tsx`, `types/shared.ts` thread today's row. Extend manage unit +
  integration tests (day-2 = expected; depart day-1 keeps bed reserved day-2; per-day arrival).
- ▶ **P2 — Reader migration: double-sell fix + occupancy.** Lock the `getActiveReservation`
  per-day filter with a test (parent `departed` no longer hides a still-reserved future day).
  `analytics.ts:getOccupancyByDay` → per-day occupancy (read-only swap). **Availability
  (`calendar/actions.ts`, `@repo/data/reservations.ts`, `availabilityService.ts`) explicitly
  NOT changed** — invariant: a departed day must NOT free the bed for new online sales; add a
  guard test.
- ☐ **P3 — Frontdesk parity.** `apps/partner/app/frontdesk/{page,actions,view}.tsx` is a
  near-verbatim DUPLICATE of the manage state machine + today-overlap query (same bug). Extract
  the day-row resolve/mutate into `@repo/data` so manage + frontdesk share one impl; apply the
  same model. Mirror P1 tests.
- 💤 **P4 — Contract (separate track).** Drop `Reservation.operationalStatus`/`checkedInAt`/
  `departedAt`, migrate remaining legacy readers (dashboard, reservation detail, emails) to a
  booking-level rollup. Deferred: shared test DB + immutable migrations.

## Open decisions  — Q1–Q5 LOCKED 2026-06-20

1. ✅ **Depart semantics** = **gone-for-today (daily cycle)**. Early-checkout / release-rest-of-
   stay is a separate cancel/edit concern, out of scope.
2. ✅ **Site timezone** = **derive from site lat/lng now** (sites store coords as PostGIS
   geometry). Add `Site.timeZone` and backfill from coordinates in the P0 migration; compute on
   site save for new sites. Recommended lib: offline `tz-lookup` (tiny, no network) — confirm at
   P0 start. No hardcoded-default path needed (every site has coords); keep a safe fallback only
   for a missing/invalid coord.
3. ✅ **Frontdesk** = **in this track (P3)**, sharing the day-row logic via `@repo/data`.
4. ✅ **No-show on day 1** → day 2 auto-seeds `expected` (no propagation; propagation is a cancel
   concern, ties to Q1).
5. ✅ **Occupancy analytics** = **recalculate per-day** (P2). Mid-stay departed days now count as
   occupied-until-departure; historical figures shift vs. shipped track 007 — treated as a
   correction, not a regression.

## Log

- **2026-06-21 — Aligned to the user's offline/online state machine (the real model).** User
  spelled out the crux: Available →Reserve→ **Held**; Available →Rent→ **Walk-in**; Held →Release→
  Available; Held →Rent→ Walk-in; Walk-in →**Depart**→ **Held** *(if valid tomorrow)*; Walk-in
  →**Unreserve**→ Available *(last day)*. Online follows the same cycle. **Key fix: `markDeparted`
  now returns a MULTIDAY booking to RESERVED (`expected`), not a terminal `departed`** — that IS the
  daily reset, and it keeps the bed held (re-rentable tomorrow) without per-day double-sell math.
  Only on the LAST day (no future days, `to <= end of today`) does depart mark `departed` → freed
  via the stay-over rule. Also: (a) **appearance** — a reserved bed is now calm yellow ● (or € when
  paid online), never the flashing ⏳ hourglass; only a genuinely in-flight `processing` payment
  pulses; (b) **`resolveTodayRow`** now syncs walk-in/comp from the parent so a held→walk-in convert
  isn't left as a stale reserved/⏳; (c) **`unreserveItem`** works in ANY operational state (free a
  cash walk-in any time, incl. after depart/no-show). +1 integration test (multiday depart → reserved
  + still blocks) + appearance/unreserve unit-test updates. Green: partner 1579u+131i; data/user
  unchanged. NOTE: this leans toward retiring the per-day-row complexity P1 added — the machine gives
  daily-reset natively; the rows are now largely vestigial (kept dormant, can be dropped later). UI
  follow-up: BedDetail could relabel "Depart" → "Check out"/"Unreserve" on the last day, and the
  online present-state shows blue checked-in vs orange walk-in after the first cycle (cosmetic).
- **2026-06-21 — P2 refined to the STAY-OVER rule (corrects the day before).** The earlier P2
  "op-status never frees a bed" was too blunt: it broke same-day walk-in turnover (rent → depart →
  re-rent failed "already reserved for part of this period") AND left the grid lying (the departed
  seat painted green/available but wasn't bookable). **User decision:** a no-show/departed booking
  frees its bed only once its **stay is over** — no remaining reserved days (`to` <= end of today,
  server-tz, matching how walk-in `to` is stored). So single-day and last-day departures are
  re-bookable; a multiday booking departed mid-stay stays held (no double-sell). Applied the SAME
  `stayOver`/`to <= endOfToday` exception consistently to all three availability paths
  (`reserveWithConflictGuard` NOT-clause, `getAvailableSunbeds`, `availabilityService`) AND to
  `bed-state` (via a server-computed `Reservation.stayOver` flag threaded from `page.tsx`) — so
  "green ⟺ bookable" by construction. A mid-stay departed bed renders as reserved (`expected`), never
  green. Re-revised the P2 tests: same-day manage-grouped depart/no-show → re-rent SUCCEEDS again;
  future-dated guard tests still block; added direct "same-day departed → guard returns created" +
  3 bed-state stay-over unit tests. Green: data 235u+132i, partner 1578u+130i, user 332u+45i, lints
  clean. (Browser-verify skipped at user's request.) Orchestrator (coupled cross-app + consumer-facing).
- **2026-06-20 — P2 (availability double-sell) landed; DECISION on the availability invariant.**
  Discovered while scoping P2: the plan's "don't touch availability, it already blocks whole-stay"
  was wrong — the conflict guard (`reservations.ts`), calendar `getAvailableSunbeds`, and the user
  `availabilityService` ALL excluded `[OP_NO_SHOW, OP_DEPARTED]`, so a multiday booking departed on
  day-1 (P1 mirrors that onto the parent) freed days 2–3 for a NEW consumer/calendar/walk-in
  booking. P1 fixed the manage grid but not this. **User chose: availability blocks on date-range +
  payment status only — operational status NEVER frees a bed** (reuse a no-show/departed bed via an
  explicit release → status `canceled`, not as an op-status side effect). Removed the
  `[OP_NO_SHOW, OP_DEPARTED]` exclusion from all three paths (conflict-guard default → `[]`,
  `getAvailableSunbeds`, `availabilityService`). Flipped 6 existing tests that encoded the old
  "no-show/departed frees the bed" contract (2 data conflict-guard, 2 calendar, 2 manage-grouped) —
  they now double as the double-sell guard (a departed reservation still blocks its range). Green:
  data 235u+131i, partner 1575u+128i, user 332u+45i; all lints clean. Done by orchestrator (tightly
  coupled cross-app semantic change). Remaining P2: occupancy per-day (low immediate value).
- **2026-06-20 — P1 landed.** Manage now reads/writes today's `ReservationDay` row.
  `manage/reservation-day.ts`: `resolveTodayRow` (lazy-upsert, default `expected`, mirror parent for
  walk-in/comp, blocked skipped) + `applyDayTransition` (today-row + legacy-mirror in one
  `$transaction`). `page.tsx` windows on `siteDayBounds(site)` (venue-local, replacing server-tz
  `dayjs().startOf('day')`) and attaches `today` per non-blocked reservation;
  `checkIn/markDeparted/markNoShow` route through `applyDayTransition` (signatures unchanged, "today"
  resolved server-side — auth-matrix/coverage/mock-contract stay green). `bed-state.ts` adds
  `effectiveOpStatus` (today's row, blocked→parent) so the `[departed,no-show]` filter is per-day =
  **double-sell fix**. `BedDetail` shows today's `checkedInAt`. `types/shared.ts` gains
  `Reservation.today`. +8 unit tests (day-2 re-cycle, depart-day-1-keeps-reserved, per-day arrival,
  blocked sticky, no-show non-propagating). Green: partner tsc + 1575 unit + 128 integration.
  **Deferred to P2/follow-up:** real-DB integration test for the per-day behaviors (unit-only so far);
  `page.tsx` sequential lazy-upsert loop (perf — batch if needed). Done by `partner-dev`; orchestrator
  reviewed the diff + removed a stray unused field.
- **2026-06-20 — P0 landed.** Schema: `ReservationDay` (`@db.Date`, `@@unique([reservationId,
  date])`, `@@index([date])`, cascade FK) + `Reservation.days` back-rel + `Site.timeZone`. Pure
  helper `@repo/data/site-day` (`resolveSiteTimeZone`/`siteDayKey`/`siteDayBounds`, native `Intl`
  DST-correct, `tz-lookup` from `Site.locationLat`/`locationLng`, `Europe/Madrid` fallback) — 21
  unit tests. Migration `20260620125353_…` applied to local + `sunbnb_test`; 235 data unit + 113
  integration green; `migrate:check` clean. **Incident:** first backfill blew up to 355k rows —
  one `blocked` bed has a year-2999 sentinel `to`, so `generate_series` exploded. Fixed by
  excluding `operational_status='blocked'` from the backfill (matches D5: blocked is sticky, reads
  parent, no per-day rows). Migration was uncommitted/unshipped (local + docker test only), so
  corrected in place + cleaned junk rows + reconciled the recorded checksum on both DBs (sanctioned
  local-drift patch); both report no drift, `migrate deploy` to `sunbnb_test` clean. **Agent note:**
  `data-dev` overstepped (touched 3 P1 partner files — reverted, no real diff) and didn't generate
  the migration (orchestrator wrote it).
- **2026-06-20** — Created. Surfaced while fixing the `BedDetail` period indicator + arrival-time
  display (the stale-arrival-time symptom). User chose the "correct model" (per-day records) over
  a daily-reset-of-single-field or display-only stopgap. Plan-agent design pass completed; it
  found the bug is duplicated in `frontdesk/` (P3), that there is **no `Site.timeZone`** field
  (P0 dependency; `Restaurant.timeZone` is the precedent), and that availability must stay on the
  whole-stay legacy filter (P2 invariant).
- **2026-06-20** — Decisions Q1–Q5 locked with user (see Open decisions): daily-cycle depart;
  timezone **derived from site lat/lng** (`tz-lookup`, backfill from coords); frontdesk **in
  scope** (P3); no-show non-propagating; occupancy **recalculated per-day** (accepted as a
  correction). P0 also gains coord→IANA derivation + `Site.timeZone` coord-backfill. Status:
  awaiting go-ahead to start P0 (schema migration).

## Links

- [[track:010-floor-reservation-lookup]] — its `findReservations` arrivals roster + parked P5
  "resell unfulfilled holds" read the frozen parent op-status; they become *correct per-day* once
  this lands. Upstream dependency — cross-link, do not merge.
- [[track:008-employee-model]] — floor attribution/till; sibling manage-subsystem work.
- [[subsystem:schematic-editor]] · the partner manage page (`apps/partner/app/sites/[id]/manage/`).
