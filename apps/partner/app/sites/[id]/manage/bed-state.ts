/**
 * Shared bed-state helpers for the manage page.
 *
 * Single source of truth — previously copy-pasted in Item.tsx, ParcelView.tsx,
 * view.tsx, and BedDetail.tsx. Import from here, never re-define locally.
 */

import { InventoryItem, Reservation } from '@/types/shared'
import {
  OP_EXPECTED, OP_CHECKED_IN, OP_WALKED_IN, OP_DEPARTED, OP_NO_SHOW, OP_COMP,
  RESERVATION_COMPLETE, RESERVATION_PAYMENT_FAILED,
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
 * Returns the active reservation for a seat, filtering out departed / no-show ones.
 *
 * Prefers a non-failed reservation: if multiple candidates remain, the first
 * non-failed one is returned. A failed reservation is returned only when it is
 * the sole remaining candidate — this prevents a red ✕ from masking a real paid
 * booking if both somehow coexist on the same seat.
 */
export function getActiveReservation(item: InventoryItem): Reservation | null {
  if (!item.reservations?.length) return null
  const candidates = item.reservations.filter(r =>
    !([OP_DEPARTED, OP_NO_SHOW] as string[]).includes(r.operationalStatus)
  )
  if (candidates.length === 0) return null
  const nonFailed = candidates.find(r => !isFailedReservationStatus(r.status))
  return nonFailed ?? candidates[0]!
}

/**
 * Maps a seat's active reservation state to a BedState identifier.
 */
export function getBedState(item: InventoryItem): BedState {
  const res = getActiveReservation(item)
  if (!res) return 'available'
  switch (res.operationalStatus) {
    case OP_EXPECTED: return 'expected'
    case OP_CHECKED_IN: return 'checked-in'
    case OP_WALKED_IN: return 'walked-in'
    case 'blocked': return 'blocked'
    case OP_COMP: return 'comp'
    default: return 'available'
  }
}

/**
 * Returns the Tailwind CSS classes and icon string for a seat grid cell.
 *
 * Within the 'expected' state the appearance branches on the active reservation's
 * payment status:
 * - Failed payment (payment_failed / legacy 'error'): red ✕, no blink
 * - Paid online (complete): yellow €, NO animate-pulse-slow
 * - Held / pending / processing: yellow ⏳ + animate-pulse-slow (unchanged)
 *
 * All other states use fixed colors (unchanged from before).
 */
export function getCellAppearance(item: InventoryItem): { bg: string; icon: string } {
  const state = getBedState(item)

  if (state === 'expected') {
    const res = getActiveReservation(item)
    if (res) {
      if (isFailedReservationStatus(res.status)) {
        return { bg: 'bg-red-200 border-red-500 text-red-700', icon: '✕' }
      }
      if (res.status === RESERVATION_COMPLETE) {
        // Paid booking — solid yellow, no pulse (guest has paid, no urgency)
        return { bg: 'bg-yellow-300 border-yellow-500', icon: '€' }
      }
    }
    // Held / pending / processing — pulse to indicate in-flight state
    return { bg: 'bg-yellow-300 border-yellow-500 animate-pulse-slow', icon: '⏳' }
  }

  const stateStyles: Record<BedState, { bg: string; icon: string }> = {
    'available':  { bg: 'bg-green-300 border-green-500', icon: '' },
    'expected':   { bg: 'bg-yellow-300 border-yellow-500 animate-pulse-slow', icon: '⏳' },
    'checked-in': { bg: 'bg-blue-400 border-blue-600 text-white', icon: '✓' },
    'walked-in':  { bg: 'bg-orange-400 border-orange-600 text-white', icon: '●' },
    'blocked':    { bg: 'bg-gray-400 border-gray-600 text-white', icon: '✕' },
    'comp':       { bg: 'bg-purple-300 border-purple-500', icon: '★' },
  }
  return stateStyles[state]
}
