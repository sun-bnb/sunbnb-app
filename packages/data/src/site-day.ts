/**
 * Civil-day math keyed to a site's venue-local timezone.
 *
 * PURE MODULE — no Prisma/pg imports. Safe for client-component import trees.
 *
 * Coordinate contract
 * -------------------
 * Sites store lat/lng as plain String columns `locationLat` / `locationLng` on
 * the Site model (alongside the PostGIS `geometry` column for spatial queries).
 * A plain `prisma.site.findUnique()` returns those String fields directly.
 * Callers pass `{ timeZone?, latitude?, longitude? }` where `latitude` and
 * `longitude` are the parsed floats from `site.locationLat` / `site.locationLng`.
 *
 * Timezone resolution order
 * -------------------------
 * 1. `site.timeZone` (explicitly stored IANA string) — use as-is.
 * 2. `site.latitude` + `site.longitude` — derive via `tz-lookup` (offline, no network).
 * 3. Hard fallback: `'Europe/Madrid'` (safe for the platform's primary market).
 *
 * Civil-day arithmetic
 * --------------------
 * Uses `Intl.DateTimeFormat` (native JS, no extra deps) to extract the
 * wall-clock year/month/day in the target timezone, then reconstructs UTC
 * start/end instants. This handles DST transitions correctly because
 * `Intl.DateTimeFormat` consults the IANA tzdb embedded in the JS runtime.
 */

import tzlookup from 'tz-lookup'

/** The IANA fallback for sites with no stored timezone and no parseable coords. */
const DEFAULT_TZ = 'Europe/Madrid'

/**
 * Input shape accepted by all helpers in this module.
 * Matches what a Prisma `site.findUnique()` returns after parsing the String fields:
 *
 *   const site = await prisma.site.findUnique({ where: { id } })
 *   const tz = resolveSiteTimeZone({
 *     timeZone: site.timeZone,
 *     latitude: site.locationLat ? parseFloat(site.locationLat) : undefined,
 *     longitude: site.locationLng ? parseFloat(site.locationLng) : undefined,
 *   })
 */
export interface SiteTimezone {
  timeZone?: string | null
  latitude?: number | null
  longitude?: number | null
}

/**
 * Resolve the IANA timezone for a site.
 *
 * 1. Returns `site.timeZone` if it is a non-empty string.
 * 2. If `latitude` and `longitude` are finite numbers, derives the timezone
 *    via the offline `tz-lookup` library.
 * 3. Falls back to `'Europe/Madrid'` if neither is available.
 */
export function resolveSiteTimeZone(site: SiteTimezone): string {
  if (site.timeZone && site.timeZone.trim().length > 0) {
    return site.timeZone.trim()
  }
  if (
    site.latitude != null &&
    site.longitude != null &&
    isFinite(site.latitude) &&
    isFinite(site.longitude)
  ) {
    try {
      const derived = tzlookup(site.latitude, site.longitude)
      if (derived) return derived
    } catch {
      // tz-lookup returns null for coords in the ocean; fall through to default
    }
  }
  return DEFAULT_TZ
}

/**
 * Returns the civil date key `YYYY-MM-DD` for `now` (default `new Date()`) in
 * the site's venue-local timezone. Use this as the canonical per-day key for
 * `ReservationDay.date` lookups.
 *
 * Example: a 23:30 UTC instant on 2024-07-14 is "2024-07-15" in
 * `Europe/Madrid` (UTC+2 in summer) — this function returns `"2024-07-15"`.
 */
export function siteDayKey(site: SiteTimezone, now: Date = new Date()): string {
  const tz = resolveSiteTimeZone(site)
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  // en-CA locale formats dates as YYYY-MM-DD — use it as the canonical key
  return formatter.format(now)
}

/**
 * Returns the UTC instants for the civil-day start (00:00:00.000) and end
 * (23:59:59.999) in the site's venue-local timezone for the day containing
 * `now` (default `new Date()`).
 *
 * Use these as the window for "today's reservations" queries, replacing the
 * scattered `dayjs().startOf('day')` / `endOf('day')` calls in manage and
 * frontdesk query actions.
 *
 * DST safety: the Intl approach extracts the wall-clock date components in the
 * target tz and reconstructs them — it does not add/subtract a fixed offset,
 * so it handles spring-forward and fall-back gaps correctly.
 */
