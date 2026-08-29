import { describe, it, expect } from 'vitest'
import {
  OP_EXPECTED, OP_CHECKED_IN, OP_WALKED_IN, OP_COMP,
  RESERVATION_COMPLETE, RESERVATION_PAYMENT_FAILED, RESERVATION_HELD,
} from '@repo/data/reservation-status'
import { seatKind, statusGroup, classifySelection, getSelectionGroups } from './bulk'
import type { InventoryItem } from './types'

// ── Fixtures ────────────────────────────────────────────────────────────────
let n = 0
type ResSpec = {
  id?: string
  operationalStatus: string
  status?: string
  isComp?: boolean
  paymentRef?: string | null
  tillEntries?: { id: string; amount: number }[]
}
const mk = (reservations: ResSpec[] = []): InventoryItem => {
  n++
  return {
    id: `i${n}`,
    number: n,
    reservations: reservations.map((r, i) => ({ id: r.id ?? `r${n}-${i}`, status: 'paid-in-cash', ...r })),
  } as unknown as InventoryItem
}
const free = () => mk()
const reserved = (paymentRef?: string) =>
  mk([{ operationalStatus: OP_EXPECTED, status: RESERVATION_COMPLETE, paymentRef }])
const cashReserved = (id?: string) => mk([{ id, operationalStatus: OP_EXPECTED, status: 'paid-in-cash' }])
const held = (id?: string) => mk([{ id, operationalStatus: OP_EXPECTED, status: RESERVATION_HELD }])
const failed = () => mk([{ operationalStatus: OP_EXPECTED, status: RESERVATION_PAYMENT_FAILED }])
const inflight = () => mk([{ operationalStatus: OP_EXPECTED, status: 'processing' }])
const checkedIn = () => mk([{ operationalStatus: OP_CHECKED_IN, status: RESERVATION_COMPLETE }])
const walkedIn = (id?: string, tillEntries?: { id: string; amount: number }[]) =>
  mk([{ id, operationalStatus: OP_WALKED_IN, status: 'paid-in-cash', tillEntries }])
const comp = () => mk([{ operationalStatus: OP_COMP, isComp: true }])
const blocked = () => mk([{ operationalStatus: 'blocked' }])

const ids = (...items: InventoryItem[]) => items.map(i => i.id)

// ── seatKind ────────────────────────────────────────────────────────────────
describe('seatKind', () => {
  it('classifies every kind', () => {
    expect(seatKind(free())).toBe('available')
    expect(seatKind(reserved())).toBe('reserved')
    expect(seatKind(cashReserved())).toBe('cash-reserved')
    expect(seatKind(held())).toBe('held')
    expect(seatKind(failed())).toBe('failed')
    expect(seatKind(inflight())).toBe('inflight')
    expect(seatKind(checkedIn())).toBe('checked-in')
    expect(seatKind(walkedIn())).toBe('walked-in')
    expect(seatKind(comp())).toBe('comp')
    expect(seatKind(blocked())).toBe('blocked')
  })
})

describe('statusGroup', () => {
  it('collapses occupied and booked pairs', () => {
    expect(statusGroup('checked-in')).toBe('occupied')
    expect(statusGroup('walked-in')).toBe('occupied')
    expect(statusGroup('reserved')).toBe('booked')
    expect(statusGroup('cash-reserved')).toBe('booked')
    expect(statusGroup('held')).toBe('held')
  })
})

// ── classifySelection ───────────────────────────────────────────────────────
describe('classifySelection', () => {
  it('all-available selection gets the create row and single-QR card', () => {
    const a = free(), b = free()
    const v = classifySelection([a, b], ids(a, b))
    expect(v.allAvailable).toBe(true)
    expect(v.canRent).toBe(true)
    expect(v.bulkCardEligible).toBe(true) // one grouped booking → one QR
    expect(v.canCheckIn).toBe(false)
    expect(v.canCashRelease).toBe(false)
  })

  it('a mixed-status selection gets no verbs', () => {
    const a = blocked(), b = checkedIn()
    const v = classifySelection([a, b], ids(a, b))
    expect(v.sameStatus).toBe(false)
    expect(v.allAvailable).toBe(false)
    expect(v.canDepart).toBe(false)
    expect(v.homogeneousKind).toBeNull()
  })

  it('reserved-only selection: check-in, no-show, cancel, move', () => {
    const a = reserved(), b = reserved()
    const v = classifySelection([a, b], ids(a, b))
    expect(v.canCheckIn).toBe(true)
    expect(v.canNoShow).toBe(true)
    expect(v.canCancel).toBe(true)
    expect(v.canMove).toBe(true)
    expect(v.canDepart).toBe(false)
  })

  it('a Mollie-paid booking blocks bulk cancel', () => {
    const a = reserved(), b = reserved('tr_abc123')
    const v = classifySelection([a, b], ids(a, b))
    expect(v.canCancel).toBe(false)
    expect(v.cancelBlockedByPaid).toBe(true)
  })

  it('reserved + checked-in is one occupied/booked mix — no cancel lane', () => {
    const a = reserved(), b = checkedIn()
    const v = classifySelection([a, b], ids(a, b))
    // different status groups → sameStatus false → canCancel false
    expect(v.sameStatus).toBe(false)
    expect(v.canCancel).toBe(false)
  })

  it('walked-in + cash-reserved is the cash-release family, across parties', () => {
    const a = walkedIn('resA', [{ id: 't1', amount: 30 }])
    const b = cashReserved('resB')
    const v = classifySelection([a, b], ids(a, b))
    expect(v.canCashRelease).toBe(true)
    expect(v.refundTotal).toBe(30) // only the settled party refunds
    expect(v.sameStatus).toBe(false) // occupied + booked
    expect(v.canDepart).toBe(false)
  })

  it('card eligibility collapses to exactly one reservation', () => {
    const h1 = held('hold-1'), h2 = held('hold-2'), f = free()
    // one hold → eligible
    expect(classifySelection([h1], ids(h1)).bulkCardEligible).toBe(true)
    // two distinct holds → not eligible
    expect(classifySelection([h1, h2], ids(h1, h2)).bulkCardEligible).toBe(false)
    // free seats + a hold → two reservations → not eligible
    expect(classifySelection([f, h1], ids(f, h1)).bulkCardEligible).toBe(false)
  })

  it('homogeneousKind drives the vacate button', () => {
    const a = held('h'), b = held('h')
    expect(classifySelection([a, b], ids(a, b)).homogeneousKind).toBe('held')
    const c = blocked()
    expect(classifySelection([a, c], ids(a, c)).homogeneousKind).toBeNull()
  })
})

// ── getSelectionGroups ──────────────────────────────────────────────────────
describe('getSelectionGroups', () => {
  it('flags a partial selection of a multi-seat reservation as a subset', () => {
    const a = walkedIn('party')
    const b = walkedIn('party')
    const groups = getSelectionGroups([a, b], [a.id])
    const g = groups.get('party')!
    expect(g.selectedItemIds).toEqual([a.id])
    expect(g.isSubset).toBe(true)
  })
  it('whole-party selection is not a subset', () => {
    const a = walkedIn('party2')
    const b = walkedIn('party2')
    const groups = getSelectionGroups([a, b], [a.id, b.id])
    expect(groups.get('party2')!.isSubset).toBe(false)
  })
  it('ignores free seats', () => {
    const a = free()
    expect(getSelectionGroups([a], [a.id]).size).toBe(0)
  })
})
