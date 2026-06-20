---
id: 012-multiday-per-day-operational-state
title: Per-day operational state for multiday sunbed reservations
status: proposed
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

- **Next action:** Decisions Q1–Q5 are **LOCKED** (see Open decisions). Awaiting user
  go-ahead to start **P0** (schema expand: `ReservationDay` + `Site.timeZone` + `site-day.ts`
  helper + coord→IANA derivation, additive migration + idempotent backfill). P0 begins with a
  schema migration → confirm before running `migrate:local`.
- **Context needed:** This file; `.claude/rules/migrations.md` (expand/contract, migrate-before-
  push to shared TEST DB); `.claude/rules/architecture.md` (schema change = architecture pass).
  Precedent for the timezone field: `Restaurant.timeZone` (schema ~line 720, IANA string).
  Coordinate→tz: recommend the offline `tz-lookup` lib (tiny, no network) — CONFIRM lib choice
  at P0 start; sites store lat/lng as PostGIS geometry, so backfill `Site.timeZone` from coords.
- **Blocked by:** user go-ahead to begin P0 (schema migration).

## Roadmap

- ☐ **P0 — Schema expand + timezone dependency** (additive migration, no behavior change).
  `model ReservationDay { reservationId, date, operationalStatus, checkedInAt, departedAt,
  @@unique([reservationId, date]), @@index([date]) }` + `Site.timeZone String?`. New pure
  helper `packages/data/src/site-day.ts` (`siteDayKey`/`siteDayBounds`, DST-aware, null-tz
  fallback) — the single replacement for scattered `dayjs().startOf('day')`. Idempotent
  backfill (today's row mirrors parent op-state; future rows = expected) in `migration.sql`
  with `ON CONFLICT DO NOTHING`. Update **both** partner + user `__mocks__/@repo/data/
  PrismaCient.ts` (`reservationDay` delegate → satisfies `mock-contract.test.ts`). Unit
  tests for `site-day.ts`; data integration test for backfill idempotency.
- ☐ **P1 — Day-row write path + lazy lifecycle (manage).** `manage/page.tsx` window →
  `siteDayBounds(site.timeZone)`, lazy-upsert today's row per in-range reservation (skip
  `blocked`). `checkInReservation`/`markDeparted`/`markNoShow` mutate today's row **and**
  mirror onto legacy parent fields (expand parallel-write). **Resolve "today" server-side →
  signatures unchanged → no gated-action/auth-matrix churn** (verify both green). `bed-state`,
  `view.tsx`, `BedDetail.tsx`, `types/shared.ts` thread today's row. Extend manage unit +
  integration tests (day-2 = expected; depart day-1 keeps bed reserved day-2; per-day arrival).
- ☐ **P2 — Reader migration: double-sell fix + occupancy.** Lock the `getActiveReservation`
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
