import { describe, it, expect } from 'vitest'
import {
  isFailedReservationStatus,
  getActiveReservation,
  getBedState,
  getCellAppearance,
} from './bed-state'
import {
  OP_EXPECTED, OP_CHECKED_IN, OP_WALKED_IN, OP_DEPARTED, OP_NO_SHOW, OP_COMP,
  RESERVATION_COMPLETE, RESERVATION_PAYMENT_FAILED,
} from '@repo/data/reservation-status'

// Minimal InventoryItem-shaped factory — bed-state only reads `reservations`,
// and within each reservation only `operationalStatus` and `status`.
const item = (reservations: Array<{ operationalStatus: string; status?: string }>) =>
  ({ reservations }) as any
const res = (operationalStatus: string, status = 'paid-in-cash') => ({ operationalStatus, status })

describe('isFailedReservationStatus', () => {
  it('is true for the canonical payment_failed constant', () => {
    expect(isFailedReservationStatus(RESERVATION_PAYMENT_FAILED)).toBe(true)
  })
  it("is true for the legacy 'error' literal", () => {
    expect(isFailedReservationStatus('error')).toBe(true)
  })
  it('is false for normal statuses', () => {
    expect(isFailedReservationStatus(RESERVATION_COMPLETE)).toBe(false)
    expect(isFailedReservationStatus('paid-in-cash')).toBe(false)
    expect(isFailedReservationStatus('pending')).toBe(false)
  })
})

describe('getActiveReservation', () => {
  it('returns null when there are no reservations', () => {
    expect(getActiveReservation(item([]))).toBeNull()
  })
  it('filters out departed / no-show reservations', () => {
    expect(getActiveReservation(item([res(OP_DEPARTED), res(OP_NO_SHOW)]))).toBeNull()
  })
  it('returns the live reservation, ignoring a departed one on the same seat', () => {
    const active = getActiveReservation(item([res(OP_DEPARTED), res(OP_CHECKED_IN)]))
    expect(active?.operationalStatus).toBe(OP_CHECKED_IN)
  })
  it('prefers a non-failed reservation when both a failed and a paid one coexist', () => {
    const active = getActiveReservation(item([
      res(OP_EXPECTED, RESERVATION_PAYMENT_FAILED),
      res(OP_CHECKED_IN, RESERVATION_COMPLETE),
    ]))
    expect(active?.status).toBe(RESERVATION_COMPLETE)
  })
  it('returns a failed reservation only when it is the sole candidate', () => {
    const active = getActiveReservation(item([res(OP_EXPECTED, RESERVATION_PAYMENT_FAILED)]))
    expect(active?.status).toBe(RESERVATION_PAYMENT_FAILED)
  })
})

describe('getBedState', () => {
  it('maps an empty seat to available', () => {
    expect(getBedState(item([]))).toBe('available')
  })
  it('maps each operational status to its BedState', () => {
    expect(getBedState(item([res(OP_EXPECTED)]))).toBe('expected')
    expect(getBedState(item([res(OP_CHECKED_IN)]))).toBe('checked-in')
    expect(getBedState(item([res(OP_WALKED_IN)]))).toBe('walked-in')
    expect(getBedState(item([res('blocked')]))).toBe('blocked')
  })
  it('maps a complimentary reservation (OP_COMP) to comp', () => {
    // Regression guard: comp seats were rendering as available (green) because
    // the per-component color maps omitted this case before bed-state centralized it.
    expect(getBedState(item([res(OP_COMP)]))).toBe('comp')
  })
  it('falls back to available for an unknown operational status', () => {
    expect(getBedState(item([res('something-else')]))).toBe('available')
  })
})

describe('getCellAppearance', () => {
  it('renders a comp seat as purple with a star', () => {
    // The reported bug: comp not reflected in the main-grid seat color.
    const { bg, icon } = getCellAppearance(item([res(OP_COMP)]))
    expect(bg).toContain('bg-purple-300')
    expect(icon).toBe('★')
  })

  it('renders the fixed-color states', () => {
    expect(getCellAppearance(item([])).bg).toContain('bg-green-300')              // available
    expect(getCellAppearance(item([res(OP_CHECKED_IN)])).bg).toContain('bg-blue-400')
    expect(getCellAppearance(item([res(OP_WALKED_IN)])).bg).toContain('bg-orange-400')
    expect(getCellAppearance(item([res('blocked')])).bg).toContain('bg-gray-400')
  })

  describe('expected-state payment branches', () => {
    it('failed payment → red ✕, no pulse', () => {
      const a = getCellAppearance(item([res(OP_EXPECTED, RESERVATION_PAYMENT_FAILED)]))
      expect(a.bg).toContain('bg-red-200')
      expect(a.icon).toBe('✕')
      expect(a.bg).not.toContain('animate-pulse')
    })
    it('paid online (complete) → solid yellow €, no pulse', () => {
      const a = getCellAppearance(item([res(OP_EXPECTED, RESERVATION_COMPLETE)]))
      expect(a.bg).toContain('bg-yellow-300')
      expect(a.icon).toBe('€')
      expect(a.bg).not.toContain('animate-pulse')
    })
    it('held / pending → yellow ⏳ with pulse', () => {
      const a = getCellAppearance(item([res(OP_EXPECTED, 'pending')]))
      expect(a.icon).toBe('⏳')
      expect(a.bg).toContain('animate-pulse-slow')
    })
  })
})
