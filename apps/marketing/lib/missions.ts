import type { BeachLayout, MockSunbed } from './beach-layout.ts'

/**
 * Pure helpers for the mockup page's missions (track 027 P9): which bed the "be your first guest"
 * hint points at, and which slice of the beach the "your morning" staff grid shows.
 */

export type Mission = 'guest' | 'staff' | 'live'
export const MISSIONS: readonly Mission[] = ['guest', 'staff', 'live']

/** The bed a first guest is nudged toward: front row, middle of the row — the bed everyone wants. */
export function hintBed(layout: BeachLayout): MockSunbed | null {
  const front = layout.sunbeds.filter((s) => s.row === 0)
  if (!front.length) return null
  return front[Math.floor((front.length - 1) / 2)] ?? null
}

/** Position along the row, from the label ("B12" → 12). */
function seat(label: string): number {
  return Number(label.replace(/^[A-Z]+/, ''))
}

/**
 * The staff grid's window: up to `size` beds of the guest's row, in seat order, containing the
 * guest's bed and starting on a pair boundary so pairs are never split.
 */
export function staffWindow(layout: BeachLayout, guestLabel: string, size = 10): MockSunbed[] {
  const guest = layout.sunbeds.find((s) => s.label === guestLabel)
  if (!guest) return []
  const row = layout.sunbeds.filter((s) => s.row === guest.row).sort((a, b) => seat(a.label) - seat(b.label))
  const even = Math.max(2, size - (size % 2))
  if (row.length <= even) return row
  const at = row.findIndex((s) => s.label === guestLabel)
  let start = Math.max(0, at - Math.floor(even / 2))
  start -= start % 2
  start = Math.min(start, Math.max(0, row.length - even))
  start -= start % 2
  return row.slice(start, start + even)
}

/**
 * Example bookings for the staff view: every third bed of the window, never the guest's own bed.
 * Deterministic so a reload looks the same; labelled as an example in the UI — not a claim.
 */
export function exampleBookings(window: readonly MockSunbed[], guestLabel: string): Set<string> {
  return new Set(window.filter((s, i) => i % 3 === 1 && s.label !== guestLabel).map((s) => s.label))
}
