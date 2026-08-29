/**
 * Shared bed-state helpers for the manage page.
 *
 * Single source of truth for GRID PRESENTATION — previously copy-pasted in
 * Item.tsx, ParcelView.tsx, view.tsx, and BedDetail.tsx. Import from here,
 * never re-define locally.
 *
 * Since track 018 P4 this module is a PRESENTATION SHELL over the machine's
 * `deriveState` (@repo/data/reservation-machine — client-safe, no prisma):
 * the compound state (kind × pay × occ × released) is derived exactly the way
 * the interpreter's guards derive it, then mapped to grid vocabulary
 * (BedState + payment glyph). No state logic lives here — determinism
 * contract #1: one derivation, every consumer.
 */

import { InventoryItem, Reservation } from './types'
import {
  deriveState,
  partitionAmount,
  type CompoundState,
} from '@repo/data/reservation-machine'
import { RESERVATION_PROCESSING } from '@repo/data/reservation-status'

export type BedState = 'available' | 'expected' | 'checked-in' | 'walked-in' | 'blocked' | 'comp'

/**
 * Returns true for reservation statuses that indicate a failed payment.
 * Covers both the canonical RESERVATION_PAYMENT_FAILED constant ('payment_failed')
 * and the legacy literal 'error' that older rows may carry in the database.
 */
export function isFailedReservationStatus(status: string): boolean {
  return status === 'payment_failed' || status === 'error'
}

/** THE derivation, from the grid's loaded shape (today-row + non-voided tillEntries). */
function derive(r: Reservation): CompoundState {
  return deriveState({
    status: r.status,
    operationalStatus: r.operationalStatus,
    todayOperationalStatus: r.today?.operationalStatus ?? null,
    isComp: r.isComp,
    settled: (r.tillEntries?.length ?? 0) > 0,
    stayOver: r.stayOver,
  })
}

/**
 * A departed/no-show booking only RELEASES the bed once its stay is over —
 * machine release rule (I6): released ⇔ (departed | no-show) ∧ stayOver.
 * Keeps availability and the grid in lockstep. (track 012 / track 018)
 */
function isReleased(r: Reservation): boolean {
  return derive(r).released
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
 * Maps a seat's active reservation to a BedState identifier — the machine's
 * (kind, occ) projected onto the grid vocabulary. Multiday bookings re-cycle
 * daily via the today-row (inside deriveState).
 */
export function getBedState(item: InventoryItem): BedState {
  const res = getActiveReservation(item)
  if (!res) return 'available'
  const s = derive(res)
  if (s.kind === 'block') return 'blocked'
  if (s.kind === 'comp') return 'comp'
  // A departed/no-show booking that survived getActiveReservation is NOT yet
  // released (multiday, future days remain) — it still holds the bed. Render it
  // as reserved ("expected"), never green: not bookable ⇒ not green. (track 012)
  switch (s.occ) {
    case 'present': return s.kind === 'walkin' ? 'walked-in' : 'checked-in'
    case 'expected': case 'departed': case 'no-show': return 'expected'
    default: return 'available'
  }
}

/**
 * Payment-collection glyph — the machine's pay-phase projected to the grid:
 *   collected / complete (online or QR) → 'card' sentinel (CreditCardIcon)
 *   settled (≥1 non-voided TillEntry)  → '€'
 *   anything else                       → '' (no glyph)
 */
function paymentGlyph(res: Reservation | null): string {
  if (!res) return ''
  const pay = derive(res).pay
  if (pay === 'complete' || pay === 'collected') return 'card'
  if (pay === 'settled') return '€'
  return ''
}

// ─── Track 018 slice-3 helpers (pure, unit-tested in bed-state.test.ts) ──────


/**
 * The freed seat's share of a settled party's cash — what a Seat-mode
 * Unreserve will actually void + credit-note (machine tillPartition, I1).
 * Partitioned from the NON-VOIDED till total by seat-price weights (equal
 * split when prices are unknown), mirroring the interpreter's partition —
 * so the confirm dialog shows the truth, not the whole paymentAmount (B2).
 */
export function freedSeatShare(reservation: Reservation, freedItemId: string): number {
  const total = (reservation.tillEntries ?? []).reduce((s, e) => s + e.amount, 0)
  const items = reservation.items ?? []
  if (total <= 0 || items.length < 2) return total
  const weight = (arr: { price?: number | null }[]) =>
    arr.reduce((s, i) => s + ((i.price ?? null) || 0), 0)
  const rest = items.filter((i) => i.id !== freedItemId)
  const freed = items.filter((i) => i.id === freedItemId)
  const [, share] = partitionAmount(total, [weight(rest), weight(freed)]) as [number, number]
  return share
}

/** Sum of the party's non-voided till entries — what a whole Unreserve refunds. */
export function settledTotal(reservation: Reservation | null): number {
  return (reservation?.tillEntries ?? []).reduce((s, e) => s + e.amount, 0)
}


/**
 * Summed refund a bulk Unreserve of `selectedIds` would trigger — the label/
 * confirm source for the multiselect sheet ("Refund" vs "Unreserve", track 018).
 * Per distinct settled reservation in the selection: full `settledTotal` when
 * ALL its seats are selected, else the selected seats' partitioned share (one
 * grouped partition per reservation — matches the machine's per-seat partition
 * sum to the cent). Unsettled parties contribute 0.
 */
export function selectionRefundTotal(items: InventoryItem[], selectedIds: string[]): number {
  const selected = new Set(selectedIds)
  const byRes = new Map<string, { r: Reservation; ids: string[] }>()
  for (const item of items) {
    if (!selected.has(item.id)) continue
    const r = getActiveReservation(item)
    if (!r) continue
    const e = byRes.get(r.id) ?? { r, ids: [] }
    e.ids.push(item.id)
    byRes.set(r.id, e)
  }
  let total = 0
  for (const { r, ids } of byRes.values()) {
    const st = settledTotal(r)
    if (st <= 0) continue
    const seats = r.items ?? []
    if (seats.length === 0 || ids.length >= seats.length) { total += st; continue }
    const weight = (arr: { price?: number | null }[]) =>
      arr.reduce((s, i) => s + ((i.price ?? null) || 0), 0)
    const sel = seats.filter((s) => ids.includes(s.id))
    const rest = seats.filter((s) => !ids.includes(s.id))
    const [, share] = partitionAmount(st, [weight(rest), weight(sel)]) as [number, number]
    total += share
  }
  return Math.round(total * 100) / 100
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
    // All other reserved states: use payment glyph (card / € / no glyph), no pulse.
    return { bg: 'bg-fuchsia-400 border-fuchsia-600', icon: paymentGlyph(res) }
  }

  // OCCUPIED (A — alquilada) — a present guest, online or offline. One colour
  // (red); collection method is shown by the payment glyph (card online, € cash, none unpaid).
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
