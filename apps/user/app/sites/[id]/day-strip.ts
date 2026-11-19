import dayjs from 'dayjs'

/**
 * Pure logic behind the mobile booking day strip (`DayStrip`).
 *
 * The strip replaced the closed date-range field as the first thing a guest
 * sees in the mobile drawer: most sunbed bookings are for today or the next
 * few days, and a field showing `2026-11-19 – 2026-11-19` read as data, not
 * as a choice — guests did not find the calendar behind it. A tap on a day
 * books that single day; multi-day stays go through "Other dates" (the
 * existing calendar).
 */

/** One day of `/api/sites/[id]/daily-availability`. */
export interface StripDay {
  /** Venue civil date `YYYY-MM-DD`. */
  date: string
  available: number
  total: number
}

export type AvailabilityTone = 'free' | 'few' | 'full'

/**
 * Colour band for a day's free-seat count. "Few" is the last 10% of the
 * venue (at least 2 seats) — enough to nudge, without flagging a big beach
 * as scarce at 40 free loungers.
 */
export function availabilityTone({ available, total }: Pick<StripDay, 'available' | 'total'>): AvailabilityTone {
  if (available <= 0 || total <= 0) return 'full'
  if (available <= Math.max(2, Math.ceil(total * 0.1))) return 'few'
  return 'free'
}

/**
 * The `sites.dateRange` value for booking one civil day — the same browser-local
 * start/end-of-day ISO pair `DateRangeSelector` writes, so the seat map query
 * and the reservation submit (`format('YYYY-MM-DD')`) see exactly the chip's day.
 */
export function singleDayRange(dateKey: string): [string, string] {
  const day = dayjs(dateKey)
  return [day.startOf('day').toISOString(), day.endOf('day').toISOString()]
}

/**
 * Which chip the current `dateRange` corresponds to: a strip day when it is a
 * single day shown in the strip, otherwise `'other'` (a multi-day stay or a
 * day beyond the strip — the "Other dates" chip lights up and shows it).
 */
export function selectedChip(
  dateRange: [string | null, string | null] | null | undefined,
  days: Pick<StripDay, 'date'>[],
): string | 'other' | null {
  if (!dateRange?.[0] || !dateRange[1]) return null
  const fromKey = dayjs(dateRange[0]).format('YYYY-MM-DD')
  const toKey = dayjs(dateRange[1]).format('YYYY-MM-DD')
  if (fromKey === toKey && days.some((d) => d.date === fromKey)) return fromKey
  return 'other'
}

/**
 * A stay as a short human label in the guest's locale: "Thu, 19 Nov" for one
 * day, "Thu, 19 Nov – Sat, 21 Nov" for a range. Shared by the mini bar, the
 * confirm step and the closed date field so a stay reads the same everywhere.
 */
export function formatStay(locale: string, from: string | Date, to?: string | Date | null): string {
  const fmt = new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short' })
  const a = new Date(from)
  if (!to || dayjs(a).isSame(to, 'day')) return fmt.format(a)
  return fmt.formatRange(a, new Date(to))
}

/** Tile geometry for `visibleDayCount` — kept beside the strip's Tailwind sizes. */
export const STRIP_TILE_MIN = 50
export const STRIP_CALENDAR_TILE = 56
export const STRIP_GAP = 6

/**
 * How many day tiles fit beside the calendar tile in a row of `width` px —
 * the strip never scrolls horizontally (a half-hidden tile read as an empty
 * gap), so it shows exactly what fits: 4 at 320px, 5 on most phones, up to 7.
 */
export function visibleDayCount(width: number, available: number): number {
  const fit = Math.floor((width - STRIP_CALENDAR_TILE) / (STRIP_TILE_MIN + STRIP_GAP))
  return Math.max(3, Math.min(available, 7, fit))
}
