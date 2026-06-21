import { describe, it, expect } from 'vitest'
import {
  isFailedReservationStatus,
  getActiveReservation,
  getBedState,
  getCellAppearance,
} from './bed-state'
import {
  OP_EXPECTED, OP_CHECKED_IN, OP_WALKED_IN, OP_DEPARTED, OP_NO_SHOW, OP_COMP,
  RESERVATION_COMPLETE, RESERVATION_PAYMENT_FAILED, RESERVATION_HELD,
} from '@repo/data/reservation-status'

// Minimal InventoryItem-shaped factory — bed-state only reads `reservations`,
// and within each reservation only `operationalStatus`, `status`, `today`, `stayOver`.
const item = (reservations: Array<{ operationalStatus: string; status?: string; today?: any; stayOver?: boolean }>) =>
  ({ reservations }) as any
// `stayOver` = the booking's stay is over (no remaining reserved days). A
// departed/no-show booking only releases its bed when stayOver is true.
const res = (operationalStatus: string, status = 'paid-in-cash', today?: any, stayOver?: boolean) =>
  ({ operationalStatus, status, today, stayOver })

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
  it('filters out departed / no-show reservations whose stay is over (released)', () => {
    expect(getActiveReservation(item([
      res(OP_DEPARTED, undefined, undefined, true),
      res(OP_NO_SHOW, undefined, undefined, true),
    ]))).toBeNull()
  })
  it('returns the live reservation, ignoring a released departed one on the same seat', () => {
    const active = getActiveReservation(item([res(OP_DEPARTED, undefined, undefined, true), res(OP_CHECKED_IN)]))
    expect(active?.operationalStatus).toBe(OP_CHECKED_IN)
  })

  // ── Stay-over rule (track 012): departed/no-show only releases when stay is over ──
  it('keeps a departed booking whose stay is NOT over (multiday, future days) as active', () => {
    // departedAt today but to is in the future → stayOver=false → still held.
    const active = getActiveReservation(item([res(OP_DEPARTED, undefined, undefined, false)]))
    expect(active?.operationalStatus).toBe(OP_DEPARTED)
  })
  it('a mid-stay departed bed renders as reserved (expected), never available/green', () => {
    expect(getBedState(item([res(OP_DEPARTED, undefined, undefined, false)]))).toBe('expected')
  })
  it('a released (stay-over) departed bed renders as available/green', () => {
    expect(getBedState(item([res(OP_DEPARTED, undefined, undefined, true)]))).toBe('available')
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

  // ── Per-day today-row precedence (P1) ──────────────────────────────────────
  it('reads today-row status when present (double-sell fix): parent departed but today expected → still active', () => {
    // The core multiday fix: parent says departed (day-1) but today's row says expected (day-2).
    // effectiveOpStatus reads today.operationalStatus → bed stays reserved.
    const todayRow = { id: 'rd-2', reservationId: 'r1', date: new Date(), operationalStatus: OP_EXPECTED, checkedInAt: null, departedAt: null }
    const active = getActiveReservation(item([res(OP_DEPARTED, RESERVATION_COMPLETE, todayRow)]))
    expect(active).not.toBeNull()
    expect(active?.today?.operationalStatus).toBe(OP_EXPECTED)
  })

  it('blocked reservation always reads parent status (sticky — no today row bypass)', () => {
    // A blocked reservation with a today row should still read the parent 'blocked' status.
    // effectiveOpStatus returns 'blocked' regardless of any today row.
    const todayRow = { id: 'rd-1', reservationId: 'r1', date: new Date(), operationalStatus: OP_EXPECTED, checkedInAt: null, departedAt: null }
    // blocked + today(expected): effectiveOpStatus = 'blocked' (not expected)
    const active = getActiveReservation(item([res('blocked', 'paid-in-cash', todayRow)]))
    // Blocked is NOT in [OP_DEPARTED, OP_NO_SHOW], so it's still returned as active
    expect(active).not.toBeNull()
    expect(active?.operationalStatus).toBe('blocked')
  })

  it('parent no-show + today expected → active (D4: no-show non-propagating, day-2 re-cycles)', () => {
    // D4: a no-show on day-1 does NOT propagate to day-2.
    // Day-2's row starts 'expected' → getActiveReservation must return it.
    const todayRow = { id: 'rd-2', reservationId: 'r1', date: new Date(), operationalStatus: OP_EXPECTED, checkedInAt: null, departedAt: null }
    const active = getActiveReservation(item([res(OP_NO_SHOW, RESERVATION_COMPLETE, todayRow)]))
    expect(active).not.toBeNull()
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

  // ── Per-day today-row (P1) ─────────────────────────────────────────────────
  it('uses today-row status over parent status (multiday recycle)', () => {
    // Parent says checked-in (day-1 stale), but today row says expected (day-2 fresh).
    // getBedState must reflect the today row.
    const todayRow = { id: 'rd-2', reservationId: 'r1', date: new Date(), operationalStatus: OP_EXPECTED, checkedInAt: null, departedAt: null }
    expect(getBedState(item([res(OP_CHECKED_IN, 'complete', todayRow)]))).toBe('expected')
  })

  it('blocked reservation derives state from parent only (no today-row bypass)', () => {
    // Even with a today row showing 'expected', a blocked reservation stays 'blocked'.
    const todayRow = { id: 'rd-1', reservationId: 'r1', date: new Date(), operationalStatus: OP_EXPECTED, checkedInAt: null, departedAt: null }
    expect(getBedState(item([res('blocked', 'paid-in-cash', todayRow)]))).toBe('blocked')
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
    it('held → calm yellow ● (filled circle), no pulse', () => {
      const a = getCellAppearance(item([res(OP_EXPECTED, RESERVATION_HELD)]))
      expect(a.icon).toBe('●')
      expect(a.bg).toContain('bg-yellow-300')
      expect(a.bg).not.toContain('animate-pulse')
    })

    it('paid-in-cash / pending reserved → calm yellow ● (no pulse, no hourglass)', () => {
      for (const status of ['paid-in-cash', 'pending']) {
        const a = getCellAppearance(item([res(OP_EXPECTED, status)]))
        expect(a.icon).toBe('●')
        expect(a.bg).toContain('bg-yellow-300')
        expect(a.bg).not.toContain('animate-pulse')
      }
    })
    it('only a genuinely in-flight online payment (processing) → yellow ⏳ with pulse', () => {
      const a = getCellAppearance(item([res(OP_EXPECTED, 'processing')]))
      expect(a.icon).toBe('⏳')
      expect(a.bg).toContain('animate-pulse-slow')
    })
  })
})
