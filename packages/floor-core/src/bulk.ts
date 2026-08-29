/**
 * Multiselect classification — the bulk verb matrix ([[track:024]] W4.1).
 *
 * Extracted verbatim from the web manage view (apps/partner/.../view.tsx) so
 * the partner grid and the mobile floor app share ONE opinion on which bulk
 * verbs a selection supports. The rules are load-bearing:
 *  - verbs are the INTERSECTION of every selected seat's valid actions;
 *  - only a single status group gets verbs (occupied = checked-in+walked-in,
 *    booked = reserved+cash-reserved);
 *  - Mollie-paid bookings are never bulk-canceled (no silent no-refund cancel);
 *  - Card (QR) needs the selection to collapse to exactly one reservation.
 */
import {
  RESERVATION_COMPLETE,
  RESERVATION_HELD,
  RESERVATION_PAID_IN_CASH,
} from '@repo/data/reservation-status'
import {
  getActiveReservation,
  getBedState,
  isFailedReservationStatus,
  selectionRefundTotal,
} from './bed-state'
import type { InventoryItem } from './types'

export type SeatKind =
  | 'available' | 'reserved' | 'cash-reserved' | 'held' | 'failed'
  | 'inflight' | 'checked-in' | 'walked-in' | 'comp' | 'blocked'

export function seatKind(item: InventoryItem): SeatKind {
  const st = getBedState(item)
  if (st !== 'expected') return st as SeatKind // available / checked-in / walked-in / blocked / comp
  const res = getActiveReservation(item)
  if (!res) return 'available'
  if (isFailedReservationStatus(res.status)) return 'failed'
  if (res.status === RESERVATION_HELD) return 'held'
  if (res.status === RESERVATION_COMPLETE) return 'reserved'
  // Cash-reserved: a calendar advance booking paid in cash, or a multiday
  // walk-in's between-days leg — AWAITING THE GUEST, not the payment provider.
  if (res.status === RESERVATION_PAID_IN_CASH) return 'cash-reserved'
  return 'inflight'
}

/** checked-in + walked-in collapse to "occupied", reserved + cash-reserved to "booked". */
export function statusGroup(k: SeatKind): string {
  return k === 'checked-in' || k === 'walked-in'
    ? 'occupied'
    : k === 'reserved' || k === 'cash-reserved'
      ? 'booked'
      : k
}

export interface SelectionVerbs {
  selItems: InventoryItem[]
  sameStatus: boolean
  /** Every seat free → the full create row. */
  allAvailable: boolean
  /** available/held mix, single status → name+period inputs and rent verbs. */
  canRent: boolean
  /** The one kind when the selection is homogeneous, else null (vacate button). */
  homogeneousKind: SeatKind | null
  /** Ids of the selected FREE seats (bulk create targets). */
  freeIds: string[]
  /** Distinct active reservation ids among selected HELD seats. */
  heldReservationIds: Set<string>
  /** Card (QR) offered — the rent collapses to exactly one reservation. */
  bulkCardEligible: boolean
  canCheckIn: boolean
  canDepart: boolean
  canNoShow: boolean
  canCancel: boolean
  /** Cancel states matched but a Mollie-paid booking blocks bulk cancel. */
  cancelBlockedByPaid: boolean
  canMove: boolean
  /** walked-in + cash-reserved family — cash release / unconditional refund. */
  canCashRelease: boolean
  /** Summed refund a bulk Unreserve would trigger (settled parties only). */
  refundTotal: number
}

export function classifySelection(
  allItems: InventoryItem[],
  selectedIds: string[],
): SelectionVerbs {
  const selItems = allItems.filter(i => selectedIds.includes(i.id))
  const kinds = selItems.map(seatKind)
  const can = (states: SeatKind[]) =>
    selItems.length > 0 && kinds.every(k => states.includes(k))

  const sameStatus =
    selItems.length > 0 && new Set(kinds.map(statusGroup)).size === 1
  const allAvailable = can(['available'])
  const canRent = can(['available', 'held']) && sameStatus
  const selKinds = new Set(kinds)
  const homogeneousKind = selKinds.size === 1 ? [...selKinds][0]! : null

  const freeIds = selItems.filter(i => seatKind(i) === 'available').map(i => i.id)
  const heldReservationIds = new Set(
    selItems
      .filter(i => seatKind(i) === 'held')
      .map(i => getActiveReservation(i)?.id)
      .filter((id): id is string => !!id),
  )
  const bulkCardEligible = (freeIds.length > 0 ? 1 : 0) + heldReservationIds.size === 1

  const canCheckIn = can(['reserved', 'cash-reserved'])
  const canDepart = can(['checked-in', 'walked-in']) && sameStatus
  const canNoShow = can(['reserved'])
  const canCancelStates = can(['reserved', 'checked-in']) && sameStatus
  const hasMolliePaid = selItems.some(i => {
    const r = getActiveReservation(i)
    return !!r?.paymentRef && r.paymentRef.startsWith('tr_')
  })
  const canCancel = canCancelStates && !hasMolliePaid
  const cancelBlockedByPaid = canCancelStates && hasMolliePaid
  const canMove =
    can(['reserved', 'cash-reserved', 'held', 'checked-in', 'walked-in']) && sameStatus
  const canCashRelease = can(['walked-in', 'cash-reserved'])
  const refundTotal = canCashRelease ? selectionRefundTotal(allItems, selectedIds) : 0

  return {
    selItems, sameStatus, allAvailable, canRent, homogeneousKind,
    freeIds, heldReservationIds, bulkCardEligible,
    canCheckIn, canDepart, canNoShow, canCancel, cancelBlockedByPaid,
    canMove, canCashRelease, refundTotal,
  }
}

export interface SelectionGroup {
  anyItemId: string
  selectedItemIds: string[]
  /** True when the selection covers only PART of the reservation's seats. */
  isSubset: boolean
}

/**
 * Group the selection by distinct active reservation — drives subset-aware
 * bulk verbs (split-then-depart, per-group convert). Total seat counts come
 * from ALL items, not just the selection.
 */
export function getSelectionGroups(
  allItems: InventoryItem[],
  selectedIds: string[],
): Map<string, SelectionGroup> {
  const selItems = allItems.filter(i => selectedIds.includes(i.id))
  const totalSeatsByRes = new Map<string, number>()
  for (const item of allItems) {
    const res = getActiveReservation(item)
    if (!res) continue
    totalSeatsByRes.set(res.id, (totalSeatsByRes.get(res.id) ?? 0) + 1)
  }
  const groups = new Map<string, SelectionGroup>()
  for (const i of selItems) {
    const res = getActiveReservation(i)
    if (!res) continue
    const existing = groups.get(res.id)
    if (existing) {
      existing.selectedItemIds.push(i.id)
      existing.isSubset =
        existing.selectedItemIds.length < (totalSeatsByRes.get(res.id) ?? existing.selectedItemIds.length)
    } else {
      groups.set(res.id, {
        anyItemId: i.id,
        selectedItemIds: [i.id],
        isSubset: 1 < (totalSeatsByRes.get(res.id) ?? 1),
      })
    }
  }
  return groups
}
