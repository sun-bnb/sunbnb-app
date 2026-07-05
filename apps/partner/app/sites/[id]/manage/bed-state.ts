/**
 * Shared bed-state helpers for the manage page.
 *
 * Single source of truth — previously copy-pasted in Item.tsx, ParcelView.tsx,
 * view.tsx, and BedDetail.tsx. Import from here, never re-define locally.
 */

import { InventoryItem, Reservation } from '@/types/shared'
import {
  OP_EXPECTED, OP_CHECKED_IN, OP_WALKED_IN, OP_DEPARTED, OP_NO_SHOW, OP_COMP,
  RESERVATION_COMPLETE, RESERVATION_PAYMENT_FAILED, RESERVATION_PROCESSING,
} from '@repo/data/reservation-status'

export type BedState = 'available' | 'expected' | 'checked-in' | 'walked-in' | 'blocked' | 'comp'

/**
 * Returns true for reservation statuses that indicate a failed payment.
 * Covers both the canonical RESERVATION_PAYMENT_FAILED constant ('payment_failed')
 * and the legacy literal 'error' that older rows may carry in the database.
 */
export function isFailedReservationStatus(status: string): boolean {
  return status === RESERVATION_PAYMENT_FAILED || status === 'error'
}

/**
 * Resolve the effective operational status for a reservation.
 *
 * For blocked reservations the parent's operationalStatus is always used
 * (blocked is sticky; no per-day row exists for it — D5).
 *
 * For all other reservations: if a today-row is attached (`r.today`), that
 * row's operationalStatus is the source of truth. This is the core of the
 * double-sell fix: a parent `departed` on day-1 no longer hides a still-reserved
 * future day — day-2's row starts `expected` so the bed shows as reserved.
 */
function effectiveOpStatus(r: Reservation): string {
  if (r.operationalStatus === 'blocked') return 'blocked'
  return r.today?.operationalStatus ?? r.operationalStatus
}

/**
 * A departed/no-show booking only RELEASES the bed once its stay is over — i.e.
 * it has no remaining reserved days (`r.stayOver`, computed server-side). A
 * single-day or last-day departure is released (bed free); a multiday booking
 * departed mid-stay keeps holding the bed for its future days. (track 012)
 *
 * Keeps availability and the grid in lockstep: this is the same condition the
 * conflict guard / availability queries use, so "green" always means "bookable".
 */
function isReleased(r: Reservation): boolean {
  const eff = effectiveOpStatus(r)
  return (eff === OP_DEPARTED || eff === OP_NO_SHOW) && r.stayOver === true
}

/**
 * Returns the active reservation for a seat. A departed/no-show booking is only
 * dropped once its stay is over (released); mid-stay it is still the active hold.
 *
 * Prefers a non-failed reservation: if multiple candidates remain, the first
 * non-failed one is returned. A failed reservation is returned only when it is
 * the sole remaining candidate — this prevents a red ✕ from masking a real paid
 * booking if both somehow coexist on the same seat.
 */
export function getActiveReservation(item: InventoryItem): Reservation | null {
  if (!item.reservations?.length) return null
  const candidates = item.reservations.filter(r => !isReleased(r))
  if (candidates.length === 0) return null
  const nonFailed = candidates.find(r => !isFailedReservationStatus(r.status))
  return nonFailed ?? candidates[0]!
}

/**
 * Maps a seat's active reservation state to a BedState identifier.
 * Uses today's per-day operational status (via effectiveOpStatus) so multiday
 * bookings re-cycle daily rather than carrying stale day-1 state.
 */
export function getBedState(item: InventoryItem): BedState {
  const res = getActiveReservation(item)
  if (!res) return 'available'
  const opStatus = effectiveOpStatus(res)
  // A departed/no-show booking that survived getActiveReservation is NOT yet
  // released (multiday, future days remain) — it still holds the bed. Render it
  // as reserved ("expected"), never green: not bookable ⇒ not green. (track 012)
  if (opStatus === OP_DEPARTED || opStatus === OP_NO_SHOW) return 'expected'
  switch (opStatus) {
    case OP_EXPECTED: return 'expected'
    case OP_CHECKED_IN: return 'checked-in'
    case OP_WALKED_IN: return 'walked-in'
    case 'blocked': return 'blocked'
    case OP_COMP: return 'comp'
    default: return 'available'
  }
}

