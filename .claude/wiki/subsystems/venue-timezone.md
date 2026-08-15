---
type: subsystem
slug: venue-timezone
status: stable
sources:
  - packages/data/src/site-day.ts
  - packages/table-reservations-core/src/tz.ts
  - packages/data/src/analytics.ts
  - packages/data/src/settlement.ts
  - packages/data/src/reservation-emails.ts
  - apps/user/service/siteService.ts
  - packages/data/scripts/backfill-site-timezones.ts
related:
  - subsystem:employee-till
  - subsystem:table-reservations
  - entity:reservation
  - entity:settlement
  - flow:settlement-cycle
last_verified: 2026-08-15
---

# Subsystem: Venue timezone anchoring

Every date boundary in the platform — query windows, reservation writes, fiscal/VAT
periods, analytics buckets, reminder crons — anchors to the **venue's civil day**
(its IANA timezone), never the server's (UTC on Vercel) or the browser's. Built by
track 012 (the primitive) and made platform-wide by track 017; the day-anchored
till (track 016) is the reference consumer. Reference frame: a `Europe/Madrid`
venue in summer is UTC+2, so venue day *N* = `[N-1 22:00Z, N 21:59:59.999Z]`.

## Key files / Entry points

Two modules, one per domain, sharing the default + validator:

- **`@repo/data/site-day`** (pure, client-safe — no prisma) — the Site domain.
  - `resolveSiteTimeZone(site)` — 3 tiers: stored `Site.timeZone` → `tz-lookup(lat,lng)` → `DEFAULT_TZ` (`Europe/Madrid`).
  - `siteDayKey` / `siteDayBounds` (instant-keyed "today") · `siteDateBounds(site,'YYYY-MM-DD')` (civil-date-keyed) · `siteMonthBounds(site,y,m)` (fiscal months) — all DST-safe, inclusive-end `{ start, end }`.
  - `siteAnchoredDay(site, input)` — the WRITE-path anchor: accepts a bare civil date (preferred) or a browser instant, returns the venue day bounds.
  - `deriveTimeZoneFromCoords(lat,lng)` — write-time derivation; `isValidTimeZone` + `DEFAULT_TZ` — the single validator/default both domains use.
- **`@repo/table-reservations-core/src/tz.ts`** — the Restaurant domain: wall-clock ⇄ UTC converters (`zonedWallClockToUtc`, `getZonedParts`) for slot times, plus `zonedDayBounds(y,m,d,tz)` (half-open `[start,end)`, DST-safe). Re-exports `DEFAULT_TIME_ZONE`/`isValidTimeZone` from `site-day` — it declares no literals of its own.

`Site.timeZone` is **written**, not just read: `saveGeneral` auto-derives it from
coords on every save, and a new linked restaurant inherits it at create. Existing
NULL rows are populated by `npm run backfill:tz:{local,test,production}[:dry]`
(idempotent, coords-derived).

## Invariants

1. **No hand-rolled day math in any query window, write path, or money boundary.**
   `dayjs().startOf('day')`, `setHours(0,0,0,0)`, `Date.UTC(y,m,1)`, `toISOString().slice(0,10)` against `new Date()` are all server/browser-anchored — use the `site-day`/`tz.ts` primitives.
2. **`Reservation.from`/`to` are venue-anchored at write.** Clients send civil dates (`YYYY-MM-DD`); the server re-anchors via `siteAnchoredDay`. Two `to` conventions coexist BY DESIGN: consumer `to` = venue-midnight of the EXCLUSIVE checkout day (`.start` — preserves `daysBetween` billing); manage/calendar `to` = INCLUSIVE end of the last occupied day (`.end`).
3. **A venue day's end is never `start + 24h`.** DST transition days are 23h/25h; the naive form drops the last local hour (double-book risk) or overruns. Use `siteDateBounds`/`zonedDayBounds`.
4. **Day-bucketed series key on the venue civil day.** All `analytics.ts` series (`getRevenueByDay`, `getOccupancyByDay`, …) and the accounting month/trend windows — a one-venue-day booking lands in exactly one bucket (UTC bucketing double-counted it toward >100% occupancy).
5. **Cross-site crons filter per-row.** Reminders fetch a ±36h candidate pool then keep rows where `siteDayKey(site, from) === siteDayKey(site, now)` — one global window cannot be right for a multi-tz fleet.
6. **SQL that can't run `tz-lookup` reads the stored column.** The consumer search anchors per-row via `COALESCE("Site".time_zone,'Europe/Madrid')` — a NULL `time_zone` means the Madrid fallback, so keep the column populated (writer + backfill).

## Related

- [[subsystem:employee-till]] — the original venue-day-anchored consumer (two-bucket till windows).
- [[subsystem:table-reservations]] — the Restaurant-domain wall-clock engine over `tz.ts`.
- [[flow:settlement-cycle]] / [[entity:settlement]] — settlement periods window on venue civil days via `siteDateBounds`.
- Track record + open follow-ups: `.claude/tracks/017-venue-timezone-anchoring.md`.

## Common pitfalls

- **The conflict-guard release predicate is still server-TZ** (`packages/data/src/reservations.ts#findConflictingReservation`, `endOfToday`) — deliberately: benign east of UTC, **inverted west of UTC** (a departed bed wouldn't release until the next server day). Venue-anchor it before any non-EU launch; the in-code comment carries the recipe.
- **`getInvoicesByMonth` is account-keyed, still UTC** — an account can span timezones, so there is no single site tz to anchor to; needs a per-account tz decision.
- **Restaurant tz inheritance is create-time only.** An existing linked restaurant keeps its own (possibly Madrid-default) `timeZone` until edited; only Sites have a backfill.
- **`tz-lookup` does not throw for ocean coords** — it returns `Etc/GMT±N`; it only throws for out-of-range lat/lng. `deriveTimeZoneFromCoords`'s null branch is defensive, not a real-input path.
- **Tests must pin `timeZone`** (usually `'UTC'`) on fixture sites and anchor expected windows to it — server-local `setHours` windows pass or fail depending on the machine's tz.
- **Don't re-derive a civil date from a browser instant with `.slice(0,10)`** — browser-midnight east of UTC reads as the previous UTC day. Pass the civil date through, or recover the day via `siteDayKey`.
