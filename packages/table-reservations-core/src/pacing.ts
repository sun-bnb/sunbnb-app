// Pure pacing helpers — no DB. Pacing caps the covers (summed party size) that
// may *start* within a fixed time window, so the kitchen/host aren't overwhelmed
// by too many simultaneous arrivals. Buckets are aligned to the epoch, so a
// 15-minute window coincides with clock :00/:15/:30/:45 marks.

export interface CoverStart {
  fromMs: number
  partySize: number
}

/** Start (ms) of the pacing window containing `slotMs`. */
export function pacingWindowStartMs(slotMs: number, windowMinutes: number): number {
  const w = windowMinutes * 60 * 1000
  return Math.floor(slotMs / w) * w
}

/** Summed party size of starts falling in [windowStartMs, windowStartMs + window). */
export function coversStartingInWindow(
  items: CoverStart[],
  windowStartMs: number,
  windowMinutes: number,
): number {
  const end = windowStartMs + windowMinutes * 60 * 1000
  let sum = 0
  for (const it of items) {
    if (it.fromMs >= windowStartMs && it.fromMs < end) sum += it.partySize
  }
  return sum
}

/**
 * True if seating `partySize` into a window already holding `existingCovers`
 * would exceed `pacingCovers`. Null/undefined cap = unlimited (never exceeds).
 * Reaching the cap exactly is allowed; only going over is blocked.
 */
export function wouldExceedPacing(
  existingCovers: number,
  partySize: number,
  pacingCovers: number | null | undefined,
): boolean {
  if (pacingCovers == null) return false
  return existingCovers + partySize > pacingCovers
}