/**
 * Returns the payment-collection glyph for a reservation based on how money was collected.
 *
 * Precedence:
 *   1. Online / QR collected (status === RESERVATION_COMPLETE) → 'card' sentinel
 *      (consumers render this as a MUI CreditCardIcon; the string 'card' is never
 *      displayed as text)
 *   2. Cash settled (at least one non-voided TillEntry) → '€'
 *   3. Not yet collected (held / pending / unsettled cash walk-in) → '' (no glyph)
 */
function paymentGlyph(res: Reservation | null): string {
  if (!res) return ''
  if (res.status === RESERVATION_COMPLETE) return 'card'
  if ((res.tillEntries?.length ?? 0) > 0) return '€'
  return ''
}

/**
 * Returns the Tailwind CSS classes and icon string for a seat grid cell.
 *
 * The icon communicates HOW money was collected (not just whether the seat is booked):
 * - Failed payment (payment_failed / legacy 'error'): red ✕
 * - In-flight online payment (processing): R (fuchsia) ⏳ animate-pulse-slow
 * - Online / QR collected (complete): R or A colour 'card' sentinel (→ CreditCardIcon)
 * - Cash settled (non-voided TillEntry): R or A colour € (currency)
 * - Not yet collected (held / pending / unsettled walk-in): R or A colour, no glyph
 *
 * The '●' dot is removed entirely — it conveyed nothing actionable.
 * The ⏳ pulse is kept: it correctly signals a genuinely in-flight state.
 *
 * State colours mirror the staff grid legend — R reserved (fuchsia), A alquilada/
 * occupied (red), G comp (sky), available (green), blocked (gray).
 */
export function getCellAppearance(item: InventoryItem): { bg: string; icon: string } {
  const state = getBedState(item)

  if (state === 'expected') {
    const res = getActiveReservation(item)
    if (res) {
      if (isFailedReservationStatus(res.status)) {
        return { bg: 'bg-red-200 border-red-500 text-red-700', icon: '✕' }
      }
      // A genuinely in-flight online payment is the only transient case worth a pulse.
      if (res.status === RESERVATION_PROCESSING) {
        return { bg: 'bg-fuchsia-400 border-fuchsia-600 animate-pulse-slow', icon: '⏳' }
      }
    }
    // All other reserved states: use payment glyph (✓ / € / no glyph), no pulse.
    return { bg: 'bg-fuchsia-400 border-fuchsia-600', icon: paymentGlyph(res) }
  }

  // OCCUPIED (A — alquilada) — a present guest, online or offline. One colour
  // (red); collection method is shown by the payment glyph (✓ online, € cash, none unpaid).
  // Unifies the old checked-in and walked-in into one state.
  if (state === 'checked-in' || state === 'walked-in') {
    const res = getActiveReservation(item)
    return {
      bg: 'bg-red-400 border-red-600 text-white',
      icon: paymentGlyph(res),
    }
  }

  const stateStyles: Record<BedState, { bg: string; icon: string }> = {
    'available':  { bg: 'bg-green-300 border-green-500', icon: '' },
    'expected':   { bg: 'bg-fuchsia-400 border-fuchsia-600', icon: '' },
    'checked-in': { bg: 'bg-red-400 border-red-600 text-white', icon: '' },
    'walked-in':  { bg: 'bg-red-400 border-red-600 text-white', icon: '' },
    'blocked':    { bg: 'bg-gray-400 border-gray-600 text-white', icon: '✕' },
    'comp':       { bg: 'bg-sky-400 border-sky-600 text-white', icon: '' },
  }
  return stateStyles[state]
}
