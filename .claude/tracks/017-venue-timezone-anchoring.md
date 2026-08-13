---
id: 017-venue-timezone-anchoring
title: Venue timezone anchoring — one civil-day convention across the platform
status: proposed
created: 2026-08-11
updated: 2026-08-11
worktree: null
---

## Goal

Make **the venue's civil day** the single anchoring convention for every date boundary in the
platform — writes, reads, reports, and crons — so that "today", "this month" and "this period"
mean the same instant range everywhere.

Track [[track:012-multiday-per-day-operational-state]] P0 built the correct primitive
(`packages/data/src/site-day.ts` — `siteDayKey`/`siteDayBounds`, Intl-based, DST-correct) and
added the `Site.timeZone` column. It was then adopted in **9 files only** — all under
`apps/partner/app/sites/[id]/manage/` plus `packages/data/src/till.ts`. Everything else still
does day math in the **server** timezone (UTC on Vercel) or the **browser's** timezone.

The result is worse than a uniform offset: `Reservation.from`/`to` now holds **two different
conventions** depending on which surface wrote the row. Manage writes venue-anchored days;
`apps/user` and `apps/partner/app/calendar` write browser/server-anchored days. Readers that
assume either one produce *wrong answers*, not merely shifted ones.

Reference case throughout: venue `Europe/Madrid` (UTC+2 in summer), server UTC. Venue civil day
*N* = `[N-1 22:00Z, N 21:59:59.999Z]`; a UTC day is shifted **+2h** relative to it.

End state: one anchoring contract, one shared timezone module, `siteMonthBounds` alongside
`siteDayBounds`, and no `dayjs().startOf('day')` / `setHours(0,0,0,0)` / `Date.UTC(...)` day math
in any query window, write path, or money boundary.

## Resume here

- **P1 + P2 + P3 are DONE.** P1 (`f0b51ba`), P2 (2 commits) — all pushed to `main` 2026-08-11.
  **P3 done 2026-08-13, UNCOMMITTED on local `main`** (Q1=(a), Q2=fix-forward — founder calls).
  See Log. No schema change anywhere → no migration.
- **Next action:** pick from the remaining independent phases — none is blocked now:
  - **P7** (populate `Site.timeZone` + restaurant tz inheritance) — closes the P2-availability
    Canary residual (multi-site search SQL falls back to Madrid without a stored `time_zone`).
  - **P4** (money/reporting windows: accounting/VAT month boundaries, `siteMonthBounds`) —
    money/compliance; line numbers were flagged second-hand, re-verify first.
  - **P5** (analytics UTC bucketing → venue day; occupancy double-count) · **P6** (collapse the
    two tz modules — needs Q4).
- **Still open:** **Q3** (whether past short-by-a-day settlements from P1 get restated) — unrelated
  to P3, decide when settling accounts. **Q5** (surface a "tz was guessed" signal) — cheap, tie to P7.
- **Deferred functional fix (documented, not lost):** the conflict-guard release predicate
  `findConflictingReservation` in `packages/data/src/reservations.ts` still uses a SERVER-tz
  `endOfToday` — benign east of UTC, inverted west of UTC. Venue-anchor it (thread site tz →
  `siteDayBounds(siteTz).end`) before any non-EU launch. Comment corrected in place.
- **Context needed:**
  - This file.
  - `packages/data/src/site-day.ts` — the canonical primitive (read it first; it is correct,
    do not reimplement it).
  - `packages/table-reservations-core/src/tz.ts` — the *second*, divergent implementation.
  - The long warning comment at `apps/partner/app/sites/[id]/manage/actions.ts:190-210` — it
    states the rule this track enforces platform-wide.
  - `.claude/rules/architecture.md` (this is a cross-app + `packages/data` change → architecture
    pass required) and `.claude/rules/migrations.md` if P5 adds a backfill.
- **Blocked by:** nothing for P1/P2. P3 is blocked on Q1.

## Roadmap