export function siteDayBounds(
  site: SiteTimezone,
  now: Date = new Date(),
): { start: Date; end: Date } {
  const tz = resolveSiteTimeZone(site)

  // Extract wall-clock year/month/day in the venue tz for the given instant
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour12: false,
  }).formatToParts(now)

  const get = (type: string) =>
    parseInt(parts.find((p) => p.type === type)?.value ?? '0', 10)

  return boundsForCivilDate(get('year'), get('month'), get('day'), tz)
}

/**
 * Returns the UTC instants for the civil-day start (00:00:00.000) and end
 * (23:59:59.999) in the site's venue-local timezone for an explicit civil date
 * given as a `YYYY-MM-DD` key (as chosen in a `<input type="date">` or stored
 * as a `Reservation`/`Settlement` period boundary).
 *
 * This is the civil-date-keyed sibling of `siteDayBounds` (which keys off an
 * instant). Use it wherever a query window is defined by a calendar date rather
 * than "now" — e.g. the settlement period, an accounting month's edges.
 *
 * DST-safe by the same reconstruction as `siteDayBounds`. Throws on a malformed
 * key so a bad boundary fails loudly rather than silently windowing on `NaN`.
 */
export function siteDateBounds(
  site: SiteTimezone,
  dateKey: string,
): { start: Date; end: Date } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey.trim())
  if (!m) {
    throw new Error(`siteDateBounds: expected YYYY-MM-DD, got "${dateKey}"`)
  }
  const tz = resolveSiteTimeZone(site)
  return boundsForCivilDate(parseInt(m[1]!, 10), parseInt(m[2]!, 10), parseInt(m[3]!, 10), tz)
}

/**
 * Shared reconstruction for the day-bounds helpers: given a 1-based civil date
 * and an IANA tz, return the UTC start/end instants of that civil day.
 *
 * The next day's midnight − 1ms is used for the end so DST transitions are
 * handled correctly (a spring-forward day is 23h; a fall-back day is 25h). The
 * +25h overshoot then re-read guarantees we land on the following calendar day
 * regardless of the transition direction.
 */
function boundsForCivilDate(
  year: number,
  month: number,
  day: number,
  tz: string,
): { start: Date; end: Date } {
  const start = localMidnight(year, month, day, tz)

  const nextDay = new Date(start.getTime() + 25 * 60 * 60 * 1000)  // +25h overshoots
  const nextParts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour12: false,
  }).formatToParts(nextDay)
  const getN = (type: string) =>
    parseInt(nextParts.find((p) => p.type === type)?.value ?? '0', 10)
  const nextStart = localMidnight(getN('year'), getN('month'), getN('day'), tz)
  const end = new Date(nextStart.getTime() - 1)

  return { start, end }
}

/**
 * Compute the UTC Date corresponding to 00:00:00.000 local time for a given
 * civil date (year, 1-based month, day) in `tz`.
 *
 * Strategy: construct a "naive" ISO string for midnight, then use
 * `Intl.DateTimeFormat` to measure the actual UTC offset at that moment and
 * correct for it. One iteration is enough because DST offsets change at the
 * hour boundary, not at midnight (in all IANA zones in use).
 */
function localMidnight(year: number, month: number, day: number, tz: string): Date {
  // Pad to ISO format
  const pad = (n: number, len = 2) => String(n).padStart(len, '0')
  const naiveIso = `${pad(year, 4)}-${pad(month)}-${pad(day)}T00:00:00.000Z`
  const naiveUtc = new Date(naiveIso)

  // Ask Intl what local time that UTC instant maps to in the target tz
  const localParts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(naiveUtc)

  const getP = (type: string) =>
    parseInt(localParts.find((p) => p.type === type)?.value ?? '0', 10)

  const localHour = getP('hour')   // 0–23 (hour12: false)
  const localMin = getP('minute')
  const localSec = getP('second')

  // Offset = how far naiveUtc is from midnight local: subtract to align
  const offsetMs =
    localHour * 3_600_000 + localMin * 60_000 + localSec * 1_000

  return new Date(naiveUtc.getTime() - offsetMs)
}
