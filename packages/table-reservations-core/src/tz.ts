// Timezone helpers for the availability engine. Pure — no DB, no deps. Built on
// the platform `Intl` timezone database, so no extra package is needed.
//
// Why this exists: working hours and slot times are venue **wall-clock** values
// ("HH:mm" on a calendar day), but JS Date math (`setHours`, `getDay`) runs in
// the *process* timezone — which is UTC on the deployment target. Computing a
// "20:00" slot with `setHours(20,...)` therefore yields 20:00 UTC, not 20:00 in
// the venue's zone. These helpers convert venue wall-clock ⇄ UTC instants
// correctly, including across DST transitions.

export const DEFAULT_TIME_ZONE = 'Europe/Madrid'

/** True if the runtime's Intl database accepts the IANA zone id. */
export function isValidTimeZone(timeZone: string): boolean {
  if (!timeZone || typeof timeZone !== 'string') return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone })
    return true
  } catch {
    return false
  }
}

/**
 * Offset in minutes between the given UTC instant and the wall-clock reading in
 * `timeZone` (localMinusUtc; positive east of UTC). DST-aware because it asks
 * Intl for the actual local reading at that instant.
 */
function offsetMinutesAt(utcInstant: number, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const parts = dtf.formatToParts(new Date(utcInstant))
  const map: Record<string, number> = {}
  for (const p of parts) if (p.type !== 'literal') map[p.type] = Number(p.value)
  const localAsUtc = Date.UTC(
    map.year!,
    map.month! - 1,
    map.day!,
    map.hour! % 24,
    map.minute!,
    map.second!,
  )
  return Math.round((localAsUtc - utcInstant) / 60000)
}

/**
 * Convert a venue wall-clock time (calendar day + HH:mm in `timeZone`) to the
 * corresponding UTC instant. Handles DST by correcting the offset once at the
 * candidate instant (sufficient for all but the ambiguous fall-back hour, where
 * either valid instant is acceptable for slot generation).
 */
export function zonedWallClockToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const wallAsUtc = Date.UTC(year, month - 1, day, hour, minute)
  const offset1 = offsetMinutesAt(wallAsUtc, timeZone)
  let instant = wallAsUtc - offset1 * 60000
  const offset2 = offsetMinutesAt(instant, timeZone)
  if (offset2 !== offset1) {
    instant = wallAsUtc - offset2 * 60000
  }
  return new Date(instant)
}

/** The venue wall-clock parts of a UTC instant, including day-of-week (0=Sun). */
export function getZonedParts(
  date: Date,
  timeZone: string,
): { year: number; month: number; day: number; hour: number; minute: number; weekday: number } {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
  const map: Record<string, string> = {}
  for (const p of dtf.formatToParts(date)) map[p.type] = p.value
  const weekdays: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  }
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour) % 24,
    minute: Number(map.minute),
    weekday: weekdays[map.weekday ?? 'Sun'] ?? 0,
  }
}

/**
 * Day-of-week (0=Sun..6=Sat) of a civil calendar date. A bare calendar date has
 * no instant, so the weekday is timezone-independent — computed via UTC to avoid
 * any process-TZ drift.
 */
export function civilDayOfWeek(year: number, month: number, day: number): number {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay()
}

/** Parse a strict "YYYY-MM-DD" civil date. Returns null on malformed input. */
export function parseCivilDate(
  iso: string,
): { year: number; month: number; day: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return null
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  return { year, month, day }
}