- ☑ **P1 — Settlement period drops its final day** *(DONE 2026-08-11 — money; isolated)*
  `apps/admin/app/settlements/actions.ts:62-63` builds `periodEnd = new Date("2025-08-31")` →
  `2025-08-31T00:00:00Z`, and `packages/data/src/settlement.ts:99-101` (`previewSettlement`) +
  `:188-190` (`generateSettlement`) filter `invoicedAt: { gte: periodStart, lt: periodEnd }`.
  Selecting 1–31 Aug therefore settles **1–30 Aug**. Revenue is not lost (it rolls into the next
  batch) but payouts are a day short and the persisted `periodStart`/`periodEnd` label
  misrepresents what was settled. Defaults at `apps/admin/app/settlements/view.tsx:121`/`:170`
  feed the browser's UTC date into the same boundary.
  Fix: make the end bound exclusive-of-next-day (or inclusive end-of-day) **in the venue
  timezone**, and correct the stored label. Add a regression test asserting an invoice stamped
  on the final day of the period is included.

- ☑ **P2 — Reminder emails + consumer availability counts** *(DONE 2026-08-11 — consumer-visible)*
  - `packages/data/src/reservation-emails.ts:390-393` and `packages/data/src/rental-emails.ts:326-328`
    window on server-local `setHours(0,0,0,0)`. Consumer bookings are written from the
    **browser's** start-of-day, so a Spanish guest's Aug 11 booking stores `from = Aug 10 22:00Z`
    and never falls inside the Aug 11 UTC window. `reminderSentAt` is stamped regardless, so a
    miss is **unrecoverable**. Cron route (`apps/user/app/api/cron/send-reminders/route.ts`) is
    clean — it just delegates.
  - `apps/user/service/siteService.ts:145-148` (+ raw SQL `:187-191`) and
    `apps/user/service/availabilityService.ts:96-99` (`countAvailableToday`) use a server-local
    day against an **overlap** predicate, so tomorrow's venue-anchored bookings count as
    occupying today → the marketplace advertises fewer free sunbeds than exist. The comment at
    `siteService.ts:144` asserts a storage convention manage no longer follows — correct it.

- ☑ **P3 — Venue-anchor the write paths** *(DONE 2026-08-13 — Q1=(a), Q2=fix-forward; the root cause)*
  - `apps/user/app/sites/[id]/Reservation.tsx:470-471` — `dateRange[0].toDate()` /
    `.endOf('day')` are **browser**-anchored and are the persisted `from`/`to` of every consumer
    booking. Related client windows: `apps/user/app/sites/[id]/view.tsx:119-120`,
    `Reservation.tsx:112-113`, `:399`, `:408-409`, and the selection components.
  - `apps/partner/app/calendar/actions.ts:61-62` — `dayjs(data.from).startOf('day')` /
    `.endOf('day')`, the one **partner write path** that ignores the venue anchor. Also the read
    side at `:178-179` (`getAvailableItems`). Causes phantom conflicts against manage-written
    venue days and blocks that linger 2h into the next venue day.
  - Once writes are uniform, revisit the stale invariant comments at
    `packages/data/src/reservations.ts:119-122` (duplicated verbatim at
    `apps/partner/app/calendar/actions.ts:191-192` and
    `apps/user/service/availabilityService.ts:66-67`): they justify server-TZ math by asserting
    `to` is stored as server-TZ end-of-day, which is **no longer true**. Benign for UTC+2 (the
    server boundary is later, so departed beds still release) but inverted for any venue **west
    of UTC**, where a departed bed would not release until the next server day. Fix before any
    non-EU launch; correct the comments regardless.

