/**
 * Pure time-slot logic for hourly equipment rental (the Start / Duration
 * steppers). Whole hours only, inside the venue's opening hours for the day.
 */

export interface HourBounds {
  /** First bookable start hour (inclusive). */
  minStart: number
  /** Closing hour — a booking must END by it. */
  closeHour: number
}

/**
 * Bounds for a day: opening hour → closing hour, except that today cannot
 * start in the past — the earliest start is the next full hour.
 * `null` when nothing is bookable (today after the last start).
 */
export function hourBounds(openHour: number, closeHour: number, isToday: boolean, nowHour: number): HourBounds | null {
  const minStart = isToday ? Math.max(openHour, nowHour + 1) : openHour
  return minStart < closeHour ? { minStart, closeHour } : null
}

/**
 * Clamp a wished-for slot into the bounds: start within [minStart, close − 1],
 * duration within [1, close − start]. The default wish is "first start, 2 h".
 */
export function clampSlot(
  bounds: HourBounds,
  wish: { start?: number; duration?: number } = {},
): { start: number; duration: number } {
  const start = Math.min(Math.max(wish.start ?? bounds.minStart, bounds.minStart), bounds.closeHour - 1)
  const duration = Math.min(Math.max(wish.duration ?? 2, 1), bounds.closeHour - start)
  return { start, duration }
}

/** `10` → `"10:00"`. */
export function fmtHour(h: number): string {
  return `${String(h).padStart(2, '0')}:00`
}
