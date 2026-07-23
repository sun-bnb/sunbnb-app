import { vi } from 'vitest'

/**
 * Unit-test mock for @repo/data/till.
 *
 * The real helpers query Postgres (open-till sum since last close; per-employee
 * day-breakdown). Unit tests that drive a server action composing these (manage
 * getTillStatus/closeTill, accounting staff-till, settleReservation) use these
 * stubs. Defaults: an empty till / empty breakdown / resolved settlement.
 * Override per-test.
 */
const EMPTY_TODAY = { total: 0, count: 0 }
const EMPTY_CARRY_OVER = { total: 0, count: 0, oldestAt: null }

export const getOpenTill = vi.fn().mockResolvedValue({ total: 0, count: 0, today: EMPTY_TODAY, carryOver: EMPTY_CARRY_OVER })
export const getOpenTillsByEmployee = vi.fn().mockResolvedValue([])
export const getOpenTillItemsByEmployee = vi.fn().mockResolvedValue([])
export const closeAllOpenTills = vi.fn().mockResolvedValue({ closedCount: 0, totalClosed: 0, carryOverClosed: 0 })
export const closeEmployeeTill = vi.fn().mockResolvedValue({
  closed: false,
  totalAmount: 0,
  txnCount: 0,
  carryOverAmount: 0,
  carryOverCount: 0,
  till: { total: 0, count: 0, today: EMPTY_TODAY, carryOver: EMPTY_CARRY_OVER },
})
export const getTillByEmployee = vi.fn().mockResolvedValue([])
export const getEmployeeShiftItems = vi.fn().mockResolvedValue([])
export const recordSettlement = vi.fn().mockResolvedValue({ id: 'te-mock-1', amount: 10, siteId: 'site-1', reservationId: null, rentalBookingId: null, employeeId: null, settledAt: new Date(), voidedAt: null, createdAt: new Date() })
export const voidSettlementsForReservation = vi.fn().mockResolvedValue(0)
export const voidSettlementsForRentalBooking = vi.fn().mockResolvedValue(0)