- ☐ **P4 — `siteMonthBounds` + the money/reporting windows**
  `site-day.ts` has day helpers only, which is *why* every monthly window hand-rolls
  `Date.UTC(...)`. Add `siteMonthBounds(site, year, month)` to the same module, then migrate:
  - `apps/partner/app/sites/[id]/accounting/actions.ts` — `:43-44`, `:62-63`, `:87-94`,
    `:229-230`, `:281-282` (**fiscal/VAT report**), `:294-295`. For Madrid the venue month starts
    `Jul 31 22:00Z`, so each month's opening two hours book into the **previous** VAT period.
    Sibling functions also mix inclusive (`Date.UTC(y, m, 1) - 1`) and exclusive
    (`Date.UTC(y, m, 1)`) end forms — unify.
  - `apps/partner/app/sites/[id]/accounting/actions.ts:263-264` (`getEmployeeShiftItems`)
    computes a UTC day while `getTillDayReport` (`manage/actions.ts:3556`) computes the same day
    via `siteDayBounds` — two screens disagree on one employee's cash.
  - `apps/partner/app/sites/[id]/manage/DailySummaryView.tsx:41-42` self-computes
    `new Date().toISOString().slice(0,10)`, so between 00:00–02:00 local the cash-up screen shows
    **yesterday**. The sibling `close/page.tsx:43` already uses `siteDayKey` — copy that.
  - Rolling trend windows `accounting/actions.ts:124-125`, `:147-148`, `:167-168`, `:188-189`,
    `:208-209` inherit the same skew; the "last row is always today" contract at `:194-197`
    breaks for the `window = 1` ("Hoy") case.

- ☐ **P5 — Analytics day bucketing**
  `packages/data/src/analytics.ts:140-142` (`utcDayStart`) + `dayKey` bucket every series in UTC
  (`getRevenueByDay`, `getReservationDayStats`, `getOccupancyByDay`, `getRevenueByChannelByDay`,
  `getMonthlySourceSummary`). Two distinct effects: revenue rung up 00:00–02:00 local lands on
  the previous day's bar; and occupancy (`:369`, `res.from < dayEnd && res.to >= dayStart`)
  double-counts a venue-day booking across two UTC buckets, inflating occupancy toward 2× and
  allowing >100% of capacity. Note the interaction with 012's per-day occupancy work.

- ☐ **P6 — Collapse the two timezone modules**
  Two independent implementations declare the **same** fallback literal with no shared import:
  `packages/data/src/site-day.ts:31` and `packages/table-reservations-core/src/tz.ts:11`
  (both `'Europe/Madrid'`).

  | | `site-day.ts` (Site) | `tz.ts` (Restaurant) |
  |---|---|---|
  | lat/lng derivation | yes (`tz-lookup`) | no — Restaurant has no geo columns |
  | day-bounds primitive | `siteDayBounds` | **none** |
  | validation | none | `isValidTimeZone` |
  | interval convention | inclusive end | callers build exclusive ends |

  Because B has no day-bounds helper, its callers reinvented civil days as `start + 24h`
  (`reservations/queries.ts:122`, `availability.ts:133`). On a Madrid **spring-forward** day
  (23h) that overruns into the next day; on a **fall-back** day (25h) it is an hour short, so
  bookings in the last local hour vanish from the day view and late slots can be offered as free
  (double-book risk). `site-day.ts` deliberately avoids this (+25h overshoot then re-read,
  `:139-151`, with a regression test at `site-day.test.ts:142-165`);
  `tz.test.ts:52` only tests a normal afternoon on a transition day.
  Target: one module, exporting both `isValidTimeZone` and the day/month bounds, consumed by both
  domains.

- ☐ **P7 — `Site.timeZone` writer + restaurant inheritance** *(robustness; low urgency)*
  - `Site.timeZone` (`schema.prisma:249`) was added by 012 P0 but is **never written** — no UI
    field, absent from `site-actions.ts` entirely. Tier 1 of `resolveSiteTimeZone` never fires
    for a Site; every site resolves via `tz-lookup(lat, lng)` or falls to Madrid. Mostly benign
    (derivation is accurate) but there is no override and no signal when the fallback is used.
    `Restaurant.timeZone` is the precedent: validated via `isValidTimeZone`
    (`restaurant/actions.ts:53-57`), with a `<select>` at `RestaurantSettingsForm.tsx:307-325`.
  - A **linked** restaurant never inherits its site's timezone:
    `apps/partner/app/restaurants/[id]/actions.ts:62-69` passes name, slug and layout dims to
    `coreCreateRestaurant` (and copies working hours at `:74-80`) but not `timeZone`, and never
    reads the site's coords → `timeZone = null` → Madrid. A Canary venue gets Site
    `Atlantic/Canary` vs Restaurant `Europe/Madrid`: a permanent 1h disagreement inside one
    physical venue, until someone opens the dropdown. `Atlantic/Canary` ships in the option list
    (`RestaurantSettingsForm.tsx:31`), so this is an expected deployment, not hypothetical.

- 💤 **Backlog — display-only offenders.** Ticket date line
  (`apps/user/app/sites/[id]/pos/[itemId]/Reservation.tsx:167`), fiscal CSV invoice-date column
  (`accounting/view.tsx:534` — promote if the CSV is what the accountant files), calendar
  "today" highlight + `goToToday` (`apps/partner/app/calendar/view.tsx:48`, `:186`, `:192` —
  `:186` drives a query, so it is marginally more than display), partner client-side day previews
  (`BedDetail.tsx:71`, `:243`, `:307-308`, `view.tsx:174`, `GuestSearchSheet.tsx:31-32`). The
  manage validation bound at `manage/actions.ts:174` (inside `resolveStayBounds`) compares a
  server-TZ "today" against a venue-anchored value — benign, but it is now the single place that
  bound lives, so it is cheap to correct.

## Log

- **2026-08-11 — Track created from a timezone audit.** Audit was triggered by pilot feedback
  about multi-day walk-ins (see Links), which surfaced two TZ smells; the follow-up sweep found
  the pattern is platform-wide.

  **Verified directly (read the code):** `Site.timeZone` never written; `site-day.ts` is
  Intl-based and DST-correct; reminder-cron server-TZ window
  (`reservation-emails.ts:390-393`); consumer booking browser-anchored write
  (`Reservation.tsx:470-471`); availability server-TZ window (`siteService.ts:145-148`);
  settlement `lt: periodEnd` excluding the final day (`admin/settlements/actions.ts:62-63` +
  `settlement.ts:99-101`); linked restaurant not inheriting `timeZone`
  (`restaurants/[id]/actions.ts:62-69`); the `+24h` day assumption in
  `table-reservations-core` (`queries.ts:122`, `availability.ts:133`); UTC bucketing in
  `analytics.ts:140-142`.

  **Reported second-hand, not independently verified:** the accounting month-window line
  numbers in P4, and the calendar heat-map `::date`-without-timezone claim
  (`apps/partner/app/api/reservations/[siteId]/route.ts:63-85`, which also uses a
  *containment* filter — `"from" >= monthStart AND "to" <= monthEnd` — so bookings straddling a
  month edge would drop out of the calendar entirely). **Re-verify before acting on these.**

- **2026-08-11 — Related fix shipped separately (not part of this track).** Multi-day `until`
  was wired into `holdBeds`, `compBed` and `compBeds`, and the duplicated validation was
  extracted into `resolveStayBounds` (`manage/actions.ts:166`). That consolidation means the
  server-TZ validation bound now lives in exactly one place — see the Backlog item.

- **2026-08-11 — P1 shipped (uncommitted, local `main`).** Venue-anchored the settlement
  period window so the final civil day is no longer dropped.
  - `packages/data/src/site-day.ts` — added `siteDateBounds(site, 'YYYY-MM-DD')`, the
    civil-date-keyed sibling of the instant-keyed `siteDayBounds` (both now share a private
    `boundsForCivilDate`). DST-safe; throws on a malformed key. +6 unit tests.
  - `packages/data/src/settlement.ts` — `previewSettlement` + `generateSettlement` now derive
    the `invoicedAt` window from the site's timezone via a shared private
    `resolveSettlementWindow` (loads `Site.timeZone`/coords, keys off the incoming civil dates,
    exclusive `lt` = start of the day after the end date). The **stored label is left as the
    admin-selected civil dates** — decision below.
  - New `packages/data/src/settlement.integration.test.ts` (4 tests): a Madrid invoice at
    `Aug 31 20:00Z` (late on the venue's final day) is now included; front-edge inclusion
    (`Jul 31 22:30Z`); genuine out-of-period exclusion; label preserved.
  - **Decision (supersedes "correct the stored label" in P1's roadmap note):** the fix
    decouples the *query window* from the *stored label*. Only the query was buggy — the label
    text ("01 Aug – 31 Aug") was already right, it just didn't match what the query covered.
    Storing venue-anchored *instants* as the label was rejected because the admin view's
    `fmtDate` renders in the **browser** tz (`toLocaleDateString`), so `periodStart = Jul 31
    22:00Z` would show "31 Jul" in a UTC browser — a display regression. Keeping the
    admin-selected civil dates renders correctly in every browser tz and is consistent in
    venue terms. Cross-tz display of period boundaries stays a P4/backlog concern.
  - Green: data 281 unit + 303 integration, lint clean, admin settlement 19 unit. No schema
    change → no migration. **Interacts with Q3** (whether past short-by-a-day settlements get
    restated — still open).

- **2026-08-11 — P2 shipped (two commits, local `main`, unpushed).** Venue-anchored the
  reminder-email and consumer-availability day windows.
  - **Reminders (`packages/data`):** `sendDueReminders` (`reservation-emails.ts`) and
    `sendRentalDueReminders` (`rental-emails.ts`) previously windowed on server-local
    `setHours(0,0,0,0)` and stamped `reminderSentAt` regardless → an unrecoverable miss for any
    booking whose venue-anchored `from` fell outside the UTC day. Now both fetch a **±36h
    candidate pool** (covers every IANA offset) and keep only rows where
    `siteDayKey(site, from) === siteDayKey(site, now)` — full coord-tier tz resolution, so a
    cross-site cron is correct per venue. `rental-emails.test.ts` fixture `from` made
    relative-to-today. New `reminders.integration.test.ts` pins a site to `Asia/Tokyo` (UTC+9)
    and proves only the venue-today booking is reminded (venue-yesterday/tomorrow, both inside
    the fetch window, are filtered out).
  - **Availability (`apps/user`):** single-site `availabilityService.ts`
    (`getAvailability` release predicate + `countAvailableToday` window) now uses
    `siteDayBounds(site)` (full coord tier — correct everywhere). Multi-site search
    `siteService.ts` computes the today window **per row in SQL** via
    `date_trunc('day', now() AT TIME ZONE COALESCE("Site".time_zone,'Europe/Madrid'))`
    (DST-safe next-midnight−1ms form). tz-lookup is JS-only, so the SQL path can only resolve
    the stored `time_zone` column, falling back to Madrid — **fully fixes mainland-ES now**;
    a coord-derived non-Madrid site with no stored tz (Canary) stays offset until **P7**
    populates `Site.timeZone` (chosen scope: "Full P2 both paths" — founder call 2026-08-11).
    Existing `siteService.integration.test.ts` sites pinned to `timeZone:'UTC'` with
    UTC-anchored windows (was server-local → env-fragile); +3 regression tests (Madrid
    venue-tomorrow booking does NOT occupy today, both SQL and JS paths; venue-today does).
  - Green: data 281u + 305i, user 478u + 77i, both typecheck/lint clean, user cron 10u.

- **2026-08-13 — P3 shipped (uncommitted, local `main`).** Venue-anchored both reservation
  WRITE paths so `Reservation.from`/`to` stops carrying two conventions. Q1=(a) (client sends
  civil dates, server re-anchors), Q2=fix-forward (no backfill).
  - **New primitive** `siteAnchoredDay(site, input)` in `packages/data/src/site-day.ts` — accepts
    a bare `YYYY-MM-DD` (anchors directly) or an ISO instant (recovers the venue day via
    `siteDayKey`). Single entry point for write-path anchoring, client-safe/pure. +tests.
  - **Latent bug fixed in `localMidnight`** (the 012 P0 primitive): it corrected only by the
    naive instant's *time-of-day*, so for timezones WEST of UTC it landed on the previous day's
    midnight (the naive-UTC instant reads as the previous local day). Rewritten to measure the
    full-wall-clock offset; **byte-identical for east-of-UTC** (Madrid/spring-forward unchanged),
    now correct for LA/NY. +regression tests. This means `siteDateBounds`/`siteDayBounds` are now
    correct worldwide, not just for the EU fleet.
  - **Consumer (`apps/user`):** `Reservation.tsx` days-branch sends civil dates (not browser
    instants); `saveReservationForMultipleItems` re-anchors `type:'days'` `from`/`to` via
    `siteAnchoredDay` (`.start` for BOTH — the consumer `to` is the EXCLUSIVE checkout day, so
    anchoring to its venue-midnight preserves `daysBetween`/billing exactly; only browser→venue
    shifts). `type:'hours'` instants pass through. POS callers unchanged (on-site → server
    recovery is correct). +regression test (Madrid: civil `2025-08-13`→`2025-08-15` stores
    `from=Aug 12 22:00Z`, `to=Aug 14 22:00Z`).
  - **Partner calendar (`apps/partner`, via partner-dev):** `createPartnerReservation` +
    `getAvailableSunbeds` re-anchor via `siteAnchoredDay` (`.end` for `to` — calendar/manage `to`
    is the INCLUSIVE last-day, matching `resolveStayBounds`); `getAvailableSunbeds`' release
    `endOfToday` now `siteDayBounds(siteTz).end`. Tests pinned to `timeZone:'UTC'`; +regression
    (Madrid write stored venue-anchored). 12 calendar unit + 20 integration green.
  - **Comment cleanup:** the stale "`to` is server-tz end-of-day" invariant comments corrected in
    `reservations.ts` (+ the deferred-west-of-UTC note) and `calendar/actions.ts`;
    `availabilityService.ts` was already venue-anchored by P2.
  - **Observation (out of P3 scope):** consumer `to` is exclusive-checkout while manage/calendar
    `to` is inclusive-last-day — a pre-existing `to`-*semantics* divergence orthogonal to tz.
    P3 preserved each path's billing; unifying that convention is a separate concern.
  - Green: data 329u + 349i, user 521u + 78i (typecheck clean), partner 1968u + 199i (partner-dev),
    full `turbo build` 4/4. No schema change → no migration.

## Open decisions

- **Q1 — What anchors a consumer-written booking?** The guest's browser is not at the venue. Two
  candidates: (a) resolve the venue timezone server-side in the create action and re-anchor
  `from`/`to` there, ignoring the client's instants (client sends civil dates only, `YYYY-MM-DD`);
  or (b) keep client instants and normalise on read. (a) is the only one that makes the stored
  column mean one thing, and matches how manage already writes. **Recommend (a).** Governs P3.
- **Q2 — Backfill or leave history mixed?** Existing rows carry both conventions. Options: leave
  them (reports stay slightly wrong for past periods, but nothing moves under an accountant),
  or backfill `from`/`to` to venue-anchored instants (touches invoiced/settled periods —
  needs care and probably a dry-run report first). Interacts with `.claude/rules/migrations.md`.
- **Q3 — Does P1's settlement fix need a corrective re-run?** If past settlements each dropped a
  final day, that revenue rolled forward into the following batch, so totals reconcile over time
  but individual period labels are wrong. Decide whether to restate or simply fix forward.
- **Q4 — Scope of P6.** Fully merge the two modules into one shared export, or have
  `table-reservations-core` import `@repo/data/site-day` for day/month bounds while keeping its
  wall-clock converters? The latter is smaller; the former kills the duplicated fallback literal.
- **Q5 — Is a "timezone was guessed" signal worth surfacing** in the partner UI when a site has
  no stored `timeZone` and resolution fell through to Madrid? Cheap, and would have made this
  whole class visible earlier.

## Links

- [[track:012-multiday-per-day-operational-state]] — built `site-day.ts` + added `Site.timeZone`
  in P0; its per-day occupancy work overlaps P5.
- [[track:016-day-anchored-till]] — the till is already correctly venue-day-anchored; it is the
  reference implementation for what the rest of the platform should look like.
- [[track:013-settlement-ledger-till]] — cash-settlement ledger feeding the same day windows.
- [[track:002-table-reservations]] — owns `table-reservations-core`, the second tz module (P6).
- `.claude/rules/architecture.md` — cross-app + `packages/data` ⇒ architecture pass required.
- `.claude/rules/migrations.md` — governs any P3/Q2 backfill.
- Origin: pilot feedback (Lauri Tiainen, 2026-08-10) on multi-day partner reservations; the
  timezone audit was a follow-on from that analysis, not part of the reported issue.
