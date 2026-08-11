import { describe, it, expect, vi, beforeEach } from 'vitest'
import { siteDayBounds } from '@repo/data/site-day'

vi.mock('@repo/data/payment', () => ({
  processConfirmedReservation: vi.fn().mockResolvedValue(undefined),
  processCashRentalBooking: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/app/auth', () => ({
  auth: vi.fn().mockResolvedValue(null),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

// Mock the conflict guards — the real implementations use $transaction + FOR UPDATE
// which the PrismaCient mock cannot model. Default success paths.
// Override per-test for conflict/unavailable scenarios.
vi.mock('@repo/data/reservations', () => ({
  reserveWithConflictGuard: vi.fn().mockResolvedValue({
    outcome: 'created',
    reservationId: 'r1',
  }),
  moveReservationWithConflictGuard: vi.fn().mockResolvedValue({
    outcome: 'moved',
  }),
  createRentalBookingsWithGuard: vi.fn().mockResolvedValue({
    outcome: 'created',
    bookingIds: ['rb1'],
  }),
}))

import {
  reserveItem,
  unreserveItem,
  checkInReservation,
  resumeWalkIn,
  markDeparted,
  markNoShow,
  updateReservationNotes,
  moveReservation,
  moveReservationToSeats,
  blockBed,
  unblockBed,
  holdBed,
  compBed,
  uncompBed,
  cancelReservation,
  refundReservation,
  releaseHold,
  convertHoldToWalkIn,
  markRentalPickedUp,
  markRentalReturned,
  createWalkInRental,
  createPoolSeat,
  deletePoolSeat,
  addSeatToGroup,
  removeGroupSeat,
  removeFailedReservation,
  collectReservationPayment,
  getCollectStatus,
  cancelCollection,
  splitWalkInSeat,
  collectRentalPayment,
  getRentalCollectStatus,
  cancelRentalCollection,
  findReservations,
  reserveItems,
  holdBeds,
  blockBeds,
  compBeds,
  settleReservation,
  closeDay,
  getDayShiftItems,
  getOpenTillItems,
  getManageTrends,
  getManageTrendsCsv,
  getTillStatus,
  closeTill,
} from './actions'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import { issueReservationRefund } from '@repo/data/refund'
import {
  getRevenueByChannelByDay,
  getOccupancyByDay,
  getReservationDayStats,
  getRevenueByDay,
  toFiguresCsv,
} from '@repo/data/analytics'
import {
  createReservationMolliePayment,
  reverifyAndFinalizeReservation,
  cancelReservationMolliePayment,
} from '@repo/data/reservation-payment'
import {
  createRentalBookingMolliePayment,
  reverifyAndFinalizeRentalBooking,
} from '@repo/data/rental-payment'
import {
  reserveWithConflictGuard,
  moveReservationWithConflictGuard,
  createRentalBookingsWithGuard,
} from '@repo/data/reservations'
import { recordSettlement, voidSettlementsForReservation, closeAllOpenTills, getEmployeeShiftItems, getOpenTillItemsByEmployee, getOpenTill, closeEmployeeTill } from '@repo/data/till'
import { processConfirmedReservation, processCashRentalBooking } from '@repo/data/payment'
import dayjs from 'dayjs'
import { getActiveReservation } from './bed-state'

const mockAuth = vi.mocked(auth)
const mockProcessConfirmedReservation = vi.mocked(processConfirmedReservation)
const mockProcessCashRentalBooking = vi.mocked(processCashRentalBooking)
const mockGuard = vi.mocked(reserveWithConflictGuard)
const mockMoveGuard = vi.mocked(moveReservationWithConflictGuard)
const mockRentalGuard = vi.mocked(createRentalBookingsWithGuard)

const OWNER_ID = 'owner-1'
const OTHER_ID = 'other-1'
const SITE_ID = 'site-1'
const ITEM_ID = 'item-1'
const RES_ID = 'res-1'

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue(null)
  // Guard defaults: success paths. Override in conflict/unavailable tests.
  mockGuard.mockResolvedValue({ outcome: 'created', reservationId: 'r1' })
  mockMoveGuard.mockResolvedValue({ outcome: 'moved' })
  mockRentalGuard.mockResolvedValue({ outcome: 'created', bookingIds: ['rb1'] })
})

function authenticateAsOwner() {
  mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
  vi.mocked(prisma.site.findUnique).mockResolvedValue({ userId: OWNER_ID } as any)
}

function authenticateAsNonOwner() {
  mockAuth.mockResolvedValue({ user: { id: OTHER_ID } } as any)
  vi.mocked(prisma.site.findUnique).mockResolvedValue({ userId: OWNER_ID } as any)
}

// ─── Authorization ─────────────────────────────────────────────────────────

describe('manage actions authorization', () => {
  it('rejects unauthenticated user for reserveItem', async () => {
    const res = await reserveItem(SITE_ID, ITEM_ID)
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authenticated')
  })

  it('rejects non-owner for reserveItem', async () => {
    authenticateAsNonOwner()
    const res = await reserveItem(SITE_ID, ITEM_ID)
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authorized')
  })

  it('rejects unauthenticated for checkInReservation', async () => {
    const res = await checkInReservation(SITE_ID, RES_ID)
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authenticated')
  })

  it('rejects non-owner for markDeparted', async () => {
    authenticateAsNonOwner()
    const res = await markDeparted(SITE_ID, RES_ID)
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authorized')
  })

  it('rejects non-owner for blockBed', async () => {
    authenticateAsNonOwner()
    const res = await blockBed(SITE_ID, ITEM_ID)
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authorized')
  })

  it('rejects non-owner for createWalkInRental', async () => {
    authenticateAsNonOwner()
    const res = await createWalkInRental({
      siteId: SITE_ID,
      items: [{ rentalItemId: 'ri-1', quantity: 1 }],
      durationType: 'days',
      paymentType: 'cash',
    })
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authorized')
  })
})

// ─── reserveItem (walk-in) ──────────────────────────────────────────────────

describe('reserveItem', () => {
  it('creates walk-in reservation with paid-in-cash status', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.inventoryItem.findUnique).mockResolvedValue(null) // no pair

    const res = await reserveItem(SITE_ID, ITEM_ID, 'John', 'VIP guest')
    expect(res.status).toBe('ok')

    // Guard is called — check the data it received
    const guardCall = mockGuard.mock.calls[0][0]
    expect(guardCall.status).toBe('paid-in-cash')
    expect(guardCall.operationalStatus).toBe('walked-in')
    expect(guardCall.guestName).toBe('John')
    expect(guardCall.internalNotes).toBe('VIP guest')
    expect(guardCall.itemIds).toEqual([ITEM_ID])
    expect(guardCall.siteId).toBe(SITE_ID)
    // prisma.reservation.create must NOT be called directly (guard owns create)
    expect(vi.mocked(prisma.reservation.create)).not.toHaveBeenCalled()
  })

  it('includes paired item automatically via SunbedGroup', async () => {
    authenticateAsOwner()
    // getGroupMemberIds: findUnique returns an item with a sunbedGroupId
    vi.mocked(prisma.inventoryItem.findUnique).mockResolvedValue({
      id: ITEM_ID,
      pairId: 'pair-1',
      sunbedGroupId: 'group-1',
      pairedBy: null,
    } as any)
    // findMany for siblings
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([{ id: 'pair-1' }] as any)

    await reserveItem(SITE_ID, ITEM_ID)

    // Guard must receive the fully expanded id list (primary + sibling)
    const guardCall = mockGuard.mock.calls[0][0]
    expect(guardCall.itemIds).toEqual([ITEM_ID, 'pair-1'])
  })

  it('includes paired item automatically via legacy pairId fallback', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.inventoryItem.findUnique).mockResolvedValue({
      id: ITEM_ID,
      pairId: 'pair-1',
      sunbedGroupId: null,
      pairedBy: null,
    } as any)

    await reserveItem(SITE_ID, ITEM_ID)

    const guardCall = mockGuard.mock.calls[0][0]
    expect(guardCall.itemIds).toEqual([ITEM_ID, 'pair-1'])
  })

  it('truncates guest name to 200 chars and notes to 500', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.inventoryItem.findUnique).mockResolvedValue(null)

    await reserveItem(SITE_ID, ITEM_ID, 'A'.repeat(300), 'B'.repeat(600))

    const guardCall = mockGuard.mock.calls[0][0]
    expect(guardCall.guestName).toHaveLength(200)
    expect(guardCall.internalNotes).toHaveLength(500)
  })

  it('defaults to a single-day (today) reservation when no end date given', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.inventoryItem.findUnique).mockResolvedValue(null)

    await reserveItem(SITE_ID, ITEM_ID)

    // With no tz fields in the mock, the fallback is 'Europe/Madrid'.
    // Compare against siteDayBounds to prove venue-local anchoring (not server-tz dayjs).
    const { start: expectedFrom, end: expectedTo } = siteDayBounds({})
    const guardCall = mockGuard.mock.calls[0][0]
    expect((guardCall.from as Date).getTime()).toBe(expectedFrom.getTime())
    expect((guardCall.to as Date).getTime()).toBe(expectedTo.getTime())
  })

  it('extends the reservation to the end of the given `until` date', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.inventoryItem.findUnique).mockResolvedValue(null)

    const until = dayjs().add(3, 'day').format('YYYY-MM-DD')
    const res = await reserveItem(SITE_ID, ITEM_ID, undefined, undefined, undefined, until)
    expect(res.status).toBe('ok')

    const { start: expectedFrom } = siteDayBounds({})
    const expectedTo = siteDayBounds({}, new Date(until + 'T12:00:00.000Z')).end
    const guardCall = mockGuard.mock.calls[0][0]
    expect((guardCall.from as Date).getTime()).toBe(expectedFrom.getTime())
    expect((guardCall.to as Date).getTime()).toBe(expectedTo.getTime())
  })

  it('passes the expanded id list (primary + siblings) to the guard for conflict checking', async () => {
    // This is the fix for the pair-expansion double-booking bug: siblings must
    // be expanded BEFORE the guard call, so the guard's conflict check covers them.
    authenticateAsOwner()
    vi.mocked(prisma.inventoryItem.findUnique).mockResolvedValue({
      id: ITEM_ID, pairId: 'pair-1', sunbedGroupId: 'group-1', pairedBy: null,
    } as any)
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([{ id: 'pair-1' }] as any)

    const until = dayjs().add(2, 'day').format('YYYY-MM-DD')
    await reserveItem(SITE_ID, ITEM_ID, undefined, undefined, undefined, until)

    const { start: expectedFrom } = siteDayBounds({})
    const expectedTo = siteDayBounds({}, new Date(until + 'T12:00:00.000Z')).end
    const guardCall = mockGuard.mock.calls[0][0]
    // Both the primary item AND the sibling must reach the guard
    expect(guardCall.itemIds).toContain(ITEM_ID)
    expect(guardCall.itemIds).toContain('pair-1')
    expect((guardCall.to as Date).getTime()).toBe(expectedTo.getTime())
    expect((guardCall.from as Date).getTime()).toBe(expectedFrom.getTime())
  })

  it('rejects when the guard returns a conflict', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.inventoryItem.findUnique).mockResolvedValue(null)
    mockGuard.mockResolvedValueOnce({ outcome: 'conflict', conflictingReservationId: 'existing' })

    const until = dayjs().add(4, 'day').format('YYYY-MM-DD')
    const res = await reserveItem(SITE_ID, ITEM_ID, undefined, undefined, undefined, until)

    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toMatch(/already reserved/i)
    expect(vi.mocked(prisma.reservation.create)).not.toHaveBeenCalled()
  })

  it('rejects an invalid end date', async () => {
    authenticateAsOwner()
    const res = await reserveItem(SITE_ID, ITEM_ID, undefined, undefined, undefined, 'not-a-date')
    expect(res.status).toBe('error')
    expect(vi.mocked(prisma.reservation.create)).not.toHaveBeenCalled()
  })

  it('rejects an end date in the past', async () => {
    authenticateAsOwner()
    const until = dayjs().subtract(1, 'day').format('YYYY-MM-DD')
    const res = await reserveItem(SITE_ID, ITEM_ID, undefined, undefined, undefined, until)
    expect(res.status).toBe('error')
    expect(vi.mocked(prisma.reservation.create)).not.toHaveBeenCalled()
  })

  it('rejects a range longer than 90 days', async () => {
    authenticateAsOwner()
    const until = dayjs().add(91, 'day').format('YYYY-MM-DD')
    const res = await reserveItem(SITE_ID, ITEM_ID, undefined, undefined, undefined, until)
    expect(res.status).toBe('error')
    expect(vi.mocked(prisma.reservation.create)).not.toHaveBeenCalled()
  })
})

// ─── Venue-local timezone correctness for create actions ───────────────────
//
// These tests prove that on-site create actions anchor from/to to the venue's
// civil day, not the server timezone. The bug: a server in UTC creates a walk-in
// whose `to` lands at midnight UTC (= 02:00 venue time next day), so the
// occupancy query (venue-local) sees it as occupying tomorrow's window too.
//
// Strategy: mock the site with a timezone several hours ahead of the test runner
// (which is typically UTC in CI). For 'Pacific/Kiritimati' (UTC+14) the venue
// end-of-day is 10:00 UTC of the same wall-clock day. A server-tz `endOf('day')`
// in UTC = 23:59:59 UTC — far later than 10:00 UTC — so the two approaches
// produce measurably different timestamps.

describe('venue-local timezone anchoring for create actions', () => {
  // A timezone far ahead of UTC so the divergence is maximally visible in tests.
  // UTC+14 means civil-day ends at 10:00:00 UTC (23:59:59 Kiritimati − 14h).
  const KIRITIMATI_TZ = 'Pacific/Kiritimati'
  const HAWAII_TZ = 'Pacific/Honolulu' // UTC-10

  // Mock site with explicit timezone; no lat/lng needed (timeZone takes priority).
  function siteWithTz(timeZone: string) {
    return { userId: OWNER_ID, type: 'free', price: null, timeZone, locationLat: null, locationLng: null }
  }

  it('reserveItem: `from` and `to` match venue-local siteDayBounds, not server-tz dayjs', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    vi.mocked(prisma.site.findUnique).mockResolvedValue(siteWithTz(KIRITIMATI_TZ) as any)
    vi.mocked(prisma.inventoryItem.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([])

    await reserveItem(SITE_ID, ITEM_ID)

    const { start: expectedFrom, end: expectedTo } = siteDayBounds({ timeZone: KIRITIMATI_TZ })
    const guardCall = mockGuard.mock.calls[0][0]
    expect((guardCall.from as Date).getTime()).toBe(expectedFrom.getTime())
    expect((guardCall.to as Date).getTime()).toBe(expectedTo.getTime())

    // Prove the fix matters: server-tz end-of-day diverges from venue end-of-day.
    // In UTC CI, dayjs().endOf('day') = 23:59:59 UTC; Kiritimati end = ~10:00 UTC.
    const serverTzEnd = dayjs().endOf('day').toDate()
    // They should differ (unless tests run in Kiritimati tz, which is never the case).
    expect(expectedTo.getTime()).not.toBe(serverTzEnd.getTime())
  })

  it('reserveItem `until` extension: `to` is venue-local end of the picked day', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    vi.mocked(prisma.site.findUnique).mockResolvedValue(siteWithTz(HAWAII_TZ) as any)
    vi.mocked(prisma.inventoryItem.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([])

    const until = dayjs().add(3, 'day').format('YYYY-MM-DD')
    await reserveItem(SITE_ID, ITEM_ID, undefined, undefined, undefined, until)

    // Expected: end of `until` day in Hawaii time (UTC-10 → adds 10h to midnight)
    const expectedTo = siteDayBounds({ timeZone: HAWAII_TZ }, new Date(until + 'T12:00:00.000Z')).end
    const guardCall = mockGuard.mock.calls[0][0]
    expect((guardCall.to as Date).getTime()).toBe(expectedTo.getTime())

    // Prove it differs from a naive server-tz calculation
    const naiveTo = dayjs(until).endOf('day').toDate()
    expect(expectedTo.getTime()).not.toBe(naiveTo.getTime())
  })

  it('holdBed: `from`/`to` use venue-local day bounds', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    vi.mocked(prisma.site.findUnique).mockResolvedValue(siteWithTz(KIRITIMATI_TZ) as any)
    vi.mocked(prisma.inventoryItem.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([])
    vi.mocked(prisma.employee.findUnique).mockResolvedValue(null)

    await holdBed(SITE_ID, ITEM_ID)

    const { start: expectedFrom, end: expectedTo } = siteDayBounds({ timeZone: KIRITIMATI_TZ })
    const guardCall = mockGuard.mock.calls[0][0]
    expect((guardCall.from as Date).getTime()).toBe(expectedFrom.getTime())
    expect((guardCall.to as Date).getTime()).toBe(expectedTo.getTime())
  })

  it('compBed: `from`/`to` use venue-local day bounds', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    vi.mocked(prisma.site.findUnique).mockResolvedValue(siteWithTz(KIRITIMATI_TZ) as any)
    vi.mocked(prisma.inventoryItem.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([])
    vi.mocked(prisma.employee.findUnique).mockResolvedValue(null)

    await compBed(SITE_ID, ITEM_ID)

    const { start: expectedFrom, end: expectedTo } = siteDayBounds({ timeZone: KIRITIMATI_TZ })
    const guardCall = mockGuard.mock.calls[0][0]
    expect((guardCall.from as Date).getTime()).toBe(expectedFrom.getTime())
    expect((guardCall.to as Date).getTime()).toBe(expectedTo.getTime())
  })

  it('createWalkInRental all-day: `to` is venue-local end-of-day, not server-tz', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    vi.mocked(prisma.site.findUnique).mockResolvedValue(siteWithTz(KIRITIMATI_TZ) as any)
    vi.mocked(prisma.rentalItem.findMany).mockResolvedValue([
      { id: 'ri-1', siteId: SITE_ID, name: 'Board', active: true, pricePerDay: 20, pricePerHour: null },
    ] as any)
    vi.mocked(prisma.employee.findUnique).mockResolvedValue(null)
    mockRentalGuard.mockResolvedValueOnce({ outcome: 'created', bookingIds: ['rb1'] })

    await createWalkInRental({
      siteId: SITE_ID,
      items: [{ rentalItemId: 'ri-1', quantity: 1 }],
      durationType: 'days',
      paymentType: 'cash',
    })

    const rentalCall = mockRentalGuard.mock.calls[0][0]
    const storedTo = rentalCall[0].to as Date
    const { end: expectedTo } = siteDayBounds({ timeZone: KIRITIMATI_TZ })
    expect(storedTo.getTime()).toBe(expectedTo.getTime())

    // Verify it diverges from server-tz end-of-day
    const serverTzEnd = dayjs().endOf('day').toDate()
    expect(storedTo.getTime()).not.toBe(serverTzEnd.getTime())
  })

  it('markDeparted hasFutureDays: uses venue-local end-of-today, not server-tz setHours', async () => {
    authenticateAsOwner()
    // A reservation whose `to` is beyond the venue's end-of-today (has future days)
    // but is before the server-tz midnight. This would have been wrongly treated as
    // "last day" (hasFutureDays=false) by the old server-tz setHours(23,59,59,999).
    // Hawaii (UTC-10): venue end-of-today = 09:59:59 UTC next calendar day at UTC.
    // Set `to` = 10:30 UTC, which is still in Hawaii's today (10:30 < 09:59+24h,
    // simplified: use siteDayBounds to get the future end directly).
    const tomorrowNoon = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000)
    const futureEnd = siteDayBounds({ timeZone: HAWAII_TZ }, tomorrowNoon).end
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue({
      siteId: SITE_ID,
      status: 'paid-in-cash',
      operationalStatus: 'walked-in',
      to: futureEnd,
      from: siteDayBounds({ timeZone: HAWAII_TZ }).start,
      checkedInAt: new Date(),
      guestName: null,
      userId: OWNER_ID,
      employeeId: null,
      items: [{ id: ITEM_ID, price: null }],
      site: { type: 'free', price: null, timeZone: HAWAII_TZ, locationLat: null, locationLng: null },
    } as any)
    vi.mocked(prisma.reservationDay.findUnique).mockResolvedValue({ operationalStatus: 'walked-in' } as any)
    vi.mocked(prisma.reservationDay.upsert).mockResolvedValue({} as any)
    vi.mocked(prisma.reservation.update).mockResolvedValue({} as any)

    const res = await markDeparted(SITE_ID, RES_ID)
    expect(res.status).toBe('ok')

    // hasFutureDays=true → transition to OP_EXPECTED (not departed)
    const updateCall = vi.mocked(prisma.reservation.update).mock.calls[0][0]
    expect(updateCall.data.operationalStatus).toBe('expected')
    // departedAt is explicitly cleared to null when transitioning to expected
    expect((updateCall.data as any).departedAt).toBeNull()
  })
})

// ─── unreserveItem ─────────────────────────────────────────────────────────

describe('unreserveItem', () => {
  it('deletes walk-in with overlap-with-today filter and returns ok when count > 0', async () => {
    authenticateAsOwner()
    // Pair mode pre-fetches the reservation ids for voiding before deleteMany
    vi.mocked(prisma.reservation.findMany).mockResolvedValue([{ id: RES_ID } as any])
    vi.mocked(prisma.reservation.deleteMany).mockResolvedValue({ count: 1 } as any)

    const res = await unreserveItem(SITE_ID, ITEM_ID)
    expect(res.status).toBe('ok')

    const deleteCall = vi.mocked(prisma.reservation.deleteMany).mock.calls[0][0]
    const where = deleteCall?.where as any
    // Overlap semantics: from <= todayEnd AND to >= todayStart
    expect(where.from).toHaveProperty('lte')
    expect(where.to).toHaveProperty('gte')
    // Must NOT use the old fully-contained filter shapes
    expect(where.from).not.toHaveProperty('gte')
    expect(where.to).not.toHaveProperty('lte')
    // Core ownership + status filters must remain
    expect(where.siteId).toBe(SITE_ID)
    expect(where.status).toBe('paid-in-cash')
    // A cash walk-in can be unreserved in ANY operational state (incl. departed /
    // no-show) — no operationalStatus constraint. (track 012)
    expect(where.operationalStatus).toBeUndefined()
    expect(where.items.some.id).toBe(ITEM_ID)
  })

  it('returns error when deleteMany finds nothing (count === 0)', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findMany).mockResolvedValue([{ id: RES_ID } as any])
    vi.mocked(prisma.reservation.deleteMany).mockResolvedValue({ count: 0 } as any)

    const res = await unreserveItem(SITE_ID, ITEM_ID)
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toMatch(/no walk-in reservation found/i)
  })

  it('does not call revalidatePath when nothing was deleted', async () => {
    const { revalidatePath } = await import('next/cache')
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findMany).mockResolvedValue([{ id: RES_ID } as any])
    vi.mocked(prisma.reservation.deleteMany).mockResolvedValue({ count: 0 } as any)

    await unreserveItem(SITE_ID, ITEM_ID)
    expect(vi.mocked(revalidatePath)).not.toHaveBeenCalled()
  })

  it('rejects unauthenticated caller without touching the DB', async () => {
    const res = await unreserveItem(SITE_ID, ITEM_ID)
    expect(res.status).toBe('error')
    expect(vi.mocked(prisma.reservation.deleteMany)).not.toHaveBeenCalled()
  })
})

// ─── checkInReservation ─────────────────────────────────────────────────────

// Shared site stub with tz/coord fields for the three lifecycle actions.
const SITE_TZ_STUB = { timeZone: 'Europe/Madrid', locationLat: '40.416', locationLng: '-3.703' }

describe('checkInReservation', () => {
  it('transitions expected -> checked-in (writes today row + mirrors legacy field)', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue({
      siteId: SITE_ID,
      operationalStatus: 'expected',
      site: SITE_TZ_STUB,
    } as any)
    // No today-row yet → getTodayStatus returns null → falls back to parent status
    vi.mocked(prisma.reservationDay.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.reservationDay.upsert).mockResolvedValue({
      id: 'rd-1', reservationId: RES_ID, date: new Date(), operationalStatus: 'checked-in',
      checkedInAt: new Date(), departedAt: null,
    } as any)
    vi.mocked(prisma.reservation.update).mockResolvedValue({} as any)

    const res = await checkInReservation(SITE_ID, RES_ID)
    expect(res.status).toBe('ok')

    // The legacy Reservation update must still happen (parallel-write / expand).
    const updateCall = vi.mocked(prisma.reservation.update).mock.calls[0][0]
    expect(updateCall.data.operationalStatus).toBe('checked-in')
    expect(updateCall.data.checkedInAt).toBeInstanceOf(Date)
    // Today's row must have been upserted too.
    expect(vi.mocked(prisma.reservationDay.upsert)).toHaveBeenCalledOnce()
    const upsertCall = vi.mocked(prisma.reservationDay.upsert).mock.calls[0][0]
    expect(upsertCall.update.operationalStatus).toBe('checked-in')
  })

  it('rejects check-in from non-expected status (reads today row if present)', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue({
      siteId: SITE_ID,
      operationalStatus: 'checked-in',
      site: SITE_TZ_STUB,
    } as any)
    // Today row also says checked-in
    vi.mocked(prisma.reservationDay.findUnique).mockResolvedValue({
      operationalStatus: 'checked-in',
    } as any)

    const res = await checkInReservation(SITE_ID, RES_ID)
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toContain('Cannot check in')
  })

  it('rejects reservation belonging to different site', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue({
      siteId: 'other-site',
      operationalStatus: 'expected',
      site: SITE_TZ_STUB,
    } as any)

    const res = await checkInReservation(SITE_ID, RES_ID)
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Reservation not found')
  })
})

// ─── markDeparted ───────────────────────────────────────────────────────────

describe('markDeparted', () => {
  it('transitions checked-in -> departed (writes today row + mirrors legacy field)', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue({
      siteId: SITE_ID,
      operationalStatus: 'checked-in',
      site: SITE_TZ_STUB,
    } as any)
    vi.mocked(prisma.reservationDay.findUnique).mockResolvedValue({
      operationalStatus: 'checked-in',
    } as any)
    vi.mocked(prisma.reservationDay.upsert).mockResolvedValue({
      id: 'rd-1', reservationId: RES_ID, date: new Date(), operationalStatus: 'departed',
      checkedInAt: null, departedAt: new Date(),
    } as any)
    vi.mocked(prisma.reservation.update).mockResolvedValue({} as any)

    const res = await markDeparted(SITE_ID, RES_ID)
    expect(res.status).toBe('ok')
    const updateCall = vi.mocked(prisma.reservation.update).mock.calls[0][0]
    expect(updateCall.data.operationalStatus).toBe('departed')
    expect(vi.mocked(prisma.reservationDay.upsert)).toHaveBeenCalledOnce()
  })

  it('transitions walked-in -> departed', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue({
      siteId: SITE_ID,
      operationalStatus: 'walked-in',
      site: SITE_TZ_STUB,
    } as any)
    vi.mocked(prisma.reservationDay.findUnique).mockResolvedValue({
      operationalStatus: 'walked-in',
    } as any)
    vi.mocked(prisma.reservationDay.upsert).mockResolvedValue({} as any)
    vi.mocked(prisma.reservation.update).mockResolvedValue({} as any)

    const res = await markDeparted(SITE_ID, RES_ID)
    expect(res.status).toBe('ok')
  })

  it('rejects departure from expected status', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue({
      siteId: SITE_ID,
      operationalStatus: 'expected',
      site: SITE_TZ_STUB,
    } as any)
    vi.mocked(prisma.reservationDay.findUnique).mockResolvedValue({
      operationalStatus: 'expected',
    } as any)

    const res = await markDeparted(SITE_ID, RES_ID)
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toContain('Cannot mark departed')
  })
})

// ─── markDeparted — split-then-depart (cash walk-in per-seat) ───────────────

describe('markDeparted split-then-depart', () => {
  // Helper: set up the mocks needed for the split path.
  // `splitItem` is the item being departed; `otherItems` stay on the original.
  function setupSplitMocks({
    items,
    splitItemId,
    status = 'paid-in-cash',
    operationalStatus = 'walked-in',
    hasFutureDays = false,
    siteType = 'paid',
    sitePrice = 10,
  }: {
    items: { id: string; price: number | null }[]
    splitItemId: string
    status?: string
    operationalStatus?: string
    hasFutureDays?: boolean
    siteType?: string
    sitePrice?: number
  }) {
    authenticateAsOwner()
    // Use venue-local bounds (Madrid tz from SITE_TZ_STUB) so `hasFutureDays` in the
    // action (which now uses siteDayBounds) is computed against the same base.
    const madridTz = { timeZone: 'Europe/Madrid' }
    const { start: fromDate, end: todayVenueEnd } = siteDayBounds(madridTz)
    const tomorrowNoon = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000)
    const toDate = hasFutureDays
      ? siteDayBounds(madridTz, tomorrowNoon).end
      : todayVenueEnd
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue({
      siteId: SITE_ID,
      status,
      operationalStatus,
      to: toDate,
      from: fromDate,
      checkedInAt: new Date(),
      guestName: 'Alice',
      userId: OWNER_ID,
      employeeId: 'emp-1',
      items,
      site: {
        type: siteType,
        price: sitePrice,
        ...SITE_TZ_STUB,
      },
    } as any)
    vi.mocked(prisma.reservationDay.findUnique).mockResolvedValue({
      operationalStatus,
    } as any)
    vi.mocked(prisma.reservation.update).mockResolvedValue({} as any)
    vi.mocked(prisma.reservation.create).mockResolvedValue({ id: 'new-res-split' } as any)
    vi.mocked(prisma.reservationDay.upsert).mockResolvedValue({} as any)
  }

  it('3-seat cash walk-in: splits off one seat (array form), original keeps 2 items + walked-in', async () => {
    const ITEM_B = 'item-b'
    const ITEM_C = 'item-c'
    setupSplitMocks({
      items: [{ id: ITEM_ID, price: null }, { id: ITEM_B, price: null }, { id: ITEM_C, price: null }],
      splitItemId: ITEM_ID,
    })

    const res = await markDeparted(SITE_ID, RES_ID, undefined, [ITEM_ID])
    expect(res.status).toBe('ok')

    // Original reservation: disconnect the split seat, reduce paymentAmount.
    const updateCalls = vi.mocked(prisma.reservation.update).mock.calls
    const origUpdate = updateCalls.find(
      (c) => c[0].where.id === RES_ID
    )
    expect(origUpdate).toBeDefined()
    expect((origUpdate![0].data as any).items?.disconnect).toEqual([{ id: ITEM_ID }])
    // Remaining 2 items × 10€ × 1 day = 20€
    expect((origUpdate![0].data as any).paymentAmount).toBe(20)

    // New reservation created for the split seat.
    const createCall = vi.mocked(prisma.reservation.create).mock.calls[0][0]
    expect((createCall.data as any).status).toBe('paid-in-cash')
    expect((createCall.data as any).operationalStatus).toBe('walked-in')
    expect((createCall.data as any).items?.connect).toEqual([{ id: ITEM_ID }])
    // Per-seat amount: 1 item × 10€ × 1 day = 10€
    expect((createCall.data as any).paymentAmount).toBe(10)
    // Attribution preserved from original
    expect((createCall.data as any).employeeId).toBe('emp-1')
    expect((createCall.data as any).guestName).toBe('Alice')
  })

  it('till is conserved: split seat + remaining amounts sum to original total', async () => {
    const ITEM_B = 'item-b'
    const ITEM_C = 'item-c'
    setupSplitMocks({
      items: [{ id: ITEM_ID, price: null }, { id: ITEM_B, price: null }, { id: ITEM_C, price: null }],
      splitItemId: ITEM_ID,
      sitePrice: 15,
    })

    await markDeparted(SITE_ID, RES_ID, undefined, [ITEM_ID])

    const updateCalls = vi.mocked(prisma.reservation.update).mock.calls
    const origUpdate = updateCalls.find((c) => c[0].where.id === RES_ID)
    const createCall = vi.mocked(prisma.reservation.create).mock.calls[0][0]

    const splitAmount = (createCall.data as any).paymentAmount as number
    const remainingAmount = (origUpdate![0].data as any).paymentAmount as number
    // Original 3 seats × 15€ × 1 day = 45€
    expect(splitAmount + remainingAmount).toBe(45)
  })

  it('split last-day → new reservation departed (bed freed)', async () => {
    const ITEM_B = 'item-b'
    setupSplitMocks({
      items: [{ id: ITEM_ID, price: null }, { id: ITEM_B, price: null }],
      splitItemId: ITEM_ID,
      hasFutureDays: false,
    })

    const res = await markDeparted(SITE_ID, RES_ID, undefined, [ITEM_ID])
    expect(res.status).toBe('ok')

    // The new reservation must be departed
    const updateCalls = vi.mocked(prisma.reservation.update).mock.calls
    const newResUpdate = updateCalls.find((c) => c[0].where.id === 'new-res-split')
    expect(newResUpdate).toBeDefined()
    expect((newResUpdate![0].data as any).operationalStatus).toBe('departed')
    expect((newResUpdate![0].data as any).departedAt).toBeInstanceOf(Date)

    // Today's ReservationDay for the new reservation must also be departed
    const upsertCall = vi.mocked(prisma.reservationDay.upsert).mock.calls[0][0]
    expect(upsertCall.create.operationalStatus).toBe('departed')
    expect(upsertCall.update.operationalStatus).toBe('departed')
  })

  it('split future-days → new reservation expected (re-rentable tomorrow)', async () => {
    const ITEM_B = 'item-b'
    setupSplitMocks({
      items: [{ id: ITEM_ID, price: null }, { id: ITEM_B, price: null }],
      splitItemId: ITEM_ID,
      hasFutureDays: true,
    })

    const res = await markDeparted(SITE_ID, RES_ID, undefined, [ITEM_ID])
    expect(res.status).toBe('ok')

    const updateCalls = vi.mocked(prisma.reservation.update).mock.calls
    const newResUpdate = updateCalls.find((c) => c[0].where.id === 'new-res-split')
    expect(newResUpdate).toBeDefined()
    expect((newResUpdate![0].data as any).operationalStatus).toBe('expected')
    expect((newResUpdate![0].data as any).checkedInAt).toBeNull()

    const upsertCall = vi.mocked(prisma.reservationDay.upsert).mock.calls[0][0]
    expect(upsertCall.create.operationalStatus).toBe('expected')
    expect(upsertCall.update.operationalStatus).toBe('expected')
  })

  it('2-of-3 subset split: 2 seats split off together as ONE new reservation, original keeps 1', async () => {
    const ITEM_B = 'item-b'
    const ITEM_C = 'item-c'
    setupSplitMocks({
      items: [{ id: ITEM_ID, price: null }, { id: ITEM_B, price: null }, { id: ITEM_C, price: null }],
      splitItemId: ITEM_ID, // not used by the split logic now, just for helper compat
    })

    // Split ITEM_ID + ITEM_B together (2 of 3 seats)
    const res = await markDeparted(SITE_ID, RES_ID, undefined, [ITEM_ID, ITEM_B])
    expect(res.status).toBe('ok')

    const updateCalls = vi.mocked(prisma.reservation.update).mock.calls
    const origUpdate = updateCalls.find((c) => c[0].where.id === RES_ID)
    expect(origUpdate).toBeDefined()
    // Disconnect both selected seats
    expect((origUpdate![0].data as any).items?.disconnect).toEqual(
      expect.arrayContaining([{ id: ITEM_ID }, { id: ITEM_B }]),
    )
    // Original keeps 1 seat: 1 item × 10€ × 1 day = 10€
    expect((origUpdate![0].data as any).paymentAmount).toBe(10)

    // ONE new reservation for the 2-seat subset
    const createCall = vi.mocked(prisma.reservation.create).mock.calls[0][0]
    expect((createCall.data as any).status).toBe('paid-in-cash')
    expect((createCall.data as any).items?.connect).toEqual(
      expect.arrayContaining([{ id: ITEM_ID }, { id: ITEM_B }]),
    )
    // Subset amount: 2 items × 10€ × 1 day = 20€
    expect((createCall.data as any).paymentAmount).toBe(20)
    // Amounts conserve: 20 + 10 = 30 (3 seats × 10€ × 1 day)
    expect((createCall.data as any).paymentAmount + (origUpdate![0].data as any).paymentAmount).toBe(30)
  })

  it('splitItemIds covering ALL items → whole depart (no pointless split)', async () => {
    const ITEM_B = 'item-b'
    setupSplitMocks({
      items: [{ id: ITEM_ID, price: null }, { id: ITEM_B, price: null }],
      splitItemId: ITEM_ID,
    })

    // Passing all items as splitItemIds must fall through to whole depart
    const res = await markDeparted(SITE_ID, RES_ID, undefined, [ITEM_ID, ITEM_B])
    expect(res.status).toBe('ok')
    // canSplit is false (validSplitIds.length === reservation.items.length) → no create
    expect(vi.mocked(prisma.reservation.create)).not.toHaveBeenCalled()
  })

  it('whole depart (no splitItemIds) is unchanged', async () => {
    authenticateAsOwner()
    // Use venue-local end-of-today (Madrid tz) so hasFutureDays=false in the action.
    const { start: fromDate, end: toDate } = siteDayBounds({ timeZone: 'Europe/Madrid' })
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue({
      siteId: SITE_ID,
      status: 'paid-in-cash',
      operationalStatus: 'walked-in',
      to: toDate,
      from: fromDate,
      checkedInAt: new Date(),
      guestName: null,
      userId: OWNER_ID,
      employeeId: null,
      items: [{ id: ITEM_ID, price: null }, { id: 'item-b', price: null }],
      site: { type: 'paid', price: 10, ...SITE_TZ_STUB },
    } as any)
    vi.mocked(prisma.reservationDay.findUnique).mockResolvedValue({ operationalStatus: 'walked-in' } as any)
    vi.mocked(prisma.reservationDay.upsert).mockResolvedValue({} as any)
    vi.mocked(prisma.reservation.update).mockResolvedValue({} as any)

    const res = await markDeparted(SITE_ID, RES_ID)
    expect(res.status).toBe('ok')
    // No split: create must NOT have been called
    expect(vi.mocked(prisma.reservation.create)).not.toHaveBeenCalled()
    // Whole-row depart via applyDayTransition
    expect(vi.mocked(prisma.reservationDay.upsert)).toHaveBeenCalledOnce()
  })

  it('single-item reservation with splitItemIds: falls through to whole depart', async () => {
    authenticateAsOwner()
    const { start: fromDate, end: toDate } = siteDayBounds({ timeZone: 'Europe/Madrid' })
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue({
      siteId: SITE_ID,
      status: 'paid-in-cash',
      operationalStatus: 'walked-in',
      to: toDate,
      from: fromDate,
      checkedInAt: new Date(),
      guestName: null,
      userId: OWNER_ID,
      employeeId: null,
      items: [{ id: ITEM_ID, price: null }],
      site: { type: 'paid', price: 10, ...SITE_TZ_STUB },
    } as any)
    vi.mocked(prisma.reservationDay.findUnique).mockResolvedValue({ operationalStatus: 'walked-in' } as any)
    vi.mocked(prisma.reservationDay.upsert).mockResolvedValue({} as any)
    vi.mocked(prisma.reservation.update).mockResolvedValue({} as any)

    const res = await markDeparted(SITE_ID, RES_ID, undefined, [ITEM_ID])
    expect(res.status).toBe('ok')
    // Single item → canSplit is false → no split, no create
    expect(vi.mocked(prisma.reservation.create)).not.toHaveBeenCalled()
  })

  it('online checked-in (complete status) with splitItemIds: whole depart only', async () => {
    authenticateAsOwner()
    const { start: fromDate, end: toDate } = siteDayBounds({ timeZone: 'Europe/Madrid' })
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue({
      siteId: SITE_ID,
      status: 'complete',           // NOT paid-in-cash
      operationalStatus: 'checked-in',
      to: toDate,
      from: fromDate,
      checkedInAt: new Date(),
      guestName: null,
      userId: OWNER_ID,
      employeeId: null,
      items: [{ id: ITEM_ID, price: null }, { id: 'item-b', price: null }],
      site: { type: 'paid', price: 10, ...SITE_TZ_STUB },
    } as any)
    vi.mocked(prisma.reservationDay.findUnique).mockResolvedValue({ operationalStatus: 'checked-in' } as any)
    vi.mocked(prisma.reservationDay.upsert).mockResolvedValue({} as any)
    vi.mocked(prisma.reservation.update).mockResolvedValue({} as any)

    const res = await markDeparted(SITE_ID, RES_ID, undefined, [ITEM_ID])
    expect(res.status).toBe('ok')
    // complete status → not a cash walk-in → whole-reservation depart, no split
    expect(vi.mocked(prisma.reservation.create)).not.toHaveBeenCalled()
  })

  it('QR-collected walk-in (complete + walked-in) with splitItemIds: whole depart only', async () => {
    authenticateAsOwner()
    const { start: fromDate, end: toDate } = siteDayBounds({ timeZone: 'Europe/Madrid' })
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue({
      siteId: SITE_ID,
      status: 'complete',           // paid online via QR collect
      operationalStatus: 'walked-in',
      to: toDate,
      from: fromDate,
      checkedInAt: new Date(),
      guestName: null,
      userId: OWNER_ID,
      employeeId: null,
      items: [{ id: ITEM_ID, price: null }, { id: 'item-b', price: null }],
      site: { type: 'paid', price: 10, ...SITE_TZ_STUB },
    } as any)
    vi.mocked(prisma.reservationDay.findUnique).mockResolvedValue({ operationalStatus: 'walked-in' } as any)
    vi.mocked(prisma.reservationDay.upsert).mockResolvedValue({} as any)
    vi.mocked(prisma.reservation.update).mockResolvedValue({} as any)

    const res = await markDeparted(SITE_ID, RES_ID, undefined, [ITEM_ID])
    expect(res.status).toBe('ok')
    // QR-collected (complete) → not cash walk-in → whole depart
    expect(vi.mocked(prisma.reservation.create)).not.toHaveBeenCalled()
  })
})

// ─── markNoShow ─────────────────────────────────────────────────────────────

describe('markNoShow', () => {
  it('transitions expected -> no-show (writes today row + mirrors legacy field)', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue({
      siteId: SITE_ID,
      operationalStatus: 'expected',
      site: SITE_TZ_STUB,
    } as any)
    vi.mocked(prisma.reservationDay.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.reservationDay.upsert).mockResolvedValue({
      id: 'rd-1', reservationId: RES_ID, date: new Date(), operationalStatus: 'no-show',
      checkedInAt: null, departedAt: null,
    } as any)
    vi.mocked(prisma.reservation.update).mockResolvedValue({} as any)

    const res = await markNoShow(SITE_ID, RES_ID)
    expect(res.status).toBe('ok')
    const updateCall = vi.mocked(prisma.reservation.update).mock.calls[0][0]
    expect(updateCall.data.operationalStatus).toBe('no-show')
    expect(vi.mocked(prisma.reservationDay.upsert)).toHaveBeenCalledOnce()
  })

  it('rejects no-show from checked-in (reads today row)', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue({
      siteId: SITE_ID,
      operationalStatus: 'checked-in',
      site: SITE_TZ_STUB,
    } as any)
    vi.mocked(prisma.reservationDay.findUnique).mockResolvedValue({
      operationalStatus: 'checked-in',
    } as any)

    const res = await markNoShow(SITE_ID, RES_ID)
    expect(res.status).toBe('error')
  })
})

// ─── Per-day lifecycle — multiday booking behavior ─────────────────────────
//
// These tests verify the three P1 bugs are fixed:
//   (a) A booking checked in on day-1 shows TODAY's row as `expected` on day-2.
//   (b) Departing on day-1 leaves the bed RESERVED for day-2 (double-sell fix).
//   (c) Per-day checkedInAt is today's, not the stale day-1 value.

describe('multiday per-day lifecycle', () => {
  it('(a) day-2: today row expected → bed reads as expected (not checked-in from day-1)', async () => {
    // Day-2 scenario: parent says checked-in (day-1 state), but today's row is expected.
    // getTodayStatus returns 'expected' → precondition for checkIn passes.
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue({
      siteId: SITE_ID,
      operationalStatus: 'checked-in', // parent is stale day-1
      site: SITE_TZ_STUB,
    } as any)
    // Today row says expected (it was lazy-created at day-2 rollover)
    vi.mocked(prisma.reservationDay.findUnique).mockResolvedValue({
      operationalStatus: 'expected',
    } as any)
    vi.mocked(prisma.reservationDay.upsert).mockResolvedValue({
      id: 'rd-2', reservationId: RES_ID, date: new Date(), operationalStatus: 'checked-in',
      checkedInAt: new Date(), departedAt: null,
    } as any)
    vi.mocked(prisma.reservation.update).mockResolvedValue({} as any)

    // checkIn should SUCCEED because today's row is 'expected' (not stale 'checked-in')
    const res = await checkInReservation(SITE_ID, RES_ID)
    expect(res.status).toBe('ok')
    // The today row should have been transitioned to checked-in
    const upsertCall = vi.mocked(prisma.reservationDay.upsert).mock.calls[0][0]
    expect(upsertCall.update.operationalStatus).toBe('checked-in')
  })

  it('(b) day-1 departure leaves bed reserved for day-2 (getActiveReservation still returns it)', () => {
    // Simulate: parent says departed (day-1 action), but today (day-2) row says expected.
    // bed-state.ts effectiveOpStatus must read today's row, NOT the parent.
    const item = {
      id: ITEM_ID,
      number: 10101,
      group: 1,
      status: 'active',
      reservations: [
        {
          id: RES_ID,
          siteId: SITE_ID,
          type: 'days',
          status: 'complete',
          operationalStatus: 'departed', // parent: day-1 departure
          from: dayjs().subtract(1, 'day').toDate(),
          to: dayjs().add(2, 'day').toDate(), // still ongoing
          user: { id: 'u1', email: 'g@test.com' },
          today: {
            id: 'rd-2',
            reservationId: RES_ID,
            date: new Date(),
            operationalStatus: 'expected', // day-2 row: expected (re-cycled)
            checkedInAt: null,
            departedAt: null,
          },
        },
      ],
    } as any

    // With today row: bed should still be ACTIVE (not filter it out) because today = expected
    const activeRes = getActiveReservation(item)
    expect(activeRes).not.toBeNull()
    expect(activeRes?.today?.operationalStatus).toBe('expected')
  })

  it('(c) OccupantInfo uses today checkedInAt, not day-1 stale value', async () => {
    // Per-day checkedInAt: checkIn on day-2 writes today's row with today's time,
    // NOT the day-1 legacy field. The legacy field mirrors day-2 checkedInAt too.
    authenticateAsOwner()
    const day1CheckedInAt = new Date(Date.now() - 86_400_000) // 24h ago
    const day2Now = new Date()

    vi.mocked(prisma.reservation.findUnique).mockResolvedValue({
      siteId: SITE_ID,
      operationalStatus: 'expected', // today row says expected (day-2 fresh)
      site: SITE_TZ_STUB,
      checkedInAt: day1CheckedInAt, // legacy field still has day-1 time
    } as any)
    vi.mocked(prisma.reservationDay.findUnique).mockResolvedValue({
      operationalStatus: 'expected',
    } as any)
    vi.mocked(prisma.reservationDay.upsert).mockResolvedValue({
      id: 'rd-2', reservationId: RES_ID, date: new Date(),
      operationalStatus: 'checked-in',
      checkedInAt: day2Now, // today's check-in time
      departedAt: null,
    } as any)
    vi.mocked(prisma.reservation.update).mockResolvedValue({} as any)

    const res = await checkInReservation(SITE_ID, RES_ID)
    expect(res.status).toBe('ok')

    // The reservation.update (legacy mirror) must set checkedInAt to NOW (day-2),
    // not preserve day-1's value. This is verified by the upsert + update data.
    const updateCall = vi.mocked(prisma.reservation.update).mock.calls[0][0]
    expect(updateCall.data.checkedInAt).toBeInstanceOf(Date)
    // The new timestamp must be after day-1 (within a 1-minute window of "now")
    const delta = Math.abs(updateCall.data.checkedInAt.getTime() - day2Now.getTime())
    expect(delta).toBeLessThan(5_000) // within 5s of test execution
  })
})

// ─── updateReservationNotes ─────────────────────────────────────────────────

describe('updateReservationNotes', () => {
  it('updates notes and truncates to 500 chars', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue({ siteId: SITE_ID } as any)
    vi.mocked(prisma.reservation.update).mockResolvedValue({} as any)

    const longNotes = 'X'.repeat(600)
    const res = await updateReservationNotes(SITE_ID, RES_ID, longNotes)
    expect(res.status).toBe('ok')
    expect(vi.mocked(prisma.reservation.update).mock.calls[0][0].data.internalNotes).toHaveLength(500)
  })
})

// ─── moveReservation ────────────────────────────────────────────────────────

describe('moveReservation', () => {
  it('calls move guard with expanded item list and returns ok', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue({
      siteId: SITE_ID,
      operationalStatus: 'checked-in',
    } as any)
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([
      { id: 'new-item-1' },
      { id: 'new-item-2' },
    ] as any)
    // getGroupMemberIds: no siblings for either new item
    vi.mocked(prisma.inventoryItem.findUnique).mockResolvedValue(null)

    const res = await moveReservation(SITE_ID, RES_ID, ['new-item-1', 'new-item-2'])
    expect(res.status).toBe('ok')

    // Guard must be called with the reservation id and the (un-expanded) item list
    expect(mockMoveGuard).toHaveBeenCalledWith(RES_ID, ['new-item-1', 'new-item-2'])
    // prisma.reservation.update must NOT be called directly — guard owns the write
    expect(vi.mocked(prisma.reservation.update)).not.toHaveBeenCalled()
  })

  it('expands SunbedGroup siblings of newItemIds before calling the guard', async () => {
    // Ensures the conflict check sees the full pair, not just the requested item.
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue({
      siteId: SITE_ID,
      operationalStatus: 'checked-in',
    } as any)
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([
      { id: 'new-item-1' },
    ] as any)
    // getGroupMemberIds for 'new-item-1' → SunbedGroup sibling 'sibling-1'
    vi.mocked(prisma.inventoryItem.findUnique).mockResolvedValue({
      pairId: null,
      sunbedGroupId: 'group-1',
      pairedBy: null,
    } as any)
    // findMany for group members
    vi.mocked(prisma.inventoryItem.findMany)
      .mockResolvedValueOnce([{ id: 'new-item-1' }] as any) // validation findMany
      .mockResolvedValueOnce([{ id: 'sibling-1' }] as any) // group siblings findMany

    const res = await moveReservation(SITE_ID, RES_ID, ['new-item-1'])
    expect(res.status).toBe('ok')

    // Guard must receive the expanded list including the sibling
    const guardArgs = mockMoveGuard.mock.calls[0]
    expect(guardArgs[0]).toBe(RES_ID)
    expect(guardArgs[1]).toContain('new-item-1')
    expect(guardArgs[1]).toContain('sibling-1')
  })

  it('rejects move when guard returns conflict (target bed already occupied)', async () => {
    // This is the bug that moveReservationWithConflictGuard fixes: the old code
    // used a bare prisma.reservation.update with no conflict check, allowing the
    // move to double-book a bed already reserved by another reservation.
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue({
      siteId: SITE_ID,
      operationalStatus: 'checked-in',
    } as any)
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([
      { id: 'new-item-1' },
    ] as any)
    vi.mocked(prisma.inventoryItem.findUnique).mockResolvedValue(null)

    mockMoveGuard.mockResolvedValueOnce({
      outcome: 'conflict',
      conflictingReservationId: 'other-res',
    })

    const res = await moveReservation(SITE_ID, RES_ID, ['new-item-1'])
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toMatch(/already reserved/i)
    // Guard ran; prisma.reservation.update must NOT have been called
    expect(vi.mocked(prisma.reservation.update)).not.toHaveBeenCalled()
  })

  it('rejects move for departed reservation', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue({
      siteId: SITE_ID,
      operationalStatus: 'departed',
    } as any)

    const res = await moveReservation(SITE_ID, RES_ID, ['new-1'])
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toContain('Cannot move')
  })

  it('rejects move for no-show reservation', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue({
      siteId: SITE_ID,
      operationalStatus: 'no-show',
    } as any)

    const res = await moveReservation(SITE_ID, RES_ID, ['new-1'])
    expect(res.status).toBe('error')
  })

  it('rejects when new items not found or inactive', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue({
      siteId: SITE_ID,
      operationalStatus: 'checked-in',
    } as any)
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([{ id: 'new-1' }] as any) // only 1 of 2

    const res = await moveReservation(SITE_ID, RES_ID, ['new-1', 'new-2'])
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toContain('not found or inactive')
  })
})

// ─── Rental Operations ──────────────────────────────────────────────────────

describe('markRentalPickedUp', () => {
  it('transitions reserved -> picked-up', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.rentalBooking.findUnique).mockResolvedValue({
      siteId: SITE_ID,
      operationalStatus: 'reserved',
    } as any)
    vi.mocked(prisma.rentalBooking.update).mockResolvedValue({} as any)

    const res = await markRentalPickedUp(SITE_ID, 'booking-1')
    expect(res.status).toBe('ok')
    expect(vi.mocked(prisma.rentalBooking.update).mock.calls[0][0].data.operationalStatus).toBe('picked-up')
  })

  it('rejects pickup from non-reserved status', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.rentalBooking.findUnique).mockResolvedValue({
      siteId: SITE_ID,
      operationalStatus: 'picked-up',
    } as any)

    const res = await markRentalPickedUp(SITE_ID, 'booking-1')
    expect(res.status).toBe('error')
  })
})

describe('markRentalReturned', () => {
  it('transitions picked-up -> returned', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.rentalBooking.findUnique).mockResolvedValue({
      siteId: SITE_ID,
      operationalStatus: 'picked-up',
    } as any)
    vi.mocked(prisma.rentalBooking.update).mockResolvedValue({} as any)

    const res = await markRentalReturned(SITE_ID, 'booking-1')
    expect(res.status).toBe('ok')
    expect(vi.mocked(prisma.rentalBooking.update).mock.calls[0][0].data.operationalStatus).toBe('returned')
  })

  it('rejects return from reserved status', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.rentalBooking.findUnique).mockResolvedValue({
      siteId: SITE_ID,
      operationalStatus: 'reserved',
    } as any)

    const res = await markRentalReturned(SITE_ID, 'booking-1')
    expect(res.status).toBe('error')
  })
})

// ─── createWalkInRental ─────────────────────────────────────────────────────

describe('createWalkInRental', () => {
  it('calls the rental guard with correct daily pricing data and returns ok', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.rentalItem.findMany).mockResolvedValue([
      { id: 'ri-1', name: 'Surfboard', siteId: SITE_ID, active: true, totalQuantity: 10, pricePerDay: 15, pricePerHour: null },
    ] as any)
    // Guard default: created (success). No aggregate/create calls expected.

    const res = await createWalkInRental({
      siteId: SITE_ID,
      items: [{ rentalItemId: 'ri-1', quantity: 2 }],
      durationType: 'days',
      paymentType: 'cash',
    })

    expect(res.status).toBe('ok')
    expect(res.bookingIds).toEqual(['rb1']) // from guard mock

    // Guard must be called with correctly-priced booking data
    const [guardInputs] = mockRentalGuard.mock.calls[0]
    expect(guardInputs).toHaveLength(1)
    expect(guardInputs[0].rentalItemId).toBe('ri-1')
    expect(guardInputs[0].status).toBe('paid-in-cash')
    expect(guardInputs[0].operationalStatus).toBe('picked-up')
    expect(guardInputs[0].quantity).toBe(2)

    // prisma.rentalBooking.create must NOT be called directly — guard owns creation
    expect(vi.mocked(prisma.rentalBooking.create)).not.toHaveBeenCalled()
  })

  it('sets zero totalPrice and paymentAmount for free walk-in rental', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.rentalItem.findMany).mockResolvedValue([
      { id: 'ri-1', name: 'Kayak', siteId: SITE_ID, active: true, totalQuantity: 10, pricePerDay: 15, pricePerHour: null },
    ] as any)

    await createWalkInRental({
      siteId: SITE_ID,
      items: [{ rentalItemId: 'ri-1', quantity: 1 }],
      durationType: 'days',
      paymentType: 'free',
    })

    const [guardInputs] = mockRentalGuard.mock.calls[0]
    expect(guardInputs[0].totalPrice).toBe(0)
    expect(guardInputs[0].paymentAmount).toBe(0)
  })

  it('rejects when rental item not found or inactive (pre-guard check)', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.rentalItem.findMany).mockResolvedValue([]) // none found

    const res = await createWalkInRental({
      siteId: SITE_ID,
      items: [{ rentalItemId: 'ri-missing', quantity: 1 }],
      durationType: 'days',
      paymentType: 'cash',
    })

    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toContain('not available')
    // Guard must NOT be called — rejected before reaching it
    expect(mockRentalGuard).not.toHaveBeenCalled()
  })

  it('rejects when guard returns unavailable (quantity race closed)', async () => {
    // This is the bug createRentalBookingsWithGuard fixes: the old code checked
    // availability then created in a loop — two concurrent requests could both
    // pass the check and both create, exceeding totalQuantity. The guard
    // collapses check + create into one transaction so the second request sees
    // the first one's bookings before writing.
    authenticateAsOwner()
    vi.mocked(prisma.rentalItem.findMany).mockResolvedValue([
      { id: 'ri-1', name: 'Paddle Board', siteId: SITE_ID, active: true, totalQuantity: 3, pricePerDay: 10, pricePerHour: null },
    ] as any)
    mockRentalGuard.mockResolvedValueOnce({ outcome: 'unavailable', rentalItemId: 'ri-1' })

    const res = await createWalkInRental({
      siteId: SITE_ID,
      items: [{ rentalItemId: 'ri-1', quantity: 2 }],
      durationType: 'days',
      paymentType: 'cash',
    })

    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toContain('available')
    expect(res.errors?.[0]).toContain('Paddle Board')
    // prisma.rentalBooking.create must NOT have been called
    expect(vi.mocked(prisma.rentalBooking.create)).not.toHaveBeenCalled()
  })

  it('passes correct paymentAmount (= totalPrice) to guard for cash walk-in', async () => {
    // paymentAmount === totalPrice for walk-in cash rentals — the operator
    // collects the full price in cash, so the amounts must match for reconciliation
    // and downstream invoicing to work correctly.
    authenticateAsOwner()
    vi.mocked(prisma.rentalItem.findMany).mockResolvedValue([
      { id: 'ri-1', name: 'Snorkel', siteId: SITE_ID, active: true, totalQuantity: 10, pricePerDay: 20, pricePerHour: null },
    ] as any)

    const res = await createWalkInRental({
      siteId: SITE_ID,
      items: [{ rentalItemId: 'ri-1', quantity: 3 }],
      durationType: 'days',
      paymentType: 'cash',
    })

    expect(res.status).toBe('ok')

    const [guardInputs] = mockRentalGuard.mock.calls[0]
    // totalPrice: 20 (pricePerDay) * 1 (day) * 3 (quantity) = 60
    expect(guardInputs[0].totalPrice).toBe(60)
    expect(guardInputs[0].paymentAmount).toBe(60)
  })

  it('records a TillEntry per booking when recordCashSettlement=true (genuine cash)', async () => {
    // Genuine cash: recordCashSettlement=true, paymentType='cash' → recordSettlement
    // called for each created booking with the booking's paymentAmount (not a literal).
    // Guard returns two booking ids → two settlements recorded.
    authenticateAsOwner()
    mockRentalGuard.mockResolvedValueOnce({ outcome: 'created', bookingIds: ['rb-a', 'rb-b'] })
    vi.mocked(prisma.rentalItem.findMany).mockResolvedValue([
      { id: 'ri-1', name: 'Surfboard', siteId: SITE_ID, active: true, totalQuantity: 10, pricePerDay: 30, pricePerHour: null },
      { id: 'ri-2', name: 'Kayak', siteId: SITE_ID, active: true, totalQuantity: 5, pricePerDay: 25, pricePerHour: null },
    ] as any)

    const res = await createWalkInRental({
      siteId: SITE_ID,
      items: [
        { rentalItemId: 'ri-1', quantity: 1 }, // 30 * 1 * 1 = 30
        { rentalItemId: 'ri-2', quantity: 2 }, // 25 * 1 * 2 = 50
      ],
      durationType: 'days',
      paymentType: 'cash',
      recordCashSettlement: true,
    })

    expect(res.status).toBe('ok')

    const mockRecord = vi.mocked(recordSettlement)
    expect(mockRecord).toHaveBeenCalledTimes(2)
    // First booking (rb-a) → 30; second booking (rb-b) → 50
    expect(mockRecord).toHaveBeenCalledWith(
      expect.objectContaining({ siteId: SITE_ID, rentalBookingId: 'rb-a', amount: 30 }),
    )
    expect(mockRecord).toHaveBeenCalledWith(
      expect.objectContaining({ siteId: SITE_ID, rentalBookingId: 'rb-b', amount: 50 }),
    )
  })

  it('does NOT record a TillEntry when recordCashSettlement is omitted (Card / QR path)', async () => {
    // The Card(QR) path creates bookings as cash so paymentAmount is persisted,
    // then calls collectRentalPayment (Mollie) separately. If a TillEntry were
    // recorded here it would double-count the transaction.
    // CreateRentalModal passes recordCashSettlement: false (via wirePaymentType='cash')
    // when paymentType === 'card'; omitting the flag must also skip settlement.
    authenticateAsOwner()
    vi.mocked(prisma.rentalItem.findMany).mockResolvedValue([
      { id: 'ri-1', name: 'Paddleboard', siteId: SITE_ID, active: true, totalQuantity: 5, pricePerDay: 20, pricePerHour: null },
    ] as any)

    const res = await createWalkInRental({
      siteId: SITE_ID,
      items: [{ rentalItemId: 'ri-1', quantity: 1 }],
      durationType: 'days',
      paymentType: 'cash',
      // recordCashSettlement omitted — default false (Card path omits it)
    })

    expect(res.status).toBe('ok')
    expect(vi.mocked(recordSettlement)).not.toHaveBeenCalled()
  })

  it('does NOT record a TillEntry for a free walk-in rental', async () => {
    // Free bookings have paymentAmount 0 — nothing to put in the drawer.
    authenticateAsOwner()
    vi.mocked(prisma.rentalItem.findMany).mockResolvedValue([
      { id: 'ri-1', name: 'Kayak', siteId: SITE_ID, active: true, totalQuantity: 10, pricePerDay: 15, pricePerHour: null },
    ] as any)

    await createWalkInRental({
      siteId: SITE_ID,
      items: [{ rentalItemId: 'ri-1', quantity: 1 }],
      durationType: 'days',
      paymentType: 'free',
      recordCashSettlement: true, // would be no-op even if passed for free
    })

    expect(vi.mocked(recordSettlement)).not.toHaveBeenCalled()
  })

  it('calls processCashRentalBooking for each booking when recordCashSettlement=true', async () => {
    // Genuine cash rental: a PARTNER-only receipt must be issued per booking
    // so the sale has an audit trail. processCashRentalBooking is idempotent.
    authenticateAsOwner()
    mockRentalGuard.mockResolvedValueOnce({ outcome: 'created', bookingIds: ['rb-x', 'rb-y'] })
    vi.mocked(prisma.rentalItem.findMany).mockResolvedValue([
      { id: 'ri-1', name: 'Surfboard', siteId: SITE_ID, active: true, totalQuantity: 10, pricePerDay: 30, pricePerHour: null },
      { id: 'ri-2', name: 'Kayak', siteId: SITE_ID, active: true, totalQuantity: 5, pricePerDay: 25, pricePerHour: null },
    ] as any)

    const res = await createWalkInRental({
      siteId: SITE_ID,
      items: [
        { rentalItemId: 'ri-1', quantity: 1 },
        { rentalItemId: 'ri-2', quantity: 1 },
      ],
      durationType: 'days',
      paymentType: 'cash',
      recordCashSettlement: true,
    })

    expect(res.status).toBe('ok')
    expect(mockProcessCashRentalBooking).toHaveBeenCalledTimes(2)
    expect(mockProcessCashRentalBooking).toHaveBeenCalledWith('rb-x')
    expect(mockProcessCashRentalBooking).toHaveBeenCalledWith('rb-y')
  })

  it('does NOT call processCashRentalBooking when recordCashSettlement is omitted (Card/QR path)', async () => {
    // Card(QR) path: createWalkInRental is called with paymentType='cash' but
    // recordCashSettlement=false; the booking is later collected via Mollie which
    // creates a PARTNER+PLATFORM invoice. Issuing a cash receipt here would
    // produce a duplicate invoice for the booking.
    authenticateAsOwner()
    vi.mocked(prisma.rentalItem.findMany).mockResolvedValue([
      { id: 'ri-1', name: 'Paddleboard', siteId: SITE_ID, active: true, totalQuantity: 5, pricePerDay: 20, pricePerHour: null },
    ] as any)

    await createWalkInRental({
      siteId: SITE_ID,
      items: [{ rentalItemId: 'ri-1', quantity: 1 }],
      durationType: 'days',
      paymentType: 'cash',
      // recordCashSettlement omitted — Card(QR) path
    })

    expect(mockProcessCashRentalBooking).not.toHaveBeenCalled()
  })

  it('does NOT fail if processCashRentalBooking throws (non-blocking receipt)', async () => {
    // Receipt failure must not roll back or error the rental creation.
    authenticateAsOwner()
    mockRentalGuard.mockResolvedValueOnce({ outcome: 'created', bookingIds: ['rb-fail'] })
    vi.mocked(prisma.rentalItem.findMany).mockResolvedValue([
      { id: 'ri-1', name: 'Kayak', siteId: SITE_ID, active: true, totalQuantity: 10, pricePerDay: 15, pricePerHour: null },
    ] as any)
    mockProcessCashRentalBooking.mockRejectedValueOnce(new Error('invoice service down'))

    const res = await createWalkInRental({
      siteId: SITE_ID,
      items: [{ rentalItemId: 'ri-1', quantity: 1 }],
      durationType: 'days',
      paymentType: 'cash',
      recordCashSettlement: true,
    })

    expect(res.status).toBe('ok')
  })
})

// ─── applyToPair = false — single-seat mode ─────────────────────────────────

describe('reserveItem with applyToPair = false', () => {
  it('does NOT look up or add the group members when applyToPair is false', async () => {
    authenticateAsOwner()

    const res = await reserveItem(SITE_ID, ITEM_ID, 'Solo guest', undefined, undefined, undefined, false)
    expect(res.status).toBe('ok')

    // getGroupMemberIds calls inventoryItem.findUnique — must NOT be called
    expect(vi.mocked(prisma.inventoryItem.findUnique)).not.toHaveBeenCalled()

    const guardCall = mockGuard.mock.calls[0][0]
    expect(guardCall.itemIds).toEqual([ITEM_ID])
    expect(vi.mocked(prisma.reservation.create)).not.toHaveBeenCalled()
  })

  it('still adds group member when applyToPair is true (default behavior preserved)', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.inventoryItem.findUnique).mockResolvedValue({
      id: ITEM_ID,
      pairId: 'pair-1',
      sunbedGroupId: 'group-1',
      pairedBy: null,
    } as any)
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([{ id: 'pair-1' }] as any)

    await reserveItem(SITE_ID, ITEM_ID, undefined, undefined, undefined, undefined, true)

    const guardCall = mockGuard.mock.calls[0][0]
    expect(guardCall.itemIds).toEqual([ITEM_ID, 'pair-1'])
  })
})

describe('blockBed with applyToPair = false', () => {
  it('does NOT look up or add group members when applyToPair is false', async () => {
    authenticateAsOwner()

    const res = await blockBed(SITE_ID, ITEM_ID, undefined, undefined, false)
    expect(res.status).toBe('ok')

    expect(vi.mocked(prisma.inventoryItem.findUnique)).not.toHaveBeenCalled()

    const guardCall = mockGuard.mock.calls[0][0]
    expect(guardCall.itemIds).toEqual([ITEM_ID])
    expect(guardCall.operationalStatus).toBe('blocked')
    // blockBed must not call prisma.reservation.create directly
    expect(vi.mocked(prisma.reservation.create)).not.toHaveBeenCalled()
  })

  it('still adds group member when applyToPair is true (default behavior preserved)', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.inventoryItem.findUnique).mockResolvedValue({
      id: ITEM_ID,
      pairId: 'pair-1',
      sunbedGroupId: 'group-1',
      pairedBy: null,
    } as any)
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([{ id: 'pair-1' }] as any)

    await blockBed(SITE_ID, ITEM_ID, undefined, undefined, true)

    const guardCall = mockGuard.mock.calls[0][0]
    expect(guardCall.itemIds).toEqual([ITEM_ID, 'pair-1'])
  })

  it('rejects blocking an already-occupied bed (guard returns conflict)', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.inventoryItem.findUnique).mockResolvedValue(null)
    mockGuard.mockResolvedValueOnce({ outcome: 'conflict', conflictingReservationId: 'existing' })

    const res = await blockBed(SITE_ID, ITEM_ID)
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toMatch(/already occupied or blocked/i)
    expect(vi.mocked(prisma.reservation.create)).not.toHaveBeenCalled()
  })

  it('blocks stickily — passes a far-future out-of-service end date to the guard', async () => {
    authenticateAsOwner()

    await blockBed(SITE_ID, ITEM_ID, undefined, undefined, false)

    const guardCall = mockGuard.mock.calls[0][0]
    // A block is sticky: `to` is far in the future so it survives the daily
    // rollover (overlaps every day) and the cleanup cron (to is never < now)
    // until the operator taps Unblock.
    expect((guardCall.to as Date).getUTCFullYear()).toBe(2999)
  })
})

describe('unreserveItem with applyToPair = false', () => {
  // Regression (track 012): a multiday cash walk-in reads 'expected' on its
  // between-days legs. The single-seat lookup must match a cash walk-in in ANY
  // operational state — constraining to walked-in made unreserve fail with
  // "No walk-in reservation found to release" for the expected leg.
  it('matches a cash walk-in in any operational state — no operationalStatus filter', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findFirst).mockResolvedValue({
      id: RES_ID,
      items: [{ id: ITEM_ID }],
    } as any)
    vi.mocked(prisma.reservation.deleteMany).mockResolvedValue({ count: 1 } as any)

    const res = await unreserveItem(SITE_ID, ITEM_ID, undefined, false)
    expect(res.status).toBe('ok')

    const where = vi.mocked(prisma.reservation.findFirst).mock.calls[0][0]?.where as any
    expect(where.status).toBe('paid-in-cash')
    expect(where.operationalStatus).toBeUndefined()
    expect(where.from).toHaveProperty('lte')
    expect(where.to).toHaveProperty('gte')
    expect(where.items.some.id).toBe(ITEM_ID)
  })

  it('disconnects this item from a 2-item reservation and reduces paymentAmount (till conservation)', async () => {
    authenticateAsOwner()
    // Paid site: item being freed has price 10, partner's item has price 15.
    // Original total would be 25/day; freeing the 10€ seat → remaining 15€ on the reservation.
    vi.mocked(prisma.reservation.findFirst).mockResolvedValue({
      id: RES_ID,
      from: new Date('2026-06-21T00:00:00.000Z'),
      to: new Date('2026-06-21T23:59:59.999Z'),
      items: [{ id: ITEM_ID, price: 10 }, { id: 'pair-1', price: 15 }],
      site: { type: 'paid', price: 20 },
    } as any)
    vi.mocked(prisma.reservation.update).mockResolvedValue({} as any)

    const res = await unreserveItem(SITE_ID, ITEM_ID, undefined, false)
    expect(res.status).toBe('ok')

    // Update called to disconnect AND reduce paymentAmount — not deleteMany.
    const updateCall = vi.mocked(prisma.reservation.update).mock.calls[0][0]
    expect(updateCall).toMatchObject({
      where: { id: RES_ID },
      data: {
        paymentAmount: 15, // remaining 1 seat × 15€ × 1 day
        items: { disconnect: [{ id: ITEM_ID }] },
      },
    })
    expect(vi.mocked(prisma.reservation.deleteMany)).not.toHaveBeenCalled()
  })

  it('disconnect on a free-site walk-in sets paymentAmount to 0 (not computed)', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findFirst).mockResolvedValue({
      id: RES_ID,
      from: new Date('2026-06-21T00:00:00.000Z'),
      to: new Date('2026-06-21T23:59:59.999Z'),
      items: [{ id: ITEM_ID, price: null }, { id: 'pair-1', price: null }],
      site: { type: 'free', price: null },
    } as any)
    vi.mocked(prisma.reservation.update).mockResolvedValue({} as any)

    const res = await unreserveItem(SITE_ID, ITEM_ID, undefined, false)
    expect(res.status).toBe('ok')

    const updateCall = vi.mocked(prisma.reservation.update).mock.calls[0][0]
    expect((updateCall.data as any).paymentAmount).toBe(0)
  })

  it('deletes the whole reservation when it has only 1 item', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findFirst).mockResolvedValue({
      id: RES_ID,
      items: [{ id: ITEM_ID }],
    } as any)
    vi.mocked(prisma.reservation.deleteMany).mockResolvedValue({ count: 1 } as any)

    const res = await unreserveItem(SITE_ID, ITEM_ID, undefined, false)
    expect(res.status).toBe('ok')

    expect(vi.mocked(prisma.reservation.update)).not.toHaveBeenCalled()
    expect(vi.mocked(prisma.reservation.deleteMany)).toHaveBeenCalledWith({
      where: { id: RES_ID, siteId: SITE_ID },
    })
  })

  it('returns error when no walk-in reservation found (single mode)', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findFirst).mockResolvedValue(null)

    const res = await unreserveItem(SITE_ID, ITEM_ID, undefined, false)
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toMatch(/no walk-in reservation found/i)
  })

  it('pair mode (true) still uses deleteMany to free both seats', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findMany).mockResolvedValue([{ id: RES_ID } as any])
    vi.mocked(prisma.reservation.deleteMany).mockResolvedValue({ count: 1 } as any)

    const res = await unreserveItem(SITE_ID, ITEM_ID, undefined, true)
    expect(res.status).toBe('ok')

    expect(vi.mocked(prisma.reservation.deleteMany)).toHaveBeenCalled()
    expect(vi.mocked(prisma.reservation.update)).not.toHaveBeenCalled()
  })
})

// ─── unreserveItem — void settlements ─────────────────────────────────────

describe('unreserveItem void settlements', () => {
  // applyToPair=true (Group/pair mode) — whole reservation delete

  it('pair mode: voids settlements for each matched reservation before deleteMany when voidSettlements=true', async () => {
    authenticateAsOwner()
    // findMany returns the reservation ids that will be deleted
    vi.mocked(prisma.reservation.findMany).mockResolvedValue([{ id: RES_ID } as any])
    vi.mocked(prisma.reservation.deleteMany).mockResolvedValue({ count: 1 } as any)

    const res = await unreserveItem(SITE_ID, ITEM_ID, undefined, true, true)
    expect(res.status).toBe('ok')

    // voidSettlementsForReservation called with the matched reservation id
    expect(vi.mocked(voidSettlementsForReservation)).toHaveBeenCalledWith(RES_ID)
    // delete still happens after voiding
    expect(vi.mocked(prisma.reservation.deleteMany)).toHaveBeenCalled()
  })

  it('pair mode: does NOT void settlements when voidSettlements=false (cash retained)', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findMany).mockResolvedValue([{ id: RES_ID } as any])
    vi.mocked(prisma.reservation.deleteMany).mockResolvedValue({ count: 1 } as any)

    const res = await unreserveItem(SITE_ID, ITEM_ID, undefined, true, false)
    expect(res.status).toBe('ok')

    expect(vi.mocked(voidSettlementsForReservation)).not.toHaveBeenCalled()
    expect(vi.mocked(prisma.reservation.deleteMany)).toHaveBeenCalled()
  })

  // applyToPair=false, single-item reservation — whole delete path

  it('single mode, 1-item reservation: voids settlements before deleteMany when voidSettlements=true', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findFirst).mockResolvedValue({
      id: RES_ID,
      from: new Date('2026-06-21T00:00:00.000Z'),
      to: new Date('2026-06-21T23:59:59.999Z'),
      items: [{ id: ITEM_ID, price: 10 }],
      site: { type: 'paid', price: 10 },
    } as any)
    vi.mocked(prisma.reservation.deleteMany).mockResolvedValue({ count: 1 } as any)

    const res = await unreserveItem(SITE_ID, ITEM_ID, undefined, false, true)
    expect(res.status).toBe('ok')

    // void called before delete (order: void → deleteMany)
    const voidCall = vi.mocked(voidSettlementsForReservation).mock.invocationCallOrder[0]
    const deleteCall = vi.mocked(prisma.reservation.deleteMany).mock.invocationCallOrder[0]
    expect(voidCall).toBeLessThan(deleteCall!)
    expect(vi.mocked(voidSettlementsForReservation)).toHaveBeenCalledWith(RES_ID)
  })

  it('single mode, 1-item reservation: does NOT void when voidSettlements=false', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findFirst).mockResolvedValue({
      id: RES_ID,
      from: new Date('2026-06-21T00:00:00.000Z'),
      to: new Date('2026-06-21T23:59:59.999Z'),
      items: [{ id: ITEM_ID, price: 10 }],
      site: { type: 'paid', price: 10 },
    } as any)
    vi.mocked(prisma.reservation.deleteMany).mockResolvedValue({ count: 1 } as any)

    const res = await unreserveItem(SITE_ID, ITEM_ID, undefined, false, false)
    expect(res.status).toBe('ok')

    expect(vi.mocked(voidSettlementsForReservation)).not.toHaveBeenCalled()
  })

  // applyToPair=false, multi-item reservation — disconnect path, never voids

  it('single mode, 2-item reservation: NEVER voids even when voidSettlements=true (disconnect path)', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findFirst).mockResolvedValue({
      id: RES_ID,
      from: new Date('2026-06-21T00:00:00.000Z'),
      to: new Date('2026-06-21T23:59:59.999Z'),
      items: [{ id: ITEM_ID, price: 10 }, { id: 'pair-1', price: 15 }],
      site: { type: 'paid', price: 20 },
    } as any)
    vi.mocked(prisma.reservation.update).mockResolvedValue({} as any)

    const res = await unreserveItem(SITE_ID, ITEM_ID, undefined, false, true)
    expect(res.status).toBe('ok')

    // Disconnect happened, NOT delete
    expect(vi.mocked(prisma.reservation.update)).toHaveBeenCalled()
    expect(vi.mocked(prisma.reservation.deleteMany)).not.toHaveBeenCalled()
    // Settlement must NOT be voided — it belongs to the remaining seats
    expect(vi.mocked(voidSettlementsForReservation)).not.toHaveBeenCalled()
  })
})

// ─── Pool Seat Actions ──────────────────────────────────────────────────────

describe('createPoolSeat', () => {
  it('creates first pool seat for parcel with number parcel*10000+9901', async () => {
    authenticateAsOwner()
    // No existing pool seats in the band
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([])
    vi.mocked(prisma.inventoryItem.create).mockResolvedValue({} as any)

    const res = await createPoolSeat(SITE_ID, 1)
    expect(res.status).toBe('ok')

    const createCall = vi.mocked(prisma.inventoryItem.create).mock.calls[0][0]
    expect(createCall.data.number).toBe(19901) // parcel 1: 1*10000 + 9900 + 1
    expect(createCall.data.status).toBe('pool')
    expect(createCall.data.group).toBe(1)
    expect(createCall.data.locationLat).toBe('0')
    expect(createCall.data.locationLng).toBe('0')
    expect(createCall.data.siteId).toBe(SITE_ID)
  })

  it('computes next seq from max existing pool number', async () => {
    authenticateAsOwner()
    // Two existing seats: 19901 and 19902 (seq 1 and 2)
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([
      { number: 19902 }, // highest first (orderBy: number desc)
      { number: 19901 },
    ] as any)
    vi.mocked(prisma.inventoryItem.create).mockResolvedValue({} as any)

    const res = await createPoolSeat(SITE_ID, 1)
    expect(res.status).toBe('ok')

    const createCall = vi.mocked(prisma.inventoryItem.create).mock.calls[0][0]
    expect(createCall.data.number).toBe(19903) // seq 3
  })

  it('uses parcel-scoped band — parcel 2 starts at 29901', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([])
    vi.mocked(prisma.inventoryItem.create).mockResolvedValue({} as any)

    const res = await createPoolSeat(SITE_ID, 2)
    expect(res.status).toBe('ok')

    const createCall = vi.mocked(prisma.inventoryItem.create).mock.calls[0][0]
    expect(createCall.data.number).toBe(29901) // parcel 2: 2*10000 + 9900 + 1
    expect(createCall.data.group).toBe(2)
  })

  it('rejects invalid parcel number', async () => {
    authenticateAsOwner()
    const res = await createPoolSeat(SITE_ID, 0)
    expect(res.status).toBe('error')
    expect(vi.mocked(prisma.inventoryItem.create)).not.toHaveBeenCalled()
  })

  it('rejects unauthenticated caller', async () => {
    const res = await createPoolSeat(SITE_ID, 1)
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authenticated')
    expect(vi.mocked(prisma.inventoryItem.create)).not.toHaveBeenCalled()
  })

  it('rejects non-owner', async () => {
    authenticateAsNonOwner()
    const res = await createPoolSeat(SITE_ID, 1)
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authorized')
    expect(vi.mocked(prisma.inventoryItem.create)).not.toHaveBeenCalled()
  })
})

describe('deletePoolSeat', () => {
  it('deletes a free pool seat successfully', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.inventoryItem.findUnique).mockResolvedValue({
      siteId: SITE_ID,
      status: 'pool',
      number: 19901,
    } as any)
    vi.mocked(prisma.reservation.findFirst).mockResolvedValue(null) // no active reservation
    vi.mocked(prisma.inventoryItem.delete).mockResolvedValue({} as any)

    const res = await deletePoolSeat(SITE_ID, ITEM_ID)
    expect(res.status).toBe('ok')
    expect(vi.mocked(prisma.inventoryItem.delete)).toHaveBeenCalledWith({ where: { id: ITEM_ID } })
  })

  it('rejects when pool seat has an active reservation (occupied)', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.inventoryItem.findUnique).mockResolvedValue({
      siteId: SITE_ID,
      status: 'pool',
      number: 19901,
    } as any)
    vi.mocked(prisma.reservation.findFirst).mockResolvedValue({ id: RES_ID } as any) // occupied

    const res = await deletePoolSeat(SITE_ID, ITEM_ID)
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toMatch(/release the seat/i)
    expect(vi.mocked(prisma.inventoryItem.delete)).not.toHaveBeenCalled()
  })

  it('rejects deletion of a non-pool item (regular sunbed)', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.inventoryItem.findUnique).mockResolvedValue({
      siteId: SITE_ID,
      status: 'active', // not a pool seat
      number: 10101,
    } as any)

    const res = await deletePoolSeat(SITE_ID, ITEM_ID)
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toMatch(/not a pool seat/i)
    expect(vi.mocked(prisma.inventoryItem.delete)).not.toHaveBeenCalled()
  })

  it('rejects when item not found or belongs to different site', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.inventoryItem.findUnique).mockResolvedValue({
      siteId: 'other-site',
      status: 'pool',
      number: 19901,
    } as any)

    const res = await deletePoolSeat(SITE_ID, ITEM_ID)
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Item not found')
    expect(vi.mocked(prisma.inventoryItem.delete)).not.toHaveBeenCalled()
  })

  it('rejects unauthenticated caller', async () => {
    const res = await deletePoolSeat(SITE_ID, ITEM_ID)
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authenticated')
  })
})

describe('unblockBed with applyToPair = false', () => {
  it('disconnects this item from a 2-item block reservation (partner stays blocked)', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findFirst).mockResolvedValue({
      id: RES_ID,
      items: [{ id: ITEM_ID }, { id: 'pair-1' }],
    } as any)
    vi.mocked(prisma.reservation.update).mockResolvedValue({} as any)

    const res = await unblockBed(SITE_ID, ITEM_ID, undefined, false)
    expect(res.status).toBe('ok')

    expect(vi.mocked(prisma.reservation.update)).toHaveBeenCalledWith({
      where: { id: RES_ID },
      data: { items: { disconnect: [{ id: ITEM_ID }] } },
    })
    expect(vi.mocked(prisma.reservation.deleteMany)).not.toHaveBeenCalled()
  })

  it('deletes the whole block reservation when it has only 1 item', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findFirst).mockResolvedValue({
      id: RES_ID,
      items: [{ id: ITEM_ID }],
    } as any)
    vi.mocked(prisma.reservation.deleteMany).mockResolvedValue({ count: 1 } as any)

    const res = await unblockBed(SITE_ID, ITEM_ID, undefined, false)
    expect(res.status).toBe('ok')

    expect(vi.mocked(prisma.reservation.update)).not.toHaveBeenCalled()
    expect(vi.mocked(prisma.reservation.deleteMany)).toHaveBeenCalledWith({
      where: { id: RES_ID, siteId: SITE_ID },
    })
  })

  it('returns ok and does nothing when no block reservation found (single mode)', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findFirst).mockResolvedValue(null)

    const res = await unblockBed(SITE_ID, ITEM_ID, undefined, false)
    expect(res.status).toBe('ok')

    expect(vi.mocked(prisma.reservation.update)).not.toHaveBeenCalled()
    expect(vi.mocked(prisma.reservation.deleteMany)).not.toHaveBeenCalled()
  })

  it('pair mode (true) still uses deleteMany to free both seats', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.deleteMany).mockResolvedValue({ count: 1 } as any)

    const res = await unblockBed(SITE_ID, ITEM_ID, undefined, true)
    expect(res.status).toBe('ok')

    expect(vi.mocked(prisma.reservation.deleteMany)).toHaveBeenCalled()
    expect(vi.mocked(prisma.reservation.update)).not.toHaveBeenCalled()
  })
})

// ─── addSeatToGroup ──────────────────────────────────────────────────────────

describe('addSeatToGroup', () => {
  it('rejects unauthenticated caller', async () => {
    const res = await addSeatToGroup(SITE_ID, ITEM_ID)
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authenticated')
    expect(vi.mocked(prisma.inventoryItem.create)).not.toHaveBeenCalled()
  })

  it('rejects non-owner', async () => {
    authenticateAsNonOwner()
    const res = await addSeatToGroup(SITE_ID, ITEM_ID)
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authorized')
    expect(vi.mocked(prisma.inventoryItem.create)).not.toHaveBeenCalled()
  })

  it('rejects when item not found or belongs to a different site', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.inventoryItem.findUnique).mockResolvedValue(null)

    const res = await addSeatToGroup(SITE_ID, ITEM_ID)
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Item not found')
  })

  it('rejects when anchor is a FREE pool seat (no group to add to)', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.inventoryItem.findUnique).mockResolvedValue({
      siteId: SITE_ID,
      group: 1,
      number: 19901,
      status: 'pool',
      sunbedGroupId: null,
      pairId: null,
      pairedBy: null,
    } as any)

    const res = await addSeatToGroup(SITE_ID, ITEM_ID)
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toMatch(/pool seat/i)
  })

  it('allows a GROUP-EXTRA pool seat as anchor — adds another extra to the same group', async () => {
    authenticateAsOwner()
    // A group extra: status 'pool' but already linked to a SunbedGroup.
    vi.mocked(prisma.inventoryItem.findUnique).mockResolvedValue({
      siteId: SITE_ID,
      group: 1,
      number: 19901,
      status: 'pool',
      sunbedGroupId: 'group-existing',
      pairId: null,
      pairedBy: null,
    } as any)
    // nextPoolNumber: one existing pool seat in the band (the anchor) → next is 19902
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([{ number: 19901 }] as any)
    vi.mocked(prisma.inventoryItem.create).mockResolvedValue({ id: 'new-seat-2' } as any)

    const res = await addSeatToGroup(SITE_ID, ITEM_ID)
    expect(res.status).toBe('ok')
    // Reuses the anchor's group, never creates a new SunbedGroup.
    expect(vi.mocked(prisma.sunbedGroup.create)).not.toHaveBeenCalled()
    const createCall = vi.mocked(prisma.inventoryItem.create).mock.calls[0][0]
    expect(createCall.data.sunbedGroupId).toBe('group-existing')
    expect(createCall.data.status).toBe('pool')
  })

  it('uses existing sunbedGroupId without creating a new SunbedGroup', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.inventoryItem.findUnique).mockResolvedValue({
      siteId: SITE_ID,
      group: 1,
      number: 10101,
      status: 'active',
      sunbedGroupId: 'group-existing',
      pairId: null,
      pairedBy: null,
    } as any)
    // nextPoolNumber: no existing pool seats in band
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([])
    vi.mocked(prisma.inventoryItem.create).mockResolvedValue({ id: 'new-seat-1' } as any)

    const res = await addSeatToGroup(SITE_ID, ITEM_ID)
    expect(res.status).toBe('ok')

    // No SunbedGroup.create should have been called
    expect(vi.mocked(prisma.sunbedGroup.create)).not.toHaveBeenCalled()

    const createCall = vi.mocked(prisma.inventoryItem.create).mock.calls[0][0]
    expect(createCall.data.sunbedGroupId).toBe('group-existing')
    expect(createCall.data.status).toBe('pool')
    expect(createCall.data.number).toBe(19901) // parcel 1 first pool seat
    expect(createCall.data.locationLat).toBe('0')
    expect(createCall.data.locationLng).toBe('0')
    expect(createCall.data.schematicX).toBeNull()
    expect(createCall.data.schematicY).toBeNull()
  })

  it('self-heals when anchor has pairId: creates SunbedGroup and updates anchor + pair partner', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.inventoryItem.findUnique).mockResolvedValue({
      siteId: SITE_ID,
      group: 2,
      number: 20101,
      status: 'active',
      sunbedGroupId: null,
      pairId: 'pair-item-1',
      pairedBy: null,
    } as any)
    // nextPoolNumber: no existing pool seats for parcel 2
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([])
    vi.mocked(prisma.sunbedGroup.create).mockResolvedValue({ id: 'group-new' } as any)
    vi.mocked(prisma.inventoryItem.update).mockResolvedValue({} as any)
    vi.mocked(prisma.inventoryItem.create).mockResolvedValue({ id: 'new-seat-2' } as any)

    const res = await addSeatToGroup(SITE_ID, ITEM_ID)
    expect(res.status).toBe('ok')

    // A new SunbedGroup must have been created
    expect(vi.mocked(prisma.sunbedGroup.create)).toHaveBeenCalledWith({ data: { siteId: SITE_ID } })

    // Both the anchor and its pairId partner must have been updated
    const updateCalls = vi.mocked(prisma.inventoryItem.update).mock.calls
    const updatedIds = updateCalls.map(c => (c[0] as any).where.id)
    expect(updatedIds).toContain(ITEM_ID)
    expect(updatedIds).toContain('pair-item-1')
    const updatedGroupIds = updateCalls.map(c => (c[0] as any).data.sunbedGroupId)
    expect(updatedGroupIds).toEqual(['group-new', 'group-new'])

    // Extra seat must be created in parcel 2's pool band
    const createCall = vi.mocked(prisma.inventoryItem.create).mock.calls[0][0]
    expect(createCall.data.number).toBe(29901) // parcel 2 first pool seat
    expect(createCall.data.sunbedGroupId).toBe('group-new')
    expect(createCall.data.group).toBe(2)
  })

  it('self-heals when anchor has pairedBy (back-ref): updates back-ref partner', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.inventoryItem.findUnique).mockResolvedValue({
      siteId: SITE_ID,
      group: 1,
      number: 10102,
      status: 'active',
      sunbedGroupId: null,
      pairId: null,
      pairedBy: { id: 'pair-primary-1' },
    } as any)
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([])
    vi.mocked(prisma.sunbedGroup.create).mockResolvedValue({ id: 'group-backref' } as any)
    vi.mocked(prisma.inventoryItem.update).mockResolvedValue({} as any)
    vi.mocked(prisma.inventoryItem.create).mockResolvedValue({ id: 'new-seat-3' } as any)

    const res = await addSeatToGroup(SITE_ID, ITEM_ID)
    expect(res.status).toBe('ok')

    const updateCalls = vi.mocked(prisma.inventoryItem.update).mock.calls
    const updatedIds = updateCalls.map(c => (c[0] as any).where.id)
    expect(updatedIds).toContain(ITEM_ID)
    expect(updatedIds).toContain('pair-primary-1')
  })

  it('creates the extra seat with correct band number for sequential seats', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.inventoryItem.findUnique).mockResolvedValue({
      siteId: SITE_ID,
      group: 1,
      number: 10101,
      status: 'active',
      sunbedGroupId: 'group-existing',
      pairId: null,
      pairedBy: null,
    } as any)
    // Two seats already in the band: seq 1 and 2
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([
      { number: 19902 },
      { number: 19901 },
    ] as any)
    vi.mocked(prisma.inventoryItem.create).mockResolvedValue({ id: 'new-seat-4' } as any)

    const res = await addSeatToGroup(SITE_ID, ITEM_ID)
    expect(res.status).toBe('ok')

    const createCall = vi.mocked(prisma.inventoryItem.create).mock.calls[0][0]
    expect(createCall.data.number).toBe(19903) // seq 3
  })

  it('rejects when pool band is exhausted (seq > 99)', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.inventoryItem.findUnique).mockResolvedValue({
      siteId: SITE_ID,
      group: 1,
      number: 10101,
      status: 'active',
      sunbedGroupId: 'group-existing',
      pairId: null,
      pairedBy: null,
    } as any)
    // Highest existing is seq 99 (number 19999)
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([
      { number: 19999 },
    ] as any)

    const res = await addSeatToGroup(SITE_ID, ITEM_ID)
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toMatch(/maximum pool seats/i)
    expect(vi.mocked(prisma.inventoryItem.create)).not.toHaveBeenCalled()
  })
})

// ─── removeGroupSeat ─────────────────────────────────────────────────────────

describe('removeGroupSeat', () => {
  it('rejects unauthenticated caller', async () => {
    const res = await removeGroupSeat(SITE_ID, ITEM_ID)
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authenticated')
    expect(vi.mocked(prisma.inventoryItem.delete)).not.toHaveBeenCalled()
  })

  it('rejects a plain pool seat that has no sunbedGroupId', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.inventoryItem.findUnique).mockResolvedValue({
      siteId: SITE_ID,
      status: 'pool',
      sunbedGroupId: null,
    } as any)

    const res = await removeGroupSeat(SITE_ID, ITEM_ID)
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toMatch(/not a group extra seat/i)
    expect(vi.mocked(prisma.inventoryItem.delete)).not.toHaveBeenCalled()
  })

  it('rejects a regular (non-pool) active item even with a sunbedGroupId', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.inventoryItem.findUnique).mockResolvedValue({
      siteId: SITE_ID,
      status: 'active',
      sunbedGroupId: 'group-1',
    } as any)

    const res = await removeGroupSeat(SITE_ID, ITEM_ID)
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toMatch(/not a group extra seat/i)
    expect(vi.mocked(prisma.inventoryItem.delete)).not.toHaveBeenCalled()
  })

  it('rejects when item not found or belongs to different site', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.inventoryItem.findUnique).mockResolvedValue({
      siteId: 'other-site',
      status: 'pool',
      sunbedGroupId: 'group-1',
    } as any)

    const res = await removeGroupSeat(SITE_ID, ITEM_ID)
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Item not found')
    expect(vi.mocked(prisma.inventoryItem.delete)).not.toHaveBeenCalled()
  })

  it('rejects when the seat has an active reservation today', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.inventoryItem.findUnique).mockResolvedValue({
      siteId: SITE_ID,
      status: 'pool',
      sunbedGroupId: 'group-1',
    } as any)
    vi.mocked(prisma.reservation.findFirst).mockResolvedValue({ id: RES_ID } as any)

    const res = await removeGroupSeat(SITE_ID, ITEM_ID)
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toMatch(/release the seat/i)
    expect(vi.mocked(prisma.inventoryItem.delete)).not.toHaveBeenCalled()
  })

  it('deletes the group extra seat and revalidates when free', async () => {
    const { revalidatePath } = await import('next/cache')
    authenticateAsOwner()
    vi.mocked(prisma.inventoryItem.findUnique).mockResolvedValue({
      siteId: SITE_ID,
      status: 'pool',
      sunbedGroupId: 'group-1',
    } as any)
    vi.mocked(prisma.reservation.findFirst).mockResolvedValue(null) // no active reservation
    vi.mocked(prisma.inventoryItem.delete).mockResolvedValue({} as any)

    const res = await removeGroupSeat(SITE_ID, ITEM_ID)
    expect(res.status).toBe('ok')
    expect(vi.mocked(prisma.inventoryItem.delete)).toHaveBeenCalledWith({ where: { id: ITEM_ID } })
    expect(vi.mocked(revalidatePath)).toHaveBeenCalled()
  })
})

// ─── compBed ────────────────────────────────────────────────────────────────

describe('compBed', () => {
  it('creates a comp reservation with OP_COMP, isComp:true, and paymentAmount:0', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.inventoryItem.findUnique).mockResolvedValue(null) // no pair

    const res = await compBed(SITE_ID, ITEM_ID)
    expect(res.status).toBe('ok')

    const guardCall = mockGuard.mock.calls[0][0]
    expect(guardCall.status).toBe('paid-in-cash')
    expect(guardCall.operationalStatus).toBe('comp')
    expect(guardCall.isComp).toBe(true)
    expect(guardCall.paymentAmount).toBe(0)
    expect(guardCall.itemIds).toEqual([ITEM_ID])
    expect(guardCall.siteId).toBe(SITE_ID)
    // Guard owns the create — no direct prisma.reservation.create
    expect(vi.mocked(prisma.reservation.create)).not.toHaveBeenCalled()
  })

  it('stores guestName and notes when provided', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.inventoryItem.findUnique).mockResolvedValue(null)

    await compBed(SITE_ID, ITEM_ID, undefined, true, 'VIP Guest', 'Staff member')

    const guardCall = mockGuard.mock.calls[0][0]
    expect(guardCall.guestName).toBe('VIP Guest')
    expect(guardCall.internalNotes).toBe('Staff member')
  })

  it('truncates guestName to 200 chars and notes to 500', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.inventoryItem.findUnique).mockResolvedValue(null)

    await compBed(SITE_ID, ITEM_ID, undefined, true, 'A'.repeat(300), 'B'.repeat(600))

    const guardCall = mockGuard.mock.calls[0][0]
    expect(guardCall.guestName).toHaveLength(200)
    expect(guardCall.internalNotes).toHaveLength(500)
  })

  it('expands paired item via SunbedGroup when applyToPair is true', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.inventoryItem.findUnique).mockResolvedValue({
      id: ITEM_ID,
      pairId: null,
      sunbedGroupId: 'group-1',
      pairedBy: null,
    } as any)
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([{ id: 'pair-1' }] as any)

    await compBed(SITE_ID, ITEM_ID)

    const guardCall = mockGuard.mock.calls[0][0]
    expect(guardCall.itemIds).toEqual([ITEM_ID, 'pair-1'])
  })

  it('does NOT expand pair when applyToPair is false', async () => {
    authenticateAsOwner()

    await compBed(SITE_ID, ITEM_ID, undefined, false)
    expect(vi.mocked(prisma.inventoryItem.findUnique)).not.toHaveBeenCalled()

    const guardCall = mockGuard.mock.calls[0][0]
    expect(guardCall.itemIds).toEqual([ITEM_ID])
  })

  it('rejects when the guard returns a conflict', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.inventoryItem.findUnique).mockResolvedValue(null)
    mockGuard.mockResolvedValueOnce({ outcome: 'conflict', conflictingReservationId: 'existing' })

    const res = await compBed(SITE_ID, ITEM_ID)
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toMatch(/already occupied or blocked/i)
    expect(vi.mocked(prisma.reservation.create)).not.toHaveBeenCalled()
  })

  it('rejects unauthenticated caller', async () => {
    const res = await compBed(SITE_ID, ITEM_ID)
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authenticated')
    expect(mockGuard).not.toHaveBeenCalled()
  })

  it('rejects non-owner', async () => {
    authenticateAsNonOwner()
    const res = await compBed(SITE_ID, ITEM_ID)
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authorized')
    expect(mockGuard).not.toHaveBeenCalled()
  })
})

// ─── compBed — multi-day until param ────────────────────────────────────────

describe('compBed — multi-day until param', () => {
  it('falls back to today-only when until is not provided', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.inventoryItem.findUnique).mockResolvedValue(null)

    await compBed(SITE_ID, ITEM_ID)

    const { end: expectedTo } = siteDayBounds({}) // Madrid fallback
    const guardCall = mockGuard.mock.calls[0][0]
    expect((guardCall.to as Date).getTime()).toBe(expectedTo.getTime())
  })

  it('extends `to` to the end of the given until date', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.inventoryItem.findUnique).mockResolvedValue(null)
    const until = dayjs().add(3, 'day').format('YYYY-MM-DD')

    const res = await compBed(SITE_ID, ITEM_ID, undefined, false, undefined, undefined, undefined, until)
    expect(res.status).toBe('ok')

    const expectedTo = siteDayBounds({}, new Date(until + 'T12:00:00.000Z')).end
    const guardCall = mockGuard.mock.calls[0][0]
    expect((guardCall.to as Date).getTime()).toBe(expectedTo.getTime())
  })

  it('rejects an invalid until date', async () => {
    authenticateAsOwner()
    const res = await compBed(SITE_ID, ITEM_ID, undefined, false, undefined, undefined, undefined, 'not-a-date')
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toMatch(/invalid date/i)
    expect(mockGuard).not.toHaveBeenCalled()
  })

  it('rejects until in the past', async () => {
    authenticateAsOwner()
    const past = dayjs().subtract(1, 'day').format('YYYY-MM-DD')
    const res = await compBed(SITE_ID, ITEM_ID, undefined, false, undefined, undefined, undefined, past)
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toMatch(/past/i)
    expect(mockGuard).not.toHaveBeenCalled()
  })

  it('rejects until more than 90 days out', async () => {
    authenticateAsOwner()
    const far = dayjs().add(91, 'day').format('YYYY-MM-DD')
    const res = await compBed(SITE_ID, ITEM_ID, undefined, false, undefined, undefined, undefined, far)
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toMatch(/90 days/i)
    expect(mockGuard).not.toHaveBeenCalled()
  })
})

// ─── uncompBed ───────────────────────────────────────────────────────────────

describe('uncompBed', () => {
  it('pair mode: deletes the whole comp reservation via deleteMany', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.deleteMany).mockResolvedValue({ count: 1 } as any)

    const res = await uncompBed(SITE_ID, ITEM_ID)
    expect(res.status).toBe('ok')

    const deleteCall = vi.mocked(prisma.reservation.deleteMany).mock.calls[0][0]
    const where = deleteCall?.where as any
    expect(where.siteId).toBe(SITE_ID)
    expect(where.operationalStatus).toBe('comp')
    expect(where.items.some.id).toBe(ITEM_ID)
    expect(vi.mocked(prisma.reservation.update)).not.toHaveBeenCalled()
  })

  it('single-seat mode: disconnects this item when reservation has >1 item', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findFirst).mockResolvedValue({
      id: RES_ID,
      items: [{ id: ITEM_ID }, { id: 'pair-1' }],
    } as any)
    vi.mocked(prisma.reservation.update).mockResolvedValue({} as any)

    const res = await uncompBed(SITE_ID, ITEM_ID, undefined, false)
    expect(res.status).toBe('ok')

    expect(vi.mocked(prisma.reservation.update)).toHaveBeenCalledWith({
      where: { id: RES_ID },
      data: { items: { disconnect: [{ id: ITEM_ID }] } },
    })
    expect(vi.mocked(prisma.reservation.deleteMany)).not.toHaveBeenCalled()
  })

  it('single-seat mode: deletes the whole comp reservation when it has only 1 item', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findFirst).mockResolvedValue({
      id: RES_ID,
      items: [{ id: ITEM_ID }],
    } as any)
    vi.mocked(prisma.reservation.deleteMany).mockResolvedValue({ count: 1 } as any)

    const res = await uncompBed(SITE_ID, ITEM_ID, undefined, false)
    expect(res.status).toBe('ok')

    expect(vi.mocked(prisma.reservation.update)).not.toHaveBeenCalled()
    expect(vi.mocked(prisma.reservation.deleteMany)).toHaveBeenCalledWith({
      where: { id: RES_ID, siteId: SITE_ID },
    })
  })

  it('single-seat mode: returns ok and does nothing when no comp reservation found', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findFirst).mockResolvedValue(null)

    const res = await uncompBed(SITE_ID, ITEM_ID, undefined, false)
    expect(res.status).toBe('ok')

    expect(vi.mocked(prisma.reservation.update)).not.toHaveBeenCalled()
    expect(vi.mocked(prisma.reservation.deleteMany)).not.toHaveBeenCalled()
  })

  it('rejects unauthenticated caller', async () => {
    const res = await uncompBed(SITE_ID, ITEM_ID)
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authenticated')
    expect(vi.mocked(prisma.reservation.deleteMany)).not.toHaveBeenCalled()
  })

  it('rejects non-owner', async () => {
    authenticateAsNonOwner()
    const res = await uncompBed(SITE_ID, ITEM_ID)
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authorized')
    expect(vi.mocked(prisma.reservation.deleteMany)).not.toHaveBeenCalled()
  })
})

// ─── holdBed ────────────────────────────────────────────────────────────────

describe('holdBed', () => {
  it('creates a hold with status=held, operationalStatus=expected, paymentAmount=0 and no checkedInAt', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.inventoryItem.findUnique).mockResolvedValue(null) // no pair

    const res = await holdBed(SITE_ID, ITEM_ID)
    expect(res.status).toBe('ok')

    const guardCall = mockGuard.mock.calls[0][0]
    expect(guardCall.status).toBe('held')
    expect(guardCall.operationalStatus).toBe('expected')
    expect(guardCall.paymentAmount).toBe(0)
    // No checkedInAt — the guest hasn't arrived yet
    expect(guardCall).not.toHaveProperty('checkedInAt')
    expect(guardCall.itemIds).toEqual([ITEM_ID])
    expect(guardCall.siteId).toBe(SITE_ID)
    // Guard owns the create — no direct prisma.reservation.create
    expect(vi.mocked(prisma.reservation.create)).not.toHaveBeenCalled()
  })

  it('stores guestName and notes when provided', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.inventoryItem.findUnique).mockResolvedValue(null)

    await holdBed(SITE_ID, ITEM_ID, undefined, true, 'Maria', 'VIP table requested')

    const guardCall = mockGuard.mock.calls[0][0]
    expect(guardCall.guestName).toBe('Maria')
    expect(guardCall.internalNotes).toBe('VIP table requested')
  })

  it('truncates guestName to 200 chars and notes to 500', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.inventoryItem.findUnique).mockResolvedValue(null)

    await holdBed(SITE_ID, ITEM_ID, undefined, true, 'A'.repeat(300), 'B'.repeat(600))

    const guardCall = mockGuard.mock.calls[0][0]
    expect(guardCall.guestName).toHaveLength(200)
    expect(guardCall.internalNotes).toHaveLength(500)
  })

  it('sets from=venue-local-today-start and to=venue-local-today-end (today-only hold)', async () => {
    // With no tz fields in the mock (returns { userId: OWNER_ID }), the action falls
    // back to 'Europe/Madrid'. Compare against siteDayBounds to confirm venue-local anchoring.
    authenticateAsOwner()
    vi.mocked(prisma.inventoryItem.findUnique).mockResolvedValue(null)

    await holdBed(SITE_ID, ITEM_ID)

    const { start: expectedFrom, end: expectedTo } = siteDayBounds({})
    const guardCall = mockGuard.mock.calls[0][0]
    expect((guardCall.from as Date).getTime()).toBe(expectedFrom.getTime())
    expect((guardCall.to as Date).getTime()).toBe(expectedTo.getTime())
  })

  it('expands paired item via SunbedGroup when applyToPair is true (default)', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.inventoryItem.findUnique).mockResolvedValue({
      id: ITEM_ID,
      pairId: null,
      sunbedGroupId: 'group-1',
      pairedBy: null,
    } as any)
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([{ id: 'pair-1' }] as any)

    await holdBed(SITE_ID, ITEM_ID)

    const guardCall = mockGuard.mock.calls[0][0]
    expect(guardCall.itemIds).toEqual([ITEM_ID, 'pair-1'])
  })

  it('does NOT expand pair when applyToPair is false', async () => {
    authenticateAsOwner()

    await holdBed(SITE_ID, ITEM_ID, undefined, false)
    expect(vi.mocked(prisma.inventoryItem.findUnique)).not.toHaveBeenCalled()

    const guardCall = mockGuard.mock.calls[0][0]
    expect(guardCall.itemIds).toEqual([ITEM_ID])
  })

  it('rejects when the guard returns a conflict (bed already occupied)', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.inventoryItem.findUnique).mockResolvedValue(null)
    mockGuard.mockResolvedValueOnce({ outcome: 'conflict', conflictingReservationId: 'existing' })

    const res = await holdBed(SITE_ID, ITEM_ID)
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toMatch(/already occupied or blocked/i)
    expect(vi.mocked(prisma.reservation.create)).not.toHaveBeenCalled()
  })

  it('rejects unauthenticated caller', async () => {
    const res = await holdBed(SITE_ID, ITEM_ID)
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authenticated')
    expect(mockGuard).not.toHaveBeenCalled()
  })

  it('rejects non-owner', async () => {
    authenticateAsNonOwner()
    const res = await holdBed(SITE_ID, ITEM_ID)
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authorized')
    expect(mockGuard).not.toHaveBeenCalled()
  })
})

// ─── cancelReservation ─────────────────────────────────────────────────────

describe('cancelReservation', () => {
  it('rejects unauthenticated caller', async () => {
    const res = await cancelReservation(SITE_ID, ITEM_ID)
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authenticated')
    expect(vi.mocked(prisma.reservation.findFirst)).not.toHaveBeenCalled()
  })

  it('rejects non-owner', async () => {
    authenticateAsNonOwner()
    const res = await cancelReservation(SITE_ID, ITEM_ID)
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authorized')
    expect(vi.mocked(prisma.reservation.findFirst)).not.toHaveBeenCalled()
  })

  it('finds the active COMPLETE reservation and sets status=canceled when not refunded', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findFirst).mockResolvedValueOnce({
      id: RES_ID,
      refundedAt: null,
    } as any)
    vi.mocked(prisma.reservation.update).mockResolvedValueOnce({} as any)

    const res = await cancelReservation(SITE_ID, ITEM_ID)

    expect(res.status).toBe('ok')
    expect(vi.mocked(prisma.reservation.update)).toHaveBeenCalledWith({
      where: { id: RES_ID },
      data: { status: 'canceled' },
    })
  })

  it('matches a QR-collected walk-in: the lookup keys on status=complete, not operationalStatus', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findFirst).mockResolvedValueOnce({ id: RES_ID, refundedAt: null } as any)
    vi.mocked(prisma.reservation.update).mockResolvedValueOnce({} as any)

    const res = await cancelReservation(SITE_ID, ITEM_ID)
    expect(res.status).toBe('ok')

    // A walk-in paid online (QR collect) is (complete, walked-in). The cancel
    // lookup filters on status=complete and does NOT constrain operationalStatus,
    // so it matches that row — paid-walk-in cancel/refund parity depends on this.
    const whereArg = (vi.mocked(prisma.reservation.findFirst).mock.calls[0]![0] as any).where
    expect(whereArg.status).toBe('complete')
    expect(whereArg).not.toHaveProperty('operationalStatus')
  })

  it('sets status=refunded when a refund was already issued (refundedAt set)', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findFirst).mockResolvedValueOnce({
      id: RES_ID,
      refundedAt: new Date(),
    } as any)
    vi.mocked(prisma.reservation.update).mockResolvedValueOnce({} as any)

    const res = await cancelReservation(SITE_ID, ITEM_ID)

    expect(res.status).toBe('ok')
    expect(vi.mocked(prisma.reservation.update)).toHaveBeenCalledWith({
      where: { id: RES_ID },
      data: { status: 'refunded' },
    })
  })

  it('is idempotent: returns ok without calling update when already terminal (canceled/refunded)', async () => {
    authenticateAsOwner()
    // First findFirst (looking for COMPLETE): no match
    vi.mocked(prisma.reservation.findFirst).mockResolvedValueOnce(null)
    // Second findFirst (looking for already-terminal): match
    vi.mocked(prisma.reservation.findFirst).mockResolvedValueOnce({ id: RES_ID } as any)

    const res = await cancelReservation(SITE_ID, ITEM_ID)

    expect(res.status).toBe('ok')
    expect(vi.mocked(prisma.reservation.update)).not.toHaveBeenCalled()
  })

  it('returns error when no active or canceled reservation found', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findFirst).mockResolvedValueOnce(null)
    vi.mocked(prisma.reservation.findFirst).mockResolvedValueOnce(null)

    const res = await cancelReservation(SITE_ID, ITEM_ID)

    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toMatch(/no active reservation found/i)
    expect(vi.mocked(prisma.reservation.update)).not.toHaveBeenCalled()
  })
})

// ─── refundReservation ──────────────────────────────────────────────────────

describe('refundReservation', () => {
  it('rejects unauthenticated caller', async () => {
    const res = await refundReservation(SITE_ID, ITEM_ID)
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authenticated')
    expect(vi.mocked(issueReservationRefund)).not.toHaveBeenCalled()
  })

  it('rejects non-owner', async () => {
    authenticateAsNonOwner()
    const res = await refundReservation(SITE_ID, ITEM_ID)
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authorized')
    expect(vi.mocked(issueReservationRefund)).not.toHaveBeenCalled()
  })

  it('issues the refund and stamps refundedAt (bed stays occupied — no status change)', async () => {
    authenticateAsOwner()
    // site.findUnique must satisfy BOTH the auth lookup (.userId) and the
    // partner-account resolution (.user.partnerAccount.userId).
    vi.mocked(prisma.site.findUnique).mockResolvedValue({
      userId: OWNER_ID,
      user: { partnerAccount: { userId: 'pa-1' } },
    } as any)
    vi.mocked(prisma.reservation.findFirst).mockResolvedValueOnce({
      id: RES_ID,
      paymentRef: 'tr_test123',
      refundedAt: null,
    } as any)
    vi.mocked(prisma.reservation.update).mockResolvedValueOnce({} as any)

    const res = await refundReservation(SITE_ID, ITEM_ID)

    expect(res.status).toBe('ok')
    expect(vi.mocked(issueReservationRefund)).toHaveBeenCalledWith('tr_test123', 'pa-1')
    const updateArg = vi.mocked(prisma.reservation.update).mock.calls[0]![0] as any
    expect(updateArg.where).toEqual({ id: RES_ID })
    expect(updateArg.data.refundedAt).toBeInstanceOf(Date)
    // Refund must NOT change the payment status — the bed stays occupied.
    expect(updateArg.data.status).toBeUndefined()
  })

  it('matches a QR-collected walk-in: the lookup keys on status=complete, not operationalStatus', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.site.findUnique).mockResolvedValue({
      userId: OWNER_ID,
      user: { partnerAccount: { userId: 'pa-1' } },
    } as any)
    vi.mocked(prisma.reservation.findFirst).mockResolvedValueOnce({
      id: RES_ID,
      paymentRef: 'tr_test123',
      refundedAt: null,
    } as any)
    vi.mocked(prisma.reservation.update).mockResolvedValueOnce({} as any)

    const res = await refundReservation(SITE_ID, ITEM_ID)
    expect(res.status).toBe('ok')

    // Same as cancel: a paid-online walk-in (complete, walked-in) is refundable
    // because the lookup keys on status=complete with no operationalStatus filter.
    const whereArg = (vi.mocked(prisma.reservation.findFirst).mock.calls[0]![0] as any).where
    expect(whereArg.status).toBe('complete')
    expect(whereArg).not.toHaveProperty('operationalStatus')
  })

  it('is idempotent: already-refunded reservation does not call Mollie again', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findFirst).mockResolvedValueOnce({
      id: RES_ID,
      paymentRef: 'tr_test123',
      refundedAt: new Date(),
    } as any)

    const res = await refundReservation(SITE_ID, ITEM_ID)

    expect(res.status).toBe('ok')
    expect(vi.mocked(issueReservationRefund)).not.toHaveBeenCalled()
    expect(vi.mocked(prisma.reservation.update)).not.toHaveBeenCalled()
  })

  it('returns the provider error without stamping refundedAt when the refund fails', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findFirst).mockResolvedValueOnce({
      id: RES_ID,
      paymentRef: 'tr_test123',
      refundedAt: null,
    } as any)
    vi.mocked(issueReservationRefund).mockResolvedValueOnce({
      status: 'error',
      error: 'Mollie refund failed (422)',
    })

    const res = await refundReservation(SITE_ID, ITEM_ID)

    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toMatch(/mollie refund failed/i)
    expect((res as { needsReconnect?: boolean }).needsReconnect).toBe(false)
    expect(vi.mocked(prisma.reservation.update)).not.toHaveBeenCalled()
  })

  it('flags needsReconnect when the refund 403s for missing permission', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.site.findUnique).mockResolvedValue({
      userId: OWNER_ID,
      user: { partnerAccount: { userId: 'pa-1' } },
    } as any)
    vi.mocked(prisma.reservation.findFirst).mockResolvedValueOnce({
      id: RES_ID,
      paymentRef: 'tr_test123',
      refundedAt: null,
    } as any)
    vi.mocked(issueReservationRefund).mockResolvedValueOnce({
      status: 'error',
      error: 'Refunds are not enabled on this Mollie connection — reconnect Mollie to grant refund permission.',
      reason: 'permission',
    })

    const res = await refundReservation(SITE_ID, ITEM_ID)

    expect(res.status).toBe('error')
    expect((res as { needsReconnect?: boolean }).needsReconnect).toBe(true)
    expect(vi.mocked(prisma.reservation.update)).not.toHaveBeenCalled()
  })

  it('returns error when no paid reservation is found', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findFirst).mockResolvedValueOnce(null)

    const res = await refundReservation(SITE_ID, ITEM_ID)

    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toMatch(/no paid reservation found/i)
    expect(vi.mocked(issueReservationRefund)).not.toHaveBeenCalled()
  })
})

// ─── moveReservationToSeats ─────────────────────────────────────────────────

describe('moveReservationToSeats', () => {
  it('rejects unauthenticated caller', async () => {
    const res = await moveReservationToSeats(SITE_ID, RES_ID, [ITEM_ID])
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authenticated')
    expect(mockMoveGuard).not.toHaveBeenCalled()
  })

  it('rejects non-owner', async () => {
    authenticateAsNonOwner()
    const res = await moveReservationToSeats(SITE_ID, RES_ID, [ITEM_ID])
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authorized')
    expect(mockMoveGuard).not.toHaveBeenCalled()
  })

  it('errors when destination count != reservation seat count', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findUnique).mockResolvedValueOnce({
      siteId: SITE_ID, operationalStatus: 'expected', items: [{ id: 'a' }],
    } as any)
    const res = await moveReservationToSeats(SITE_ID, RES_ID, ['d1', 'd2'])
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toMatch(/same number of seats/i)
    expect(mockMoveGuard).not.toHaveBeenCalled()
  })

  it('relocates a single-seat reservation to the exact destination (no group expansion)', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findUnique).mockResolvedValueOnce({
      siteId: SITE_ID, operationalStatus: 'expected', items: [{ id: 'a' }],
    } as any)
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValueOnce([{ id: 'd1' }] as any)
    mockMoveGuard.mockResolvedValueOnce({ outcome: 'moved' } as any)

    const res = await moveReservationToSeats(SITE_ID, RES_ID, ['d1'])
    expect(res.status).toBe('ok')
    expect(mockMoveGuard).toHaveBeenCalledWith(RES_ID, ['d1'])
  })

  it('relocates a 3-seat group booking (active + pool extra) to a 3-seat destination', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findUnique).mockResolvedValueOnce({
      siteId: SITE_ID, operationalStatus: 'walked-in', items: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
    } as any)
    // destination resolves to 3 real seats (2 active + 1 pool extra)
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValueOnce([{ id: 'd1' }, { id: 'd2' }, { id: 'd3' }] as any)
    mockMoveGuard.mockResolvedValueOnce({ outcome: 'moved' } as any)

    const res = await moveReservationToSeats(SITE_ID, RES_ID, ['d1', 'd2', 'd3'])
    expect(res.status).toBe('ok')
    expect(mockMoveGuard).toHaveBeenCalledWith(RES_ID, ['d1', 'd2', 'd3'])
  })

  it('errors when a destination seat is not found or inactive', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findUnique).mockResolvedValueOnce({
      siteId: SITE_ID, operationalStatus: 'expected', items: [{ id: 'a' }],
    } as any)
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValueOnce([] as any)
    const res = await moveReservationToSeats(SITE_ID, RES_ID, ['d1'])
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toMatch(/not available/i)
    expect(mockMoveGuard).not.toHaveBeenCalled()
  })

  it('surfaces a conflict from the guard', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findUnique).mockResolvedValueOnce({
      siteId: SITE_ID, operationalStatus: 'expected', items: [{ id: 'a' }],
    } as any)
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValueOnce([{ id: 'd1' }] as any)
    mockMoveGuard.mockResolvedValueOnce({ outcome: 'conflict' } as any)
    const res = await moveReservationToSeats(SITE_ID, RES_ID, ['d1'])
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toMatch(/already reserved/i)
  })

  it('refuses to move a departed/terminal reservation', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findUnique).mockResolvedValueOnce({
      siteId: SITE_ID, operationalStatus: 'departed', items: [{ id: 'a' }],
    } as any)
    const res = await moveReservationToSeats(SITE_ID, RES_ID, ['d1'])
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toMatch(/completed reservation/i)
    expect(mockMoveGuard).not.toHaveBeenCalled()
  })
})

// ─── releaseHold ────────────────────────────────────────────────────────────

describe('releaseHold', () => {
  it('rejects unauthenticated caller', async () => {
    const res = await releaseHold(SITE_ID, ITEM_ID)
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authenticated')
    expect(vi.mocked(prisma.reservation.deleteMany)).not.toHaveBeenCalled()
  })

  it('rejects non-owner', async () => {
    authenticateAsNonOwner()
    const res = await releaseHold(SITE_ID, ITEM_ID)
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authorized')
    expect(vi.mocked(prisma.reservation.deleteMany)).not.toHaveBeenCalled()
  })

  it('deletes the held reservation when found (pair/default mode)', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.deleteMany).mockResolvedValueOnce({ count: 1 } as any)

    const res = await releaseHold(SITE_ID, ITEM_ID)

    expect(res.status).toBe('ok')
    expect(vi.mocked(prisma.reservation.deleteMany)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          siteId: SITE_ID,
          status: 'held',
          items: { some: { id: ITEM_ID } },
        }),
      })
    )
  })

  it('returns ok (no-op) when no held reservation exists', async () => {
    // In pair mode, deleteMany is always called — count=0 just means nothing was there.
    // The action must NOT treat count=0 as an error (idempotent release).
    authenticateAsOwner()
    vi.mocked(prisma.reservation.deleteMany).mockResolvedValueOnce({ count: 0 } as any)

    const res = await releaseHold(SITE_ID, ITEM_ID)

    expect(res.status).toBe('ok')
    expect(vi.mocked(prisma.reservation.deleteMany)).toHaveBeenCalled()
  })
})

// ─── convertHoldToWalkIn ─────────────────────────────────────────────────────

describe('convertHoldToWalkIn', () => {
  it('rejects unauthenticated caller', async () => {
    const res = await convertHoldToWalkIn(SITE_ID, ITEM_ID)
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authenticated')
    expect(vi.mocked(prisma.reservation.findFirst)).not.toHaveBeenCalled()
  })

  it('rejects non-owner', async () => {
    authenticateAsNonOwner()
    const res = await convertHoldToWalkIn(SITE_ID, ITEM_ID)
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authorized')
    expect(vi.mocked(prisma.reservation.findFirst)).not.toHaveBeenCalled()
  })

  it('finds the held reservation by itemId and updates it to paid-in-cash + walked-in', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findFirst).mockResolvedValueOnce({ id: RES_ID } as any)
    vi.mocked(prisma.reservation.update).mockResolvedValueOnce({} as any)

    const res = await convertHoldToWalkIn(SITE_ID, ITEM_ID)

    expect(res.status).toBe('ok')
    expect(vi.mocked(prisma.reservation.update)).toHaveBeenCalledWith({
      where: { id: RES_ID },
      data: expect.objectContaining({
        status: 'paid-in-cash',
        operationalStatus: 'walked-in',
        checkedInAt: expect.any(Date),
      }),
    })
  })

  it('applies the passed guestName when non-empty', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findFirst).mockResolvedValueOnce({ id: RES_ID } as any)
    vi.mocked(prisma.reservation.update).mockResolvedValueOnce({} as any)

    await convertHoldToWalkIn(SITE_ID, ITEM_ID, undefined, 'Maria')

    const updateData = vi.mocked(prisma.reservation.update).mock.calls[0][0].data as any
    expect(updateData.guestName).toBe('Maria')
  })

  it('does NOT set guestName when none is passed (preserves existing hold name)', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findFirst).mockResolvedValueOnce({ id: RES_ID } as any)
    vi.mocked(prisma.reservation.update).mockResolvedValueOnce({} as any)

    await convertHoldToWalkIn(SITE_ID, ITEM_ID, undefined, undefined)

    const updateData = vi.mocked(prisma.reservation.update).mock.calls[0][0].data as any
    expect(updateData).not.toHaveProperty('guestName')
  })

  it('does NOT set guestName when an empty string is passed', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findFirst).mockResolvedValueOnce({ id: RES_ID } as any)
    vi.mocked(prisma.reservation.update).mockResolvedValueOnce({} as any)

    await convertHoldToWalkIn(SITE_ID, ITEM_ID, undefined, '')

    const updateData = vi.mocked(prisma.reservation.update).mock.calls[0][0].data as any
    expect(updateData).not.toHaveProperty('guestName')
  })

  it('returns error when no held reservation is found for this item today', async () => {
    // Bug case: a held guest arrives on a bed that was already converted or released.
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findFirst).mockResolvedValueOnce(null)

    const res = await convertHoldToWalkIn(SITE_ID, ITEM_ID)

    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toMatch(/no held reservation found/i)
    expect(vi.mocked(prisma.reservation.update)).not.toHaveBeenCalled()
  })

  it('queries only status=held reservations (does not match walk-in or paid bookings)', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findFirst).mockResolvedValueOnce(null) // simulates no held res

    await convertHoldToWalkIn(SITE_ID, ITEM_ID)

    const findFirstArgs = vi.mocked(prisma.reservation.findFirst).mock.calls[0][0] as any
    expect(findFirstArgs.where.status).toBe('held')
    expect(findFirstArgs.where.items.some.id).toBe(ITEM_ID)
    expect(findFirstArgs.where.siteId).toBe(SITE_ID)
  })

  // ── until (multi-day) extension ──

  it('today-only (no until): sets to=venue-local end-of-today in the update', async () => {
    // The hold already covers today; converting it without an end date keeps
    // the stay as today-only (to = venue end-of-today). No transaction needed.
    // With no tz fields in the mock, the action falls back to 'Europe/Madrid'.
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findFirst).mockResolvedValueOnce({ id: RES_ID } as any)
    vi.mocked(prisma.reservation.update).mockResolvedValueOnce({} as any)

    const res = await convertHoldToWalkIn(SITE_ID, ITEM_ID)

    expect(res.status).toBe('ok')
    const updateData = vi.mocked(prisma.reservation.update).mock.calls[0][0].data as any
    // `to` must be set to venue-local end-of-today (Madrid fallback)
    expect(updateData.to).toBeInstanceOf(Date)
    const { end: expectedTo } = siteDayBounds({}) // fallback = 'Europe/Madrid'
    expect((updateData.to as Date).getTime()).toBe(expectedTo.getTime())
    // Must not have run the $transaction path — $transaction stays uncalled for today-only
    expect(vi.mocked(prisma.$transaction)).not.toHaveBeenCalled()
  })

  it('multi-day: sets to=venue-local end of `until` day and runs atomically inside $transaction', async () => {
    // Extending beyond today must re-check availability. The $transaction mock
    // executes the callback synchronously with the same prisma mock as tx, so
    // we can verify both the hold lookup and the update in one test.
    authenticateAsOwner()
    const until = dayjs().add(3, 'day').format('YYYY-MM-DD')

    // First findFirst (hold lookup inside tx) → found
    vi.mocked(prisma.reservation.findFirst).mockResolvedValueOnce({
      id: RES_ID,
      items: [{ id: ITEM_ID }],
    } as any)
    // Second findFirst (conflict check inside tx) → no conflict
    vi.mocked(prisma.reservation.findFirst).mockResolvedValueOnce(null)
    vi.mocked(prisma.reservation.update).mockResolvedValueOnce({} as any)

    const res = await convertHoldToWalkIn(SITE_ID, ITEM_ID, undefined, undefined, until)

    expect(res.status).toBe('ok')
    // Transaction must have been called
    expect(vi.mocked(prisma.$transaction)).toHaveBeenCalled()
    // Update must set the extended to date (venue-local end of until day, Madrid fallback)
    const updateData = vi.mocked(prisma.reservation.update).mock.calls[0][0].data as any
    expect(updateData.to).toBeInstanceOf(Date)
    const expectedTo = siteDayBounds({}, new Date(until + 'T12:00:00.000Z')).end
    expect((updateData.to as Date).getTime()).toBe(expectedTo.getTime())
    expect(updateData.status).toBe('paid-in-cash')
    expect(updateData.operationalStatus).toBe('walked-in')
  })

  it('multi-day conflict: returns error when another booking overlaps the extended range', async () => {
    // Bug case: operator holds a bed, then tries to extend rent to overlap with a
    // future online booking. The conflict check (excluding the hold itself) must
    // catch this and reject rather than double-booking.
    authenticateAsOwner()
    const until = dayjs().add(5, 'day').format('YYYY-MM-DD')

    // First findFirst (hold lookup) → found with the item
    vi.mocked(prisma.reservation.findFirst).mockResolvedValueOnce({
      id: RES_ID,
      items: [{ id: ITEM_ID }],
    } as any)
    // Second findFirst (conflict check) → conflicting reservation exists
    vi.mocked(prisma.reservation.findFirst).mockResolvedValueOnce({
      id: 'conflicting-res-1',
    } as any)

    const res = await convertHoldToWalkIn(SITE_ID, ITEM_ID, undefined, undefined, until)

    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toMatch(/already reserved for part of this period/i)
    // Update must NOT have been called — conflict aborts the conversion
    expect(vi.mocked(prisma.reservation.update)).not.toHaveBeenCalled()
  })

  it('multi-day: self-exclusion — hold is excluded from its own conflict check', async () => {
    // The conflict query must carry `id: { not: hold.id }` so the hold itself
    // does not trigger a false-positive conflict with its own today range.
    authenticateAsOwner()
    const until = dayjs().add(2, 'day').format('YYYY-MM-DD')

    vi.mocked(prisma.reservation.findFirst).mockResolvedValueOnce({
      id: RES_ID,
      items: [{ id: ITEM_ID }],
    } as any)
    // No conflict (self correctly excluded)
    vi.mocked(prisma.reservation.findFirst).mockResolvedValueOnce(null)
    vi.mocked(prisma.reservation.update).mockResolvedValueOnce({} as any)

    const res = await convertHoldToWalkIn(SITE_ID, ITEM_ID, undefined, undefined, until)

    expect(res.status).toBe('ok')
    // Verify the conflict query excluded the hold's own id
    const conflictArgs = vi.mocked(prisma.reservation.findFirst).mock.calls[1][0] as any
    expect(conflictArgs.where.id).toEqual({ not: RES_ID })
  })

  it('multi-day: returns error when the held reservation is not found inside transaction', async () => {
    authenticateAsOwner()
    const until = dayjs().add(2, 'day').format('YYYY-MM-DD')
    // findFirst returns null → no held reservation
    vi.mocked(prisma.reservation.findFirst).mockResolvedValueOnce(null)

    const res = await convertHoldToWalkIn(SITE_ID, ITEM_ID, undefined, undefined, until)

    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toMatch(/no held reservation found/i)
    expect(vi.mocked(prisma.reservation.update)).not.toHaveBeenCalled()
  })

  it('rejects an invalid until date format', async () => {
    authenticateAsOwner()
    const res = await convertHoldToWalkIn(SITE_ID, ITEM_ID, undefined, undefined, 'not-a-date')
    expect(res.status).toBe('error')
    expect(vi.mocked(prisma.reservation.findFirst)).not.toHaveBeenCalled()
  })

  it('rejects an until date in the past', async () => {
    authenticateAsOwner()
    const past = dayjs().subtract(1, 'day').format('YYYY-MM-DD')
    const res = await convertHoldToWalkIn(SITE_ID, ITEM_ID, undefined, undefined, past)
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toMatch(/in the past/i)
    expect(vi.mocked(prisma.reservation.findFirst)).not.toHaveBeenCalled()
  })

  it('rejects an until range exceeding 90 days', async () => {
    authenticateAsOwner()
    const tooFar = dayjs().add(91, 'day').format('YYYY-MM-DD')
    const res = await convertHoldToWalkIn(SITE_ID, ITEM_ID, undefined, undefined, tooFar)
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toMatch(/90 days/i)
    expect(vi.mocked(prisma.reservation.findFirst)).not.toHaveBeenCalled()
  })

  // ── Single-seat split path (applyToGroup=false) ──

  it('whole-convert when applyToGroup=true regardless of item count (default/Group behaviour unchanged)', async () => {
    // With applyToGroup=true (default), a 3-item hold converts in place.
    authenticateAsOwner()
    const ITEM_A = 'item-a'
    const ITEM_B = 'item-b'
    vi.mocked(prisma.reservation.findFirst).mockResolvedValueOnce({
      id: RES_ID,
      from: dayjs().startOf('day').toDate(),
      items: [{ id: ITEM_ID, price: null }, { id: ITEM_A, price: null }, { id: ITEM_B, price: null }],
    } as any)
    vi.mocked(prisma.reservation.update).mockResolvedValueOnce({} as any)

    const res = await convertHoldToWalkIn(SITE_ID, ITEM_ID, undefined, undefined, undefined, undefined, true)

    expect(res.status).toBe('ok')
    // The reservation must be updated in place (whole-hold convert).
    const updateCall = vi.mocked(prisma.reservation.update).mock.calls[0][0]
    expect(updateCall.where.id).toBe(RES_ID)
    expect((updateCall.data as any).status).toBe('paid-in-cash')
    expect((updateCall.data as any).operationalStatus).toBe('walked-in')
    // No new reservation should be created.
    expect(vi.mocked(prisma.reservation.create)).not.toHaveBeenCalled()
  })

  it('whole-convert even with applyToGroup=false when the hold has only 1 item (no split on single-seat holds)', async () => {
    // Bug guard: a single-seat hold with applyToGroup=false must still whole-convert —
    // there is nothing to split off, so the Seat branch is a no-op.
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findFirst).mockResolvedValueOnce({
      id: RES_ID,
      from: dayjs().startOf('day').toDate(),
      items: [{ id: ITEM_ID, price: null }],
    } as any)
    vi.mocked(prisma.reservation.update).mockResolvedValueOnce({} as any)

    const res = await convertHoldToWalkIn(SITE_ID, ITEM_ID, undefined, undefined, undefined, undefined, false)

    expect(res.status).toBe('ok')
    // Whole-convert: update in place.
    const updateCall = vi.mocked(prisma.reservation.update).mock.calls[0][0]
    expect(updateCall.where.id).toBe(RES_ID)
    expect((updateCall.data as any).status).toBe('paid-in-cash')
    expect(vi.mocked(prisma.reservation.create)).not.toHaveBeenCalled()
  })

  it('split path: today-only 3-seat hold + applyToGroup=false disconnects this seat and creates new 1-seat walk-in', async () => {
    // Core split test: a hold covering 3 beds where staff rent ONE bed individually.
    // The original hold must keep its remaining 2 beds and stay `held`; a NEW
    // reservation must be created for the one bed with `paid-in-cash`/`walked-in`.
    authenticateAsOwner()
    const ITEM_A = 'item-a'
    const ITEM_B = 'item-b'
    vi.mocked(prisma.reservation.findFirst).mockResolvedValueOnce({
      id: RES_ID,
      from: dayjs().startOf('day').toDate(),
      items: [
        { id: ITEM_ID, price: null },
        { id: ITEM_A, price: null },
        { id: ITEM_B, price: null },
      ],
    } as any)
    // prisma.$transaction (sequential array form) calls each op; the mock resolves both.
    vi.mocked(prisma.reservation.update).mockResolvedValueOnce({} as any)
    vi.mocked(prisma.reservation.create).mockResolvedValueOnce({ id: 'new-res-1' } as any)

    const res = await convertHoldToWalkIn(SITE_ID, ITEM_ID, undefined, undefined, undefined, undefined, false)

    expect(res.status).toBe('ok')

    // The original hold must be disconnected (not status-changed).
    const updateCall = vi.mocked(prisma.reservation.update).mock.calls[0][0]
    expect(updateCall.where.id).toBe(RES_ID)
    const disconnectData = (updateCall.data as any).items?.disconnect
    expect(disconnectData).toEqual([{ id: ITEM_ID }])
    // The update must NOT flip the hold's status — hold keeps `held`.
    expect((updateCall.data as any).status).toBeUndefined()

    // A NEW reservation must be created for just this seat.
    const createCall = vi.mocked(prisma.reservation.create).mock.calls[0][0]
    expect((createCall.data as any).status).toBe('paid-in-cash')
    expect((createCall.data as any).operationalStatus).toBe('walked-in')
    expect((createCall.data as any).checkedInAt).toBeInstanceOf(Date)
    expect((createCall.data as any).items.connect).toEqual([{ id: ITEM_ID }])
  })

  it('split path: per-seat paymentAmount computed for this seat only (not all items)', async () => {
    // The split walk-in must record the cash for THIS seat only, not the whole group.
    // Site price 10€, item has no per-seat price override → 10€ for 1 day.
    //
    // Call order for prisma.site.findUnique:
    //   1. verifySiteOwnership → needs { userId: OWNER_ID }
    //   2. actions.ts fetches site type/price → needs { type: 'paid', price: 10 }
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    vi.mocked(prisma.site.findUnique)
      .mockResolvedValueOnce({ userId: OWNER_ID } as any)      // auth check
      .mockResolvedValueOnce({ type: 'paid', price: 10 } as any) // price fetch
    // Employee: resolve null (no employee set)
    vi.mocked(prisma.employee.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.reservation.findFirst).mockResolvedValueOnce({
      id: RES_ID,
      from: dayjs().startOf('day').toDate(),
      items: [
        { id: ITEM_ID, price: null }, // will be split off
        { id: 'item-b', price: null },
        { id: 'item-c', price: null },
      ],
    } as any)
    vi.mocked(prisma.reservation.update).mockResolvedValueOnce({} as any)
    vi.mocked(prisma.reservation.create).mockResolvedValueOnce({ id: 'new-res-1' } as any)

    await convertHoldToWalkIn(SITE_ID, ITEM_ID, undefined, undefined, undefined, undefined, false)

    // New reservation's paymentAmount must be the per-seat amount (10€), NOT 30€ (all 3).
    const createCall = vi.mocked(prisma.reservation.create).mock.calls[0][0]
    expect((createCall.data as any).paymentAmount).toBe(10)
  })

  it('split path: multi-day 3-seat hold + applyToGroup=false conflicts are caught via $transaction', async () => {
    // When `until` extends beyond today, the split path uses $transaction (callback form)
    // for the conflict check. If a conflict exists on the extended days for THIS seat,
    // the action must return an error and leave the hold untouched.
    authenticateAsOwner()
    const until = dayjs().add(2, 'day').format('YYYY-MM-DD')

    // $transaction callback: return conflict
    vi.mocked(prisma.$transaction).mockImplementationOnce(async (cb: any) => {
      // Simulate the callback receiving a tx with findFirst returning a conflict
      return cb({
        reservation: {
          findFirst: vi.fn()
            .mockResolvedValueOnce({
              id: RES_ID,
              from: dayjs().startOf('day').toDate(),
              items: [{ id: ITEM_ID, price: null }, { id: 'b', price: null }, { id: 'c', price: null }],
            })
            .mockResolvedValueOnce({ id: 'conflicting-res' }), // conflict found
          update: vi.fn(),
          create: vi.fn(),
        },
        $queryRaw: vi.fn().mockResolvedValue([]),
      })
    })

    const res = await convertHoldToWalkIn(SITE_ID, ITEM_ID, undefined, undefined, until, undefined, false)

    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toMatch(/already reserved/i)
  })

  it('2-of-3 subset split (today-only): creates ONE walk-in with both seats, hold keeps 1', async () => {
    // Bulk Rent: 2 seats selected from a 3-seat hold. Expected:
    //   - hold keeps 1 remaining seat (still held)
    //   - ONE new walk-in with the 2 selected seats
    //   - new walk-in's paymentAmount = 2 seats × site price
    authenticateAsOwner()
    const ITEM_B = 'item-b'
    const ITEM_C = 'item-c'
    vi.mocked(prisma.reservation.findFirst).mockResolvedValueOnce({
      id: RES_ID,
      from: dayjs().startOf('day').toDate(),
      items: [
        { id: ITEM_ID, price: null },
        { id: ITEM_B, price: null },
        { id: ITEM_C, price: null },
      ],
    } as any)
    // $transaction (sequential array form): update + create
    vi.mocked(prisma.reservation.update).mockResolvedValueOnce({} as any)
    vi.mocked(prisma.reservation.create).mockResolvedValueOnce({ id: 'new-subset-res' } as any)

    // applyToGroup=false + splitItemIds covering 2 of 3 seats
    const res = await convertHoldToWalkIn(
      SITE_ID, ITEM_ID, undefined, undefined, undefined, undefined, false,
      [ITEM_ID, ITEM_B],
    )
    expect(res.status).toBe('ok')

    // Hold: disconnect the 2-seat subset
    const updateCall = vi.mocked(prisma.reservation.update).mock.calls[0][0]
    expect(updateCall.where.id).toBe(RES_ID)
    const disconnect = (updateCall.data as any).items?.disconnect as { id: string }[]
    expect(disconnect).toHaveLength(2)
    expect(disconnect).toEqual(expect.arrayContaining([{ id: ITEM_ID }, { id: ITEM_B }]))
    // Hold must NOT flip to walked-in
    expect((updateCall.data as any).status).toBeUndefined()

    // ONE new reservation with both seats
    const createCall = vi.mocked(prisma.reservation.create).mock.calls[0][0]
    expect((createCall.data as any).status).toBe('paid-in-cash')
    expect((createCall.data as any).operationalStatus).toBe('walked-in')
    const connect = (createCall.data as any).items?.connect as { id: string }[]
    expect(connect).toHaveLength(2)
    expect(connect).toEqual(expect.arrayContaining([{ id: ITEM_ID }, { id: ITEM_B }]))
    // Exactly ONE new reservation created (not two)
    expect(vi.mocked(prisma.reservation.create).mock.calls).toHaveLength(1)
  })

  it('subset covering all hold items (today-only): whole-convert, no split', async () => {
    // If all 3 seats are passed in splitItemIds, it should fall through to whole-convert.
    authenticateAsOwner()
    const ITEM_B = 'item-b'
    const ITEM_C = 'item-c'
    vi.mocked(prisma.reservation.findFirst).mockResolvedValueOnce({
      id: RES_ID,
      from: dayjs().startOf('day').toDate(),
      items: [
        { id: ITEM_ID, price: null },
        { id: ITEM_B, price: null },
        { id: ITEM_C, price: null },
      ],
    } as any)
    vi.mocked(prisma.reservation.update).mockResolvedValueOnce({} as any)

    const res = await convertHoldToWalkIn(
      SITE_ID, ITEM_ID, undefined, undefined, undefined, undefined, false,
      [ITEM_ID, ITEM_B, ITEM_C],  // ALL 3 seats → whole-convert
    )
    expect(res.status).toBe('ok')
    // Whole-convert: update in place (no create)
    expect(vi.mocked(prisma.reservation.create)).not.toHaveBeenCalled()
    const updateCall = vi.mocked(prisma.reservation.update).mock.calls[0][0]
    expect(updateCall.where.id).toBe(RES_ID)
    expect((updateCall.data as any).status).toBe('paid-in-cash')
  })
})

// ─── reserveItem: cash/card payment fork ────────────────────────────────────

describe('reserveItem — cash/card till fork', () => {
  /**
   * Mock a paid-site owner for reserveItem. Call order for prisma.site.findUnique:
   *   1. verifySiteOwnership (requireSiteOwner) → { userId: OWNER_ID }
   *   2. Promise.all type/price fetch → { type: 'paid', price: 20, ... }
   * inventoryItem.findUnique: null (no pair → getGroupMemberIds returns [])
   * inventoryItem.findMany: price rows (one item, null price → falls back to site.price=20)
   *
   * NOTE: uses mockResolvedValue (persistent) NOT mockResolvedValueOnce so the Once queue
   * is not polluted across tests (vi.clearAllMocks() clears call history but NOT the Once queue).
   */
  function setupPaidSiteForReserveItem() {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    // Two consecutive Once values for site.findUnique — needed because the action
    // calls it twice (ownership then type/price). Once values drain in order, and
    // vi.clearAllMocks() does NOT purge the queue, so this helper is designed to
    // be called once per test with fresh beforeEach clearing only call history.
    vi.mocked(prisma.site.findUnique)
      .mockResolvedValueOnce({ userId: OWNER_ID } as any)
      .mockResolvedValueOnce({
        type: 'paid', price: 20, timeZone: null, locationLat: null, locationLng: null,
      } as any)
    // Use mockResolvedValue (not Once) for single-call mocks to avoid queue leakage.
    vi.mocked(prisma.inventoryItem.findUnique).mockResolvedValue(null) // no pair
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([{ price: null }] as any)
    // Do NOT mock employee.findUnique — employeeId=undefined causes early return,
    // so the mock would never be consumed and would pollute subsequent tests.
  }

  it('records a TillEntry when recordCashSettlement=true on a paid site', async () => {
    setupPaidSiteForReserveItem()
    mockGuard.mockResolvedValueOnce({ outcome: 'created', reservationId: 'r-cash-1' })

    const res = await reserveItem(
      SITE_ID, ITEM_ID, undefined, undefined, undefined, undefined, false, undefined, true,
    )

    expect(res.status).toBe('ok')
    expect((res as any).reservationId).toBe('r-cash-1')
    const mockRecord = vi.mocked(recordSettlement)
    expect(mockRecord).toHaveBeenCalledOnce()
    expect(mockRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        siteId: SITE_ID,
        reservationId: 'r-cash-1',
        amount: 20,
      }),
    )
  })

  it('does NOT record a TillEntry when recordCashSettlement=false (card/QR path)', async () => {
    setupPaidSiteForReserveItem()
    mockGuard.mockResolvedValueOnce({ outcome: 'created', reservationId: 'r-card-1' })

    const res = await reserveItem(
      SITE_ID, ITEM_ID, undefined, undefined, undefined, undefined, false, undefined, false,
    )

    expect(res.status).toBe('ok')
    expect((res as any).reservationId).toBe('r-card-1')
    expect(vi.mocked(recordSettlement)).not.toHaveBeenCalled()
  })

  it('does NOT record a TillEntry on a free site even when recordCashSettlement=true', async () => {
    // Free site → paymentAmount=0 → settlement guard skips
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    vi.mocked(prisma.site.findUnique)
      .mockResolvedValueOnce({ userId: OWNER_ID } as any)
      .mockResolvedValueOnce({ type: 'free', price: null, timeZone: null, locationLat: null, locationLng: null } as any)
    vi.mocked(prisma.inventoryItem.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([{ price: null }] as any)
    mockGuard.mockResolvedValueOnce({ outcome: 'created', reservationId: 'r-free-1' })

    await reserveItem(
      SITE_ID, ITEM_ID, undefined, undefined, undefined, undefined, false, undefined, true,
    )

    expect(vi.mocked(recordSettlement)).not.toHaveBeenCalled()
  })

  it('returns reservationId from the guard in the ok response', async () => {
    // A basic (existing-behaviour) call now always returns reservationId
    authenticateAsOwner()
    vi.mocked(prisma.inventoryItem.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([])
    mockGuard.mockResolvedValueOnce({ outcome: 'created', reservationId: 'r-id-check' })

    const res = await reserveItem(SITE_ID, ITEM_ID)

    expect(res.status).toBe('ok')
    expect((res as any).reservationId).toBe('r-id-check')
  })

  it('issues a PARTNER-only cash receipt when immediate cash is taken (recordCashSettlement=true)', async () => {
    // At immediate-cash walk-in creation, a PARTNER receipt must be issued so the
    // sale has an audit trail without waiting for a separate Settle action.
    setupPaidSiteForReserveItem()
    mockGuard.mockResolvedValueOnce({ outcome: 'created', reservationId: 'r-receipt-1' })

    const res = await reserveItem(
      SITE_ID, ITEM_ID, undefined, undefined, undefined, undefined, false, undefined, true,
    )

    expect(res.status).toBe('ok')
    expect(mockProcessConfirmedReservation).toHaveBeenCalledOnce()
    expect(mockProcessConfirmedReservation).toHaveBeenCalledWith('r-receipt-1', { skipCommission: true, skipEmail: true })
  })

  it('does NOT issue a receipt when recordCashSettlement=false (card/QR path)', async () => {
    // Card/QR path gets its invoice via the normal online flow after Mollie settles.
    setupPaidSiteForReserveItem()
    mockGuard.mockResolvedValueOnce({ outcome: 'created', reservationId: 'r-card-no-receipt' })

    await reserveItem(
      SITE_ID, ITEM_ID, undefined, undefined, undefined, undefined, false, undefined, false,
    )

    expect(mockProcessConfirmedReservation).not.toHaveBeenCalled()
  })

  it('does NOT fail if receipt generation throws (non-blocking)', async () => {
    // Receipt failure must not roll back or error the immediate cash walk-in.
    setupPaidSiteForReserveItem()
    mockGuard.mockResolvedValueOnce({ outcome: 'created', reservationId: 'r-error-1' })
    mockProcessConfirmedReservation.mockRejectedValueOnce(new Error('DB timeout'))

    const res = await reserveItem(
      SITE_ID, ITEM_ID, undefined, undefined, undefined, undefined, false, undefined, true,
    )

    expect(res.status).toBe('ok')
  })
})

// ─── convertHoldToWalkIn: cash/card payment fork ─────────────────────────────

describe('convertHoldToWalkIn — cash/card till fork', () => {
  /**
   * Mock a paid-site owner for convertHoldToWalkIn. Call order for prisma.site.findUnique:
   *   1. verifySiteOwnership (requireSiteOwner) → { userId: OWNER_ID }
   *   2. actions.ts fetches site type/price → { type: 'paid', price: 15, ... }
   *
   * Uses mockResolvedValue (persistent) for single-call mocks to avoid Once queue
   * pollution across tests (vi.clearAllMocks() only clears call history, not the Once queue).
   */
  function setupPaidSiteForConvert() {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    vi.mocked(prisma.site.findUnique)
      .mockResolvedValueOnce({ userId: OWNER_ID } as any)
      .mockResolvedValueOnce({
        type: 'paid', price: 15, timeZone: null, locationLat: null, locationLng: null,
      } as any)
    // employee.findUnique IS called by resolveEmployeeId for convertHoldToWalkIn because
    // the employeeId param is provided via currentWorkerId; here we pass undefined so
    // resolveEmployeeId returns early without calling findUnique — don't mock it.
    // Use mockResolvedValue (persistent) for safety.
    vi.mocked(prisma.employee.findUnique).mockResolvedValue(null)
  }

  it('records TillEntry for today-only whole-hold with recordCashSettlement=true', async () => {
    setupPaidSiteForConvert()
    vi.mocked(prisma.reservation.findFirst).mockResolvedValueOnce({
      id: RES_ID,
      from: null,
      items: [{ id: ITEM_ID, price: null }],
    } as any)
    vi.mocked(prisma.reservation.update).mockResolvedValueOnce({} as any)

    const res = await convertHoldToWalkIn(
      SITE_ID, ITEM_ID, undefined, undefined, undefined, undefined, true, undefined, true,
    )

    expect(res.status).toBe('ok')
    expect((res as any).reservationId).toBe(RES_ID)
    const mockRecord = vi.mocked(recordSettlement)
    expect(mockRecord).toHaveBeenCalledOnce()
    expect(mockRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        siteId: SITE_ID,
        reservationId: RES_ID,
        amount: 15,
      }),
    )
  })

  it('does NOT record TillEntry when recordCashSettlement=false (card path)', async () => {
    setupPaidSiteForConvert()
    vi.mocked(prisma.reservation.findFirst).mockResolvedValueOnce({
      id: RES_ID,
      from: null,
      items: [{ id: ITEM_ID, price: null }],
    } as any)
    vi.mocked(prisma.reservation.update).mockResolvedValueOnce({} as any)

    const res = await convertHoldToWalkIn(
      SITE_ID, ITEM_ID, undefined, undefined, undefined, undefined, true, undefined, false,
    )

    expect(res.status).toBe('ok')
    expect((res as any).reservationId).toBe(RES_ID)
    expect(vi.mocked(recordSettlement)).not.toHaveBeenCalled()
  })

  it('today-only seat-split path: records TillEntry with the new subset reservation id', async () => {
    setupPaidSiteForConvert()
    // 3-seat hold; split off ITEM_ID only
    vi.mocked(prisma.reservation.findFirst).mockResolvedValueOnce({
      id: RES_ID,
      from: null,
      items: [
        { id: ITEM_ID, price: null },
        { id: 'item-b', price: null },
        { id: 'item-c', price: null },
      ],
    } as any)
    vi.mocked(prisma.reservation.update).mockResolvedValueOnce({} as any)
    vi.mocked(prisma.reservation.create).mockResolvedValueOnce({ id: 'split-res-1' } as any)

    const res = await convertHoldToWalkIn(
      SITE_ID, ITEM_ID, undefined, undefined, undefined, undefined, false, undefined, true,
    )

    expect(res.status).toBe('ok')
    expect((res as any).reservationId).toBe('split-res-1')
    const mockRecord = vi.mocked(recordSettlement)
    expect(mockRecord).toHaveBeenCalledOnce()
    expect(mockRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        siteId: SITE_ID,
        reservationId: 'split-res-1',
        amount: 15,
      }),
    )
  })

  it('does NOT record TillEntry on free site even when recordCashSettlement=true', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    vi.mocked(prisma.site.findUnique)
      .mockResolvedValueOnce({ userId: OWNER_ID } as any)
      .mockResolvedValueOnce({ type: 'free', price: null, timeZone: null, locationLat: null, locationLng: null } as any)
    vi.mocked(prisma.employee.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.reservation.findFirst).mockResolvedValueOnce({
      id: RES_ID,
      from: null,
      items: [{ id: ITEM_ID, price: null }],
    } as any)
    vi.mocked(prisma.reservation.update).mockResolvedValueOnce({} as any)

    await convertHoldToWalkIn(
      SITE_ID, ITEM_ID, undefined, undefined, undefined, undefined, true, undefined, true,
    )

    expect(vi.mocked(recordSettlement)).not.toHaveBeenCalled()
  })
})

// ─── Regression: group-attached pool seat cascades through reserveItem ────────

describe('reserveItem cascade regression: pool seat with sunbedGroupId', () => {
  it('group-extra pool seat cascades sibling members via getGroupMemberIds when applyToPair=true', async () => {
    // This tests that a pool seat (status='pool') WITH a sunbedGroupId correctly
    // triggers the SunbedGroup cascade path in getGroupMemberIds, meaning the
    // sibling regular seat (status='active') gets co-reserved when the pool seat
    // is the reservation anchor.
    authenticateAsOwner()

    const POOL_SEAT_ID = 'pool-seat-1'
    const SIBLING_ID = 'sibling-active-1'
    const GROUP_ID = 'group-1'

    // getGroupMemberIds: pool seat has a sunbedGroupId
    vi.mocked(prisma.inventoryItem.findUnique).mockResolvedValue({
      id: POOL_SEAT_ID,
      pairId: null,
      sunbedGroupId: GROUP_ID,
      pairedBy: null,
    } as any)

    // getGroupMemberIds: findMany for other members of the group (the regular sibling)
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([
      { id: SIBLING_ID },
    ] as any)

    const res = await reserveItem(SITE_ID, POOL_SEAT_ID, 'Guest', undefined, undefined, undefined, true)
    expect(res.status).toBe('ok')

    // getGroupMemberIds must have used the sunbedGroupId path (findMany was called)
    expect(vi.mocked(prisma.inventoryItem.findMany)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ sunbedGroupId: GROUP_ID }),
      })
    )

    // Both the pool seat AND the sibling must reach the guard
    const guardCall = mockGuard.mock.calls[0][0]
    expect(guardCall.itemIds).toContain(POOL_SEAT_ID)
    expect(guardCall.itemIds).toContain(SIBLING_ID)
    // prisma.reservation.create must NOT be called directly
    expect(vi.mocked(prisma.reservation.create)).not.toHaveBeenCalled()
  })
})

// ─── removeFailedReservation ─────────────────────────────────────────────────

describe('removeFailedReservation', () => {
  it('deletes a reservation with canonical payment_failed status and returns ok', async () => {
    // Bug case: Mollie payment fails → user app stamps 'payment_failed'; seat is
    // orphaned until staff manually removes it.
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue({
      siteId: SITE_ID,
      status: 'payment_failed',
    } as any)
    vi.mocked(prisma.reservation.deleteMany).mockResolvedValue({ count: 1 } as any)

    const res = await removeFailedReservation(SITE_ID, RES_ID)
    expect(res.status).toBe('ok')

    expect(vi.mocked(prisma.reservation.deleteMany)).toHaveBeenCalledWith({
      where: { id: RES_ID, siteId: SITE_ID },
    })
  })

  it('deletes a legacy "error" reservation and returns ok', async () => {
    // Legacy rows written before the canonical constant was introduced.
    // The guard must accept 'error' in addition to 'payment_failed'.
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue({
      siteId: SITE_ID,
      status: 'error',
    } as any)
    vi.mocked(prisma.reservation.deleteMany).mockResolvedValue({ count: 1 } as any)

    const res = await removeFailedReservation(SITE_ID, RES_ID)
    expect(res.status).toBe('ok')

    expect(vi.mocked(prisma.reservation.deleteMany)).toHaveBeenCalledWith({
      where: { id: RES_ID, siteId: SITE_ID },
    })
  })

  it('rejects when the reservation status is complete (paid booking — must never be deleted)', async () => {
    // Safety guard: a paid booking with status='complete' must NOT be removable
    // via this action regardless of what the client sends.
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue({
      siteId: SITE_ID,
      status: 'complete',
    } as any)

    const res = await removeFailedReservation(SITE_ID, RES_ID)
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toMatch(/not in a failed-payment state/i)
    expect(vi.mocked(prisma.reservation.deleteMany)).not.toHaveBeenCalled()
  })

  it('rejects when the reservation status is held (staff hold — not a failed payment)', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue({
      siteId: SITE_ID,
      status: 'held',
    } as any)

    const res = await removeFailedReservation(SITE_ID, RES_ID)
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toMatch(/not in a failed-payment state/i)
    expect(vi.mocked(prisma.reservation.deleteMany)).not.toHaveBeenCalled()
  })

  it('returns error when reservation is not found', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue(null)

    const res = await removeFailedReservation(SITE_ID, RES_ID)
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Reservation not found')
    expect(vi.mocked(prisma.reservation.deleteMany)).not.toHaveBeenCalled()
  })

  it('returns error when reservation belongs to a different site', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue({
      siteId: 'other-site',
      status: 'payment_failed',
    } as any)

    const res = await removeFailedReservation(SITE_ID, RES_ID)
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Reservation not found')
    expect(vi.mocked(prisma.reservation.deleteMany)).not.toHaveBeenCalled()
  })

  it('rejects unauthenticated caller', async () => {
    const res = await removeFailedReservation(SITE_ID, RES_ID)
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authenticated')
    expect(vi.mocked(prisma.reservation.findUnique)).not.toHaveBeenCalled()
  })

  it('rejects non-owner', async () => {
    authenticateAsNonOwner()
    const res = await removeFailedReservation(SITE_ID, RES_ID)
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authorized')
    expect(vi.mocked(prisma.reservation.findUnique)).not.toHaveBeenCalled()
  })
})

// ─── collectReservationPayment / getCollectStatus / cancelCollection ─────────

const COLLECT_FROM = new Date('2026-06-18T00:00:00.000Z')
const COLLECT_TO = new Date('2026-06-18T23:59:59.000Z') // ~1 day → round() = 1
const mockCreatePayment = vi.mocked(createReservationMolliePayment)
const mockReverify = vi.mocked(reverifyAndFinalizeReservation)

function walkInForCollect(overrides: Record<string, any> = {}) {
  return {
    siteId: SITE_ID,
    status: 'paid-in-cash',
    operationalStatus: 'walked-in',
    from: COLLECT_FROM,
    to: COLLECT_TO,
    items: [{ price: 10 }, { price: 10 }],
    site: { type: 'paid', price: 8 },
    ...overrides,
  }
}

describe('collectReservationPayment', () => {
  it('rejects a bed that is not a walk-in', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue(
      walkInForCollect({ status: 'complete', operationalStatus: 'checked-in' }) as any,
    )
    const res = await collectReservationPayment(SITE_ID, RES_ID)
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toContain('walk-in')
    expect(mockCreatePayment).not.toHaveBeenCalled()
  })

  it('rejects a free (non-paid) site', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue(
      walkInForCollect({ site: { type: 'free', price: null } }) as any,
    )
    const res = await collectReservationPayment(SITE_ID, RES_ID)
    expect(res.status).toBe('error')
    expect(mockCreatePayment).not.toHaveBeenCalled()
  })

  it('computes the amount from DB prices, persists it, and creates the payment', async () => {
    process.env.CONSUMER_APP_URL = 'https://app.test'
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue(walkInForCollect() as any)
    vi.mocked(prisma.reservation.update).mockResolvedValue({} as any)

    const res = await collectReservationPayment(SITE_ID, RES_ID)
    expect(res.status).toBe('ok')
    expect((res as any).amount).toBe(20) // (10 + 10) * 1 day
    expect((res as any).checkoutUrl).toBeTruthy()

    // Amount persisted before the provider call (never client-supplied).
    expect(vi.mocked(prisma.reservation.update).mock.calls[0][0].data.paymentAmount).toBe(20)
    // Provider called with the collect metadata + consumer-app URLs.
    const arg = mockCreatePayment.mock.calls[0]
    expect(arg[0]).toBe(RES_ID)
    expect(arg[1].metadataExtra).toEqual({ collect: true })
    expect(arg[1].webhookUrl).toContain('app.test')
    // Standard post-payment redirect, carrying a minted anonId capability.
    expect(arg[1].redirectUrl).toContain('/payment/complete')
    expect(arg[1].redirectUrl).toContain('reservationId=')
    expect(arg[1].redirectUrl).toMatch(/anonId=[0-9a-f-]{36}/)
    // The freshly minted anonId is persisted on the reservation.
    expect(vi.mocked(prisma.reservation.update).mock.calls[0][0].data.anonId).toMatch(/[0-9a-f-]{36}/)
  })

  it('reverts to cash (and clears paymentRef) when the provider fails', async () => {
    process.env.CONSUMER_APP_URL = 'https://app.test'
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue(walkInForCollect() as any)
    vi.mocked(prisma.reservation.update).mockResolvedValue({} as any)
    mockCreatePayment.mockResolvedValueOnce({ status: 'error', error: 'No Mollie', reason: 'no_mollie' })

    const res = await collectReservationPayment(SITE_ID, RES_ID)
    expect(res.status).toBe('error')
    const lastUpdate = vi.mocked(prisma.reservation.update).mock.calls.at(-1)![0]
    expect(lastUpdate.data.status).toBe('paid-in-cash')
    expect(lastUpdate.data.paymentRef).toBeNull()
  })

  it('errors when the consumer app URL is not configured', async () => {
    delete process.env.CONSUMER_APP_URL
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue(walkInForCollect() as any)
    vi.mocked(prisma.reservation.update).mockResolvedValue({} as any)

    const res = await collectReservationPayment(SITE_ID, RES_ID)
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toContain('CONSUMER_APP_URL')
    expect(mockCreatePayment).not.toHaveBeenCalled()
  })
})

describe('getCollectStatus', () => {
  it('reports complete without re-verifying', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue({ siteId: SITE_ID, status: 'complete', paymentRef: 'tr_x' } as any)
    const res = await getCollectStatus(SITE_ID, RES_ID)
    expect((res as any).paymentStatus).toBe('complete')
    expect(mockReverify).not.toHaveBeenCalled()
  })

  it('finalizes a processing payment that has been paid', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue({ siteId: SITE_ID, status: 'processing', paymentRef: 'tr_x' } as any)
    mockReverify.mockResolvedValueOnce({ settled: 'complete', providerStatus: 'paid' })
    const res = await getCollectStatus(SITE_ID, RES_ID)
    expect((res as any).paymentStatus).toBe('complete')
  })

  it('reverts a processing payment that has failed back to cash', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue({ siteId: SITE_ID, status: 'processing', paymentRef: 'tr_x' } as any)
    vi.mocked(prisma.reservation.update).mockResolvedValue({} as any)
    mockReverify.mockResolvedValueOnce({ settled: 'failed', providerStatus: 'expired' })
    const res = await getCollectStatus(SITE_ID, RES_ID)
    expect((res as any).paymentStatus).toBe('failed')
    const u = vi.mocked(prisma.reservation.update).mock.calls.at(-1)![0]
    expect(u.data.status).toBe('paid-in-cash')
    expect(u.data.paymentRef).toBeNull()
  })

  it('reports a plain cash walk-in as cash', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue({ siteId: SITE_ID, status: 'paid-in-cash', paymentRef: null } as any)
    const res = await getCollectStatus(SITE_ID, RES_ID)
    expect((res as any).paymentStatus).toBe('cash')
    expect(mockReverify).not.toHaveBeenCalled()
  })
})

const mockCancelMollie = vi.mocked(cancelReservationMolliePayment)

describe('cancelCollection', () => {
  it('deletes the reservation (frees the seat) when Mollie confirms cancellation', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue({ siteId: SITE_ID, status: 'processing', paymentRef: 'tr_x' } as any)
    vi.mocked(voidSettlementsForReservation).mockResolvedValue(undefined)
    vi.mocked(prisma.reservation.deleteMany).mockResolvedValue({ count: 1 } as any)
    mockReverify.mockResolvedValueOnce({ settled: 'pending' })
    mockCancelMollie.mockResolvedValueOnce({ status: 'canceled' })

    const res = await cancelCollection(SITE_ID, RES_ID)

    expect((res as any).paymentStatus).toBe('freed')
    // Void settlements before delete (FK-safety mirrors unreserveItem).
    expect(vi.mocked(voidSettlementsForReservation)).toHaveBeenCalledWith(RES_ID)
    // Reservation deleted to free the seat.
    const del = vi.mocked(prisma.reservation.deleteMany).mock.calls.at(-1)![0]
    expect(del.where).toEqual({ id: RES_ID, siteId: SITE_ID })
    // Never left as cash.
    expect(vi.mocked(prisma.reservation.update)).not.toHaveBeenCalled()
  })

  it('finalizes as complete when Mollie reports the payment already landed (race)', async () => {
    // Flow: reverify-first returns pending → cancel returns paid → reverify again returns complete.
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue({ siteId: SITE_ID, status: 'processing', paymentRef: 'tr_x' } as any)
    // First reverify (pre-cancel check) says pending; second (post-cancel-paid) says complete.
    mockReverify
      .mockResolvedValueOnce({ settled: 'pending' })
      .mockResolvedValueOnce({ settled: 'complete', providerStatus: 'paid' })
    mockCancelMollie.mockResolvedValueOnce({ status: 'paid' })

    const res = await cancelCollection(SITE_ID, RES_ID)

    expect((res as any).paymentStatus).toBe('complete')
    // No delete, no cash revert.
    expect(vi.mocked(prisma.reservation.deleteMany)).not.toHaveBeenCalled()
    expect(vi.mocked(prisma.reservation.update)).not.toHaveBeenCalled()
  })

  it('reverts to cash (does NOT delete) when Mollie cancellation errors — cannot confirm status', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue({ siteId: SITE_ID, status: 'processing', paymentRef: 'tr_x' } as any)
    vi.mocked(prisma.reservation.update).mockResolvedValue({} as any)
    // Reverify shows still pending (payment not yet settled) — proceeds to cancel call.
    mockReverify.mockResolvedValueOnce({ settled: 'pending' })
    mockCancelMollie.mockResolvedValueOnce({ status: 'error', error: 'network timeout' })

    const res = await cancelCollection(SITE_ID, RES_ID)

    expect((res as any).paymentStatus).toBe('cash')
    // Safe fallback: revert to cash without deleting (late payment might still arrive).
    const u = vi.mocked(prisma.reservation.update).mock.calls.at(-1)![0]
    expect(u.data.status).toBe('paid-in-cash')
    expect(u.data.paymentRef).toBeNull()
    expect(vi.mocked(prisma.reservation.deleteMany)).not.toHaveBeenCalled()
  })

  it('still reverify-first-before-delete path: if reverify shows complete before cancel call, returns complete', async () => {
    // The reverify-first guard (when paymentRef exists) still runs first.
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue({ siteId: SITE_ID, status: 'processing', paymentRef: 'tr_x' } as any)
    mockReverify.mockResolvedValueOnce({ settled: 'complete', providerStatus: 'paid' })

    const res = await cancelCollection(SITE_ID, RES_ID)

    expect((res as any).paymentStatus).toBe('complete')
    // cancelReservationMolliePayment must NOT be called — the payment already landed.
    expect(mockCancelMollie).not.toHaveBeenCalled()
    expect(vi.mocked(prisma.reservation.deleteMany)).not.toHaveBeenCalled()
  })

  it('is a no-op for a reservation that is not mid-collection', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue({ siteId: SITE_ID, status: 'paid-in-cash', paymentRef: null } as any)
    const res = await cancelCollection(SITE_ID, RES_ID)
    expect((res as any).paymentStatus).toBe('cash')
    expect(mockReverify).not.toHaveBeenCalled()
    expect(mockCancelMollie).not.toHaveBeenCalled()
  })
})

// ─── splitWalkInSeat ─────────────────────────────────────────────────────────

const SPLIT_ITEM_ID_B = 'item-b'
const SPLIT_ITEM_ID_C = 'item-c'

/** Build a 3-seat cash walk-in stub. */
function walkInResStub(overrides: Partial<{
  status: string
  operationalStatus: string
  itemCount: number
  siteType: string
}> = {}) {
  const { status = 'paid-in-cash', operationalStatus = 'walked-in', itemCount = 3, siteType = 'paid' } = overrides
  const allItemIds = [ITEM_ID, SPLIT_ITEM_ID_B, SPLIT_ITEM_ID_C].slice(0, itemCount)
  return {
    siteId: SITE_ID,
    status,
    operationalStatus,
    from: new Date('2026-06-21T00:00:00.000Z'),
    to: new Date('2026-06-21T23:59:59.999Z'),
    checkedInAt: new Date('2026-06-21T09:00:00.000Z'),
    guestName: 'Test Party',
    userId: OWNER_ID,
    employeeId: 'emp-1',
    items: allItemIds.map(id => ({ id, price: 10 })),
    site: { type: siteType, price: 10 },
  }
}

describe('splitWalkInSeat', () => {
  it('splits one seat off a 3-seat cash walk-in: original keeps 2 items + reduced amount, new reservation is 1-item walked-in', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue(walkInResStub() as any)

    let createdResId = 'new-res-1'
    vi.mocked(prisma.$transaction).mockImplementationOnce(async (fn: any) => {
      return fn({
        reservation: {
          update: vi.fn().mockResolvedValue({}),
          create: vi.fn().mockResolvedValue({ id: createdResId }),
        },
      })
    })

    const result = await splitWalkInSeat(SITE_ID, RES_ID, ITEM_ID)
    expect(result.status).toBe('ok')
    if (result.status === 'ok') {
      expect(result.reservationId).toBe(createdResId)
    }
  })

  it('disconnect update carries paymentAmount for remaining 2 seats (till conservation)', async () => {
    authenticateAsOwner()
    // 3-seat walk-in, each seat 10€, 1 day → total 30€.
    // Split off ITEM_ID (10€) → remaining 2 seats = 20€.
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue(walkInResStub() as any)

    let capturedUpdateArgs: any = null
    let capturedCreateArgs: any = null

    vi.mocked(prisma.$transaction).mockImplementationOnce(async (fn: any) => {
      const tx = {
        reservation: {
          update: vi.fn().mockImplementation((args) => { capturedUpdateArgs = args; return Promise.resolve({}) }),
          create: vi.fn().mockImplementation((args) => { capturedCreateArgs = args; return Promise.resolve({ id: 'new-res-2' }) }),
        },
      }
      return fn(tx)
    })

    await splitWalkInSeat(SITE_ID, RES_ID, ITEM_ID)

    // Original reservation: disconnect + reduced amount (30 - 10 = 20 for 2 remaining seats).
    expect(capturedUpdateArgs.where).toEqual({ id: RES_ID })
    expect(capturedUpdateArgs.data.paymentAmount).toBe(20)
    expect(capturedUpdateArgs.data.items.disconnect).toEqual([{ id: ITEM_ID }])

    // New reservation: per-seat amount (10€) + attribution copied.
    expect(capturedCreateArgs.data.paymentAmount).toBe(10)
    expect(capturedCreateArgs.data.status).toBe('paid-in-cash')
    expect(capturedCreateArgs.data.operationalStatus).toBe('walked-in')
    expect(capturedCreateArgs.data.employeeId).toBe('emp-1')
    expect(capturedCreateArgs.data.guestName).toBe('Test Party')
    expect(capturedCreateArgs.data.items.connect).toEqual([{ id: ITEM_ID }])
  })

  it('rejects online checked-in (complete) reservation', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue(
      walkInResStub({ status: 'complete', operationalStatus: 'walked-in' }) as any
    )
    const result = await splitWalkInSeat(SITE_ID, RES_ID, ITEM_ID)
    expect(result.status).toBe('error')
    expect(result.errors?.[0]).toMatch(/cash walk-in/i)
  })

  it('rejects a single-seat walk-in (nothing to split)', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue(
      walkInResStub({ itemCount: 1 }) as any
    )
    const result = await splitWalkInSeat(SITE_ID, RES_ID, ITEM_ID)
    expect(result.status).toBe('error')
    expect(result.errors?.[0]).toMatch(/only one seat/i)
  })

  it('rejects when the tapped item is not on the reservation', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue(
      walkInResStub() as any
    )
    const result = await splitWalkInSeat(SITE_ID, RES_ID, 'no-such-item')
    expect(result.status).toBe('error')
    expect(result.errors?.[0]).toMatch(/item not found/i)
  })

  it('sets paymentAmount to 0 for a free site regardless of item prices', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue(
      walkInResStub({ siteType: 'free' }) as any
    )

    let capturedUpdateArgs: any = null
    let capturedCreateArgs: any = null
    vi.mocked(prisma.$transaction).mockImplementationOnce(async (fn: any) => {
      const tx = {
        reservation: {
          update: vi.fn().mockImplementation((args) => { capturedUpdateArgs = args; return Promise.resolve({}) }),
          create: vi.fn().mockImplementation((args) => { capturedCreateArgs = args; return Promise.resolve({ id: 'new-res-3' }) }),
        },
      }
      return fn(tx)
    })

    await splitWalkInSeat(SITE_ID, RES_ID, ITEM_ID)

    expect(capturedUpdateArgs.data.paymentAmount).toBe(0)
    expect(capturedCreateArgs.data.paymentAmount).toBe(0)
  })

  it('rejects unauthenticated caller', async () => {
    const result = await splitWalkInSeat(SITE_ID, RES_ID, ITEM_ID)
    expect(result.status).toBe('error')
  })
})

describe('findReservations', () => {
  it('rejects unauthenticated caller', async () => {
    const res = await findReservations(SITE_ID)
    expect(res.status).toBe('error')
    expect(vi.mocked(prisma.reservation.findMany)).not.toHaveBeenCalled()
  })

  it('rejects non-owner', async () => {
    authenticateAsNonOwner()
    const res = await findReservations(SITE_ID)
    expect(res.status).toBe('error')
    expect(vi.mocked(prisma.reservation.findMany)).not.toHaveBeenCalled()
  })

  it('no query → today arrivals: expected, complete|held, today overlap, scoped to the site', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findMany).mockResolvedValueOnce([])

    const res = await findReservations(SITE_ID)
    expect(res.status).toBe('ok')

    const args = vi.mocked(prisma.reservation.findMany).mock.calls[0]![0] as any
    expect(args.where.siteId).toBe(SITE_ID)
    expect(args.where.operationalStatus).toBe('expected')
    expect(args.where.status).toEqual({ in: ['complete', 'held'] })
    // overlap-with-today, no name search
    expect(args.where.from).toBeDefined()
    expect(args.where.to).toBeDefined()
    expect(args.where.OR).toBeUndefined()
    // capped + date-sorted
    expect(args.take).toBeGreaterThan(0)
    expect(args.orderBy).toEqual({ from: 'asc' })
  })

  it('query → name/contact/SEAT/consumer OR search; excludes canceled/refunded + blocks; owner-scoped user match', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findMany).mockResolvedValueOnce([])

    await findReservations(SITE_ID, '  garcia  ') // trims

    const args = vi.mocked(prisma.reservation.findMany).mock.calls[0]![0] as any
    expect(args.where.siteId).toBe(SITE_ID)
    expect(args.where.status).toEqual({ notIn: ['canceled', 'refunded'] })
    // blocks are out-of-service markers, not guests — excluded from results
    expect(args.where.operationalStatus).toEqual({ not: 'blocked' })
    const or = args.where.OR as any[]
    expect(or.find((c) => c.guestName)?.guestName).toEqual({ contains: 'garcia', mode: 'insensitive' })
    expect(or.some((c) => c.guestContact)).toBe(true)
    // seat / bed number search (matches the on-grid seatLabel)
    expect(or.some((c) => c.items?.some?.seatLabel)).toBe(true)
    // user.email / user.name matched ONLY on consumer bookings (userId ≠ owner),
    // so the owner's identity never surfaces their staff-created bookings.
    const emailClause = or.find((c) => Array.isArray(c.AND) && c.AND.some((x: any) => x.user?.email))
    expect(emailClause).toBeTruthy()
    expect(emailClause.AND.some((x: any) => x.userId?.not)).toBe(true)
    const nameClause = or.find((c) => Array.isArray(c.AND) && c.AND.some((x: any) => x.user?.name))
    expect(nameClause.AND.some((x: any) => x.userId?.not)).toBe(true)
  })

  it('maps rows to summaries with partySize, bed numbers, and account email', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findMany).mockResolvedValueOnce([
      {
        id: 'r1', status: 'complete', operationalStatus: 'expected',
        from: new Date('2026-06-20'), to: new Date('2026-06-20'),
        guestName: 'Maria Garcia', guestContact: null, internalNotes: 'VIP', paymentRef: 'tr_x',
        items: [{ id: 'i1', number: 12, seatLabel: null }, { id: 'i2', number: 13, seatLabel: null }],
        user: { email: 'm@x.com' },
      },
    ] as any)

    const res = await findReservations(SITE_ID, 'garcia')
    expect(res.status).toBe('ok')
    const row = (res as any).reservations[0]
    expect(row.partySize).toBe(2)
    expect(row.items.map((i: any) => i.number)).toEqual([12, 13])
    expect(row.userEmail).toBe('m@x.com')
    expect(row.guestName).toBe('Maria Garcia')
  })
})

// ─── reserveItems (grouped walk-in) ────────────────────────────────────────

describe('reserveItems', () => {
  it('rejects unauthenticated caller', async () => {
    const res = await reserveItems(SITE_ID, [ITEM_ID])
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authenticated')
    expect(mockGuard).not.toHaveBeenCalled()
  })

  it('rejects non-owner', async () => {
    authenticateAsNonOwner()
    const res = await reserveItems(SITE_ID, [ITEM_ID])
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authorized')
    expect(mockGuard).not.toHaveBeenCalled()
  })

  it('rejects empty itemIds array', async () => {
    authenticateAsOwner()
    const res = await reserveItems(SITE_ID, [])
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toMatch(/no items selected/i)
    expect(mockGuard).not.toHaveBeenCalled()
  })

  it('creates ONE reservation connecting ALL selected ids (happy path)', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.site.findUnique).mockResolvedValue({ userId: OWNER_ID, type: 'free', price: null } as any)
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([{ price: null }, { price: null }] as any)

    const res = await reserveItems(SITE_ID, [ITEM_ID, 'item-2', 'item-3'])
    expect(res.status).toBe('ok')

    expect(mockGuard).toHaveBeenCalledTimes(1)
    const call = mockGuard.mock.calls[0][0]
    expect(call.itemIds).toEqual([ITEM_ID, 'item-2', 'item-3'])
    expect(call.siteId).toBe(SITE_ID)
    expect(call.status).toBe('paid-in-cash')
    expect(call.operationalStatus).toBe('walked-in')
    expect(call.checkedInAt).toBeInstanceOf(Date)
    // No extra pair expansion: exactly what was passed
    expect(call.itemIds).toHaveLength(3)
  })

  it('sums paymentAmount across all seats × days from DB prices only (paid site)', async () => {
    authenticateAsOwner()
    // Override site.findUnique: PAID site with a default price of 10
    vi.mocked(prisma.site.findUnique).mockResolvedValue({ userId: OWNER_ID, type: 'paid', price: 10 } as any)
    // Two items: one has its own price (15), the other falls back to site price (10)
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([
      { price: 15 },
      { price: null },
    ] as any)

    // today-only (1 day): sum = 15 + 10 = 25
    await reserveItems(SITE_ID, [ITEM_ID, 'item-2'])

    const call = mockGuard.mock.calls[0][0]
    expect(call.paymentAmount).toBe(25)
  })

  it('paymentAmount is 0 for a free site regardless of item prices', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.site.findUnique).mockResolvedValue({ userId: OWNER_ID, type: 'free', price: 20 } as any)
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([{ price: 20 }, { price: 20 }] as any)

    await reserveItems(SITE_ID, [ITEM_ID, 'item-2'])

    const call = mockGuard.mock.calls[0][0]
    expect(call.paymentAmount).toBe(0)
  })

  it('sums across multiple days when `until` extends the stay', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.site.findUnique).mockResolvedValue({ userId: OWNER_ID, type: 'paid', price: 10 } as any)
    // 2 seats, each € 10/day, 3 days → 60
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([{ price: 10 }, { price: 10 }] as any)

    const until = dayjs().add(2, 'day').format('YYYY-MM-DD')
    await reserveItems(SITE_ID, [ITEM_ID, 'item-2'], undefined, undefined, undefined, until)

    const call = mockGuard.mock.calls[0][0]
    expect(call.paymentAmount).toBe(60)
  })

  it('returns error when guard returns a conflict — creates nothing', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.site.findUnique).mockResolvedValue({ userId: OWNER_ID, type: 'free', price: null } as any)
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([] as any)
    mockGuard.mockResolvedValueOnce({ outcome: 'conflict', conflictingReservationId: 'existing' })

    const res = await reserveItems(SITE_ID, [ITEM_ID, 'item-2'])
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toMatch(/already reserved/i)
    // Guard was called once; no direct prisma.reservation.create
    expect(vi.mocked(prisma.reservation.create)).not.toHaveBeenCalled()
  })

  it('passes guestName and internalNotes (truncated) to guard', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.site.findUnique).mockResolvedValue({ userId: OWNER_ID, type: 'free', price: null } as any)
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([] as any)

    await reserveItems(SITE_ID, [ITEM_ID], 'A'.repeat(300), 'B'.repeat(600))

    const call = mockGuard.mock.calls[0][0]
    expect(call.guestName).toHaveLength(200)
    expect(call.internalNotes).toHaveLength(500)
  })

  it('rejects an invalid `until` date', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.site.findUnique).mockResolvedValue({ userId: OWNER_ID, type: 'free', price: null } as any)

    const res = await reserveItems(SITE_ID, [ITEM_ID], undefined, undefined, undefined, 'not-a-date')
    expect(res.status).toBe('error')
    expect(mockGuard).not.toHaveBeenCalled()
  })

  it('rejects an `until` date in the past', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.site.findUnique).mockResolvedValue({ userId: OWNER_ID, type: 'free', price: null } as any)

    const past = dayjs().subtract(1, 'day').format('YYYY-MM-DD')
    const res = await reserveItems(SITE_ID, [ITEM_ID], undefined, undefined, undefined, past)
    expect(res.status).toBe('error')
    expect(mockGuard).not.toHaveBeenCalled()
  })

  it('rejects a range longer than 90 days', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.site.findUnique).mockResolvedValue({ userId: OWNER_ID, type: 'free', price: null } as any)

    const far = dayjs().add(91, 'day').format('YYYY-MM-DD')
    const res = await reserveItems(SITE_ID, [ITEM_ID], undefined, undefined, undefined, far)
    expect(res.status).toBe('error')
    expect(mockGuard).not.toHaveBeenCalled()
  })

  it('records ONE TillEntry and returns reservationId when recordCashSettlement=true on a paid site', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.site.findUnique).mockResolvedValue({
      userId: OWNER_ID, type: 'paid', price: 10,
      timeZone: null, locationLat: null, locationLng: null,
    } as any)
    // Two seats: item price 15, item price null → falls back to site price 10; sum = 25
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([{ price: 15 }, { price: null }] as any)
    mockGuard.mockResolvedValueOnce({ outcome: 'created', reservationId: 'r-bulk-cash' })

    const res = await reserveItems(SITE_ID, [ITEM_ID, 'item-2'], undefined, undefined, undefined, undefined, undefined, true)

    expect(res.status).toBe('ok')
    expect((res as any).reservationId).toBe('r-bulk-cash')

    const mockRecord = vi.mocked(recordSettlement)
    expect(mockRecord).toHaveBeenCalledOnce()
    expect(mockRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        siteId: SITE_ID,
        reservationId: 'r-bulk-cash',
        amount: 25,
      }),
    )
  })

  it('does NOT record a TillEntry when recordCashSettlement=false (card/QR path)', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.site.findUnique).mockResolvedValue({
      userId: OWNER_ID, type: 'paid', price: 20,
      timeZone: null, locationLat: null, locationLng: null,
    } as any)
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([{ price: null }] as any)
    mockGuard.mockResolvedValueOnce({ outcome: 'created', reservationId: 'r-bulk-card' })

    const res = await reserveItems(SITE_ID, [ITEM_ID], undefined, undefined, undefined, undefined, undefined, false)

    expect(res.status).toBe('ok')
    expect((res as any).reservationId).toBe('r-bulk-card')
    expect(vi.mocked(recordSettlement)).not.toHaveBeenCalled()
  })

  it('does NOT record a TillEntry on a free site even when recordCashSettlement=true', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.site.findUnique).mockResolvedValue({
      userId: OWNER_ID, type: 'free', price: null,
      timeZone: null, locationLat: null, locationLng: null,
    } as any)
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([{ price: null }] as any)
    mockGuard.mockResolvedValueOnce({ outcome: 'created', reservationId: 'r-free-bulk' })

    const res = await reserveItems(SITE_ID, [ITEM_ID], undefined, undefined, undefined, undefined, undefined, true)

    expect(res.status).toBe('ok')
    expect(vi.mocked(recordSettlement)).not.toHaveBeenCalled()
  })

  it('returns reservationId from the guard in the ok response (default no-cash path)', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.site.findUnique).mockResolvedValue({ userId: OWNER_ID, type: 'free', price: null } as any)
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([{ price: null }] as any)
    mockGuard.mockResolvedValueOnce({ outcome: 'created', reservationId: 'r-bulk-id' })

    const res = await reserveItems(SITE_ID, [ITEM_ID])

    expect(res.status).toBe('ok')
    expect((res as any).reservationId).toBe('r-bulk-id')
  })
})

// ─── holdBeds (grouped hold) ────────────────────────────────────────────────

describe('holdBeds', () => {
  it('rejects unauthenticated caller', async () => {
    const res = await holdBeds(SITE_ID, [ITEM_ID])
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authenticated')
    expect(mockGuard).not.toHaveBeenCalled()
  })

  it('rejects non-owner', async () => {
    authenticateAsNonOwner()
    const res = await holdBeds(SITE_ID, [ITEM_ID])
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authorized')
    expect(mockGuard).not.toHaveBeenCalled()
  })

  it('rejects empty itemIds array', async () => {
    authenticateAsOwner()
    const res = await holdBeds(SITE_ID, [])
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toMatch(/no items selected/i)
    expect(mockGuard).not.toHaveBeenCalled()
  })

  it('creates ONE held reservation over ALL selected ids', async () => {
    authenticateAsOwner()

    const res = await holdBeds(SITE_ID, [ITEM_ID, 'item-2', 'item-3'])
    expect(res.status).toBe('ok')

    expect(mockGuard).toHaveBeenCalledTimes(1)
    const call = mockGuard.mock.calls[0][0]
    expect(call.itemIds).toEqual([ITEM_ID, 'item-2', 'item-3'])
    expect(call.siteId).toBe(SITE_ID)
    expect(call.status).toBe('held')
    expect(call.operationalStatus).toBe('expected')
    // Hold has no checkedInAt
    expect(call.checkedInAt).toBeUndefined()
  })

  it('paymentAmount is always 0 (hold — no cash taken)', async () => {
    authenticateAsOwner()

    await holdBeds(SITE_ID, [ITEM_ID, 'item-2'])

    const call = mockGuard.mock.calls[0][0]
    expect(call.paymentAmount).toBe(0)
  })

  it('passes guestName and notes (truncated) to guard', async () => {
    authenticateAsOwner()

    await holdBeds(SITE_ID, [ITEM_ID], undefined, 'A'.repeat(300), 'B'.repeat(600))

    const call = mockGuard.mock.calls[0][0]
    expect(call.guestName).toHaveLength(200)
    expect(call.internalNotes).toHaveLength(500)
  })

  it('returns error when guard detects a conflict', async () => {
    authenticateAsOwner()
    mockGuard.mockResolvedValueOnce({ outcome: 'conflict', conflictingReservationId: 'existing' })

    const res = await holdBeds(SITE_ID, [ITEM_ID, 'item-2'])
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toMatch(/already occupied or blocked/i)
    expect(vi.mocked(prisma.reservation.create)).not.toHaveBeenCalled()
  })
})

// ─── holdBeds — multi-day until param ───────────────────────────────────────

describe('holdBeds — multi-day until param', () => {
  it('falls back to today-only when until is not provided', async () => {
    authenticateAsOwner()

    await holdBeds(SITE_ID, [ITEM_ID])

    const { end: expectedTo } = siteDayBounds({}) // Madrid fallback
    const call = mockGuard.mock.calls[0][0]
    expect((call.to as Date).getTime()).toBe(expectedTo.getTime())
  })

  it('extends `to` to the end of the given until date', async () => {
    authenticateAsOwner()
    const until = dayjs().add(3, 'day').format('YYYY-MM-DD')

    const res = await holdBeds(SITE_ID, [ITEM_ID, 'item-2'], undefined, undefined, undefined, undefined, until)
    expect(res.status).toBe('ok')

    const expectedTo = siteDayBounds({}, new Date(until + 'T12:00:00.000Z')).end
    const call = mockGuard.mock.calls[0][0]
    expect((call.to as Date).getTime()).toBe(expectedTo.getTime())
  })

  it('rejects an invalid until date', async () => {
    authenticateAsOwner()
    const res = await holdBeds(SITE_ID, [ITEM_ID], undefined, undefined, undefined, undefined, 'not-a-date')
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toMatch(/invalid date/i)
    expect(mockGuard).not.toHaveBeenCalled()
  })

  it('rejects until in the past', async () => {
    authenticateAsOwner()
    const past = dayjs().subtract(1, 'day').format('YYYY-MM-DD')
    const res = await holdBeds(SITE_ID, [ITEM_ID], undefined, undefined, undefined, undefined, past)
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toMatch(/past/i)
    expect(mockGuard).not.toHaveBeenCalled()
  })

  it('rejects until more than 90 days out', async () => {
    authenticateAsOwner()
    const far = dayjs().add(91, 'day').format('YYYY-MM-DD')
    const res = await holdBeds(SITE_ID, [ITEM_ID], undefined, undefined, undefined, undefined, far)
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toMatch(/90 days/i)
    expect(mockGuard).not.toHaveBeenCalled()
  })
})

// ─── collectRentalPayment / getRentalCollectStatus / cancelRentalCollection ──

const BOOKING_ID = 'rb-1'
const mockCreateRentalPayment = vi.mocked(createRentalBookingMolliePayment)
const mockReverifyRental = vi.mocked(reverifyAndFinalizeRentalBooking)

/** A cash walk-in rental booking that is ready to be collected. */
function cashWalkInBooking(overrides: Record<string, any> = {}) {
  return {
    id: BOOKING_ID,
    siteId: SITE_ID,
    status: 'paid-in-cash',
    paymentAmount: 15,
    anonId: null,
    ...overrides,
  }
}

describe('collectRentalPayment', () => {
  it('rejects an empty booking list', async () => {
    authenticateAsOwner()
    const res = await collectRentalPayment(SITE_ID, [])
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toMatch(/no rental bookings/i)
    expect(vi.mocked(prisma.rentalBooking.findMany)).not.toHaveBeenCalled()
  })

  it('rejects a booking that belongs to a different site', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.rentalBooking.findMany).mockResolvedValueOnce([
      cashWalkInBooking({ siteId: 'other-site' }),
    ] as any)
    const res = await collectRentalPayment(SITE_ID, [BOOKING_ID])
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toMatch(/does not belong/i)
    expect(mockCreateRentalPayment).not.toHaveBeenCalled()
  })

  it('rejects a booking that is not a cash walk-in (already processing)', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.rentalBooking.findMany).mockResolvedValueOnce([
      cashWalkInBooking({ status: 'processing' }),
    ] as any)
    const res = await collectRentalPayment(SITE_ID, [BOOKING_ID])
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toMatch(/cash walk-in/i)
    expect(mockCreateRentalPayment).not.toHaveBeenCalled()
  })

  it('rejects a booking that is already complete', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.rentalBooking.findMany).mockResolvedValueOnce([
      cashWalkInBooking({ status: 'complete' }),
    ] as any)
    const res = await collectRentalPayment(SITE_ID, [BOOKING_ID])
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toMatch(/cash walk-in/i)
    expect(mockCreateRentalPayment).not.toHaveBeenCalled()
  })

  it('mints an anonId, stamps all bookings, and creates the payment (happy path)', async () => {
    process.env.CONSUMER_APP_URL = 'https://app.test'
    authenticateAsOwner()
    vi.mocked(prisma.rentalBooking.findMany).mockResolvedValueOnce([
      cashWalkInBooking({ paymentAmount: 10 }),
      cashWalkInBooking({ id: 'rb-2', paymentAmount: 20 }),
    ] as any)
    vi.mocked(prisma.rentalBooking.updateMany).mockResolvedValueOnce({ count: 2 } as any)

    const res = await collectRentalPayment(SITE_ID, [BOOKING_ID, 'rb-2'])
    expect(res.status).toBe('ok')
    expect((res as any).amount).toBe(30) // 10 + 20
    expect((res as any).checkoutUrl).toBeTruthy()
    expect((res as any).bookingId).toBe(BOOKING_ID)

    // anonId stamped on bookings missing it
    const anonUpdate = vi.mocked(prisma.rentalBooking.updateMany).mock.calls[0][0] as any
    expect(anonUpdate.data.anonId).toMatch(/[0-9a-f-]{36}/)

    // Provider called with redirect URL including primaryId and anonId
    const [ids, opts] = mockCreateRentalPayment.mock.calls[0]
    expect(ids).toEqual([BOOKING_ID, 'rb-2'])
    expect(opts.metadataExtra).toEqual({ collect: true })
    expect(opts.redirectUrl).toContain('/payment/complete/rental')
    expect(opts.redirectUrl).toContain(`rentalBookingId=${BOOKING_ID}`)
    expect(opts.redirectUrl).toMatch(/anonId=[0-9a-f-]{36}/)
    expect(opts.webhookUrl).toContain('app.test')
  })

  it('reuses an existing anonId rather than minting a new one', async () => {
    process.env.CONSUMER_APP_URL = 'https://app.test'
    authenticateAsOwner()
    vi.mocked(prisma.rentalBooking.findMany).mockResolvedValueOnce([
      cashWalkInBooking({ anonId: 'existing-anon-id' }),
    ] as any)
    // No updateMany for anonId expected (anonId already exists); but mock it in
    // case the action somehow calls it (returns empty count — safe).
    vi.mocked(prisma.rentalBooking.updateMany).mockResolvedValueOnce({ count: 0 } as any)

    await collectRentalPayment(SITE_ID, [BOOKING_ID])

    // No extra updateMany to stamp anonId (it already existed)
    const anonUpdateCalls = vi.mocked(prisma.rentalBooking.updateMany).mock.calls.filter(
      (c) => (c[0] as any).data?.anonId !== undefined,
    )
    expect(anonUpdateCalls).toHaveLength(0)

    const [, opts] = mockCreateRentalPayment.mock.calls[0]
    expect(opts.redirectUrl).toContain('anonId=existing-anon-id')
  })

  // NOTE: The `DEMO_MODE` constant is captured at module load time
  // (`process.env.NEXT_PUBLIC_DEMO_MODE === 'true'`), so the demo branch cannot
  // be exercised in unit tests by toggling the env var at runtime. The demo path
  // is covered by the reservation-payment module's own tests and by
  // e2e/integration tests that load the module fresh with the env set.

  it('reverts all bookings to cash (clears paymentRef) when the provider fails', async () => {
    process.env.CONSUMER_APP_URL = 'https://app.test'
    authenticateAsOwner()
    vi.mocked(prisma.rentalBooking.findMany).mockResolvedValueOnce([
      cashWalkInBooking(),
      cashWalkInBooking({ id: 'rb-2', paymentAmount: 5 }),
    ] as any)
    // Two updateMany calls: (1) stamp anonId, (2) revert to paid-in-cash on failure
    vi.mocked(prisma.rentalBooking.updateMany)
      .mockResolvedValueOnce({ count: 2 } as any) // anonId stamp
      .mockResolvedValueOnce({ count: 2 } as any) // revert
    mockCreateRentalPayment.mockResolvedValueOnce({
      status: 'error',
      error: 'No Mollie',
      reason: 'no_mollie',
    })

    const res = await collectRentalPayment(SITE_ID, [BOOKING_ID, 'rb-2'])
    expect(res.status).toBe('error')
    // Revert call: status → paid-in-cash, paymentRef → null on all booking ids
    const revertCall = vi.mocked(prisma.rentalBooking.updateMany).mock.calls.find(
      (c) => (c[0] as any).data?.status === 'paid-in-cash',
    )
    expect(revertCall).toBeDefined()
    expect((revertCall![0] as any).data.paymentRef).toBeNull()
    expect((revertCall![0] as any).where.id.in).toEqual([BOOKING_ID, 'rb-2'])
  })

  it('errors when CONSUMER_APP_URL is not configured', async () => {
    delete process.env.CONSUMER_APP_URL
    authenticateAsOwner()
    vi.mocked(prisma.rentalBooking.findMany).mockResolvedValueOnce([cashWalkInBooking()] as any)
    vi.mocked(prisma.rentalBooking.updateMany).mockResolvedValueOnce({ count: 1 } as any)

    const res = await collectRentalPayment(SITE_ID, [BOOKING_ID])
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toContain('CONSUMER_APP_URL')
    expect(mockCreateRentalPayment).not.toHaveBeenCalled()
  })

  it('rejects unauthenticated caller', async () => {
    const res = await collectRentalPayment(SITE_ID, [BOOKING_ID])
    expect(res.status).toBe('error')
    expect(mockCreateRentalPayment).not.toHaveBeenCalled()
  })

  it('rejects non-owner', async () => {
    authenticateAsNonOwner()
    const res = await collectRentalPayment(SITE_ID, [BOOKING_ID])
    expect(res.status).toBe('error')
    expect(mockCreateRentalPayment).not.toHaveBeenCalled()
  })
})

describe('getRentalCollectStatus', () => {
  it('reports complete without re-verifying when booking is already complete', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.rentalBooking.findUnique).mockResolvedValueOnce({
      siteId: SITE_ID, status: 'complete', paymentRef: 'tr_x',
    } as any)
    const res = await getRentalCollectStatus(SITE_ID, BOOKING_ID)
    expect((res as any).paymentStatus).toBe('complete')
    expect(mockReverifyRental).not.toHaveBeenCalled()
  })

  it('finalizes a processing payment that has been paid', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.rentalBooking.findUnique).mockResolvedValueOnce({
      siteId: SITE_ID, status: 'processing', paymentRef: 'tr_x',
    } as any)
    mockReverifyRental.mockResolvedValueOnce({ settled: 'complete', providerStatus: 'paid' })
    const res = await getRentalCollectStatus(SITE_ID, BOOKING_ID)
    expect((res as any).paymentStatus).toBe('complete')
  })

  it('reverts the whole group to cash when the payment failed', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.rentalBooking.findUnique).mockResolvedValueOnce({
      siteId: SITE_ID, status: 'processing', paymentRef: 'tr_shared_ref',
    } as any)
    vi.mocked(prisma.rentalBooking.updateMany).mockResolvedValue({ count: 2 } as any)
    mockReverifyRental.mockResolvedValueOnce({ settled: 'failed', providerStatus: 'expired' })

    const res = await getRentalCollectStatus(SITE_ID, BOOKING_ID)
    expect((res as any).paymentStatus).toBe('failed')
    // Revert must key on the shared paymentRef (not just the bookingId)
    const revertCall = vi.mocked(prisma.rentalBooking.updateMany).mock.calls.at(-1)![0] as any
    expect(revertCall.where.paymentRef).toBe('tr_shared_ref')
    expect(revertCall.where.siteId).toBe(SITE_ID)
    expect(revertCall.data.status).toBe('paid-in-cash')
    expect(revertCall.data.paymentRef).toBeNull()
  })

  it('reports cash for a plain cash walk-in booking', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.rentalBooking.findUnique).mockResolvedValueOnce({
      siteId: SITE_ID, status: 'paid-in-cash', paymentRef: null,
    } as any)
    const res = await getRentalCollectStatus(SITE_ID, BOOKING_ID)
    expect((res as any).paymentStatus).toBe('cash')
    expect(mockReverifyRental).not.toHaveBeenCalled()
  })

  it('reports processing while payment is still in flight', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.rentalBooking.findUnique).mockResolvedValueOnce({
      siteId: SITE_ID, status: 'processing', paymentRef: 'tr_x',
    } as any)
    mockReverifyRental.mockResolvedValueOnce({ settled: 'pending' })
    const res = await getRentalCollectStatus(SITE_ID, BOOKING_ID)
    expect((res as any).paymentStatus).toBe('processing')
  })

  it('rejects unauthenticated caller', async () => {
    const res = await getRentalCollectStatus(SITE_ID, BOOKING_ID)
    expect(res.status).toBe('error')
  })

  it('rejects non-owner', async () => {
    authenticateAsNonOwner()
    const res = await getRentalCollectStatus(SITE_ID, BOOKING_ID)
    expect(res.status).toBe('error')
  })
})

describe('cancelRentalCollection', () => {
  it('reverts an unpaid in-flight collection to cash (whole group)', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.rentalBooking.findUnique).mockResolvedValueOnce({
      siteId: SITE_ID, status: 'processing', paymentRef: 'tr_shared_ref',
    } as any)
    vi.mocked(prisma.rentalBooking.updateMany).mockResolvedValue({ count: 2 } as any)
    mockReverifyRental.mockResolvedValueOnce({ settled: 'pending' })

    const res = await cancelRentalCollection(SITE_ID, BOOKING_ID)
    expect((res as any).paymentStatus).toBe('cash')
    const revertCall = vi.mocked(prisma.rentalBooking.updateMany).mock.calls.at(-1)![0] as any
    expect(revertCall.where.paymentRef).toBe('tr_shared_ref')
    expect(revertCall.data.status).toBe('paid-in-cash')
    expect(revertCall.data.paymentRef).toBeNull()
  })

  it('finalizes instead of reverting when the payment actually went through', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.rentalBooking.findUnique).mockResolvedValueOnce({
      siteId: SITE_ID, status: 'processing', paymentRef: 'tr_x',
    } as any)
    mockReverifyRental.mockResolvedValueOnce({ settled: 'complete', providerStatus: 'paid' })

    const res = await cancelRentalCollection(SITE_ID, BOOKING_ID)
    expect((res as any).paymentStatus).toBe('complete')
    expect(vi.mocked(prisma.rentalBooking.updateMany)).not.toHaveBeenCalled()
    expect(vi.mocked(prisma.rentalBooking.update)).not.toHaveBeenCalled()
  })

  it('is a no-op for a cash booking (not mid-collection)', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.rentalBooking.findUnique).mockResolvedValueOnce({
      siteId: SITE_ID, status: 'paid-in-cash', paymentRef: null,
    } as any)

    const res = await cancelRentalCollection(SITE_ID, BOOKING_ID)
    expect((res as any).paymentStatus).toBe('cash')
    expect(mockReverifyRental).not.toHaveBeenCalled()
    expect(vi.mocked(prisma.rentalBooking.updateMany)).not.toHaveBeenCalled()
    expect(vi.mocked(prisma.rentalBooking.update)).not.toHaveBeenCalled()
  })

  it('is a no-op for an already-complete booking', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.rentalBooking.findUnique).mockResolvedValueOnce({
      siteId: SITE_ID, status: 'complete', paymentRef: 'tr_x',
    } as any)

    const res = await cancelRentalCollection(SITE_ID, BOOKING_ID)
    expect((res as any).paymentStatus).toBe('complete')
    expect(mockReverifyRental).not.toHaveBeenCalled()
  })

  it('rejects unauthenticated caller', async () => {
    const res = await cancelRentalCollection(SITE_ID, BOOKING_ID)
    expect(res.status).toBe('error')
  })

  it('rejects non-owner', async () => {
    authenticateAsNonOwner()
    const res = await cancelRentalCollection(SITE_ID, BOOKING_ID)
    expect(res.status).toBe('error')
  })
})

// ─── holdBed — multi-day until param ────────────────────────────────────────

describe('holdBed — multi-day until param', () => {
  it('saves the multi-day period when until is provided', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.inventoryItem.findUnique).mockResolvedValue(null)
    const until = dayjs().add(3, 'day').format('YYYY-MM-DD')

    const res = await holdBed(SITE_ID, ITEM_ID, undefined, false, undefined, undefined, undefined, until)
    expect(res.status).toBe('ok')

    const { start: expectedFrom } = siteDayBounds({}) // Madrid fallback
    const expectedTo = siteDayBounds({}, new Date(until + 'T12:00:00.000Z')).end
    const guardCall = mockGuard.mock.calls[0][0]
    expect((guardCall.from as Date).getTime()).toBe(expectedFrom.getTime())
    // to should be venue-local end of the until day, not server-tz end-of-today
    expect((guardCall.to as Date).getTime()).toBe(expectedTo.getTime())
  })

  it('falls back to today-only when until is not provided', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.inventoryItem.findUnique).mockResolvedValue(null)

    await holdBed(SITE_ID, ITEM_ID, undefined, false)

    const { end: expectedTo } = siteDayBounds({}) // Madrid fallback
    const guardCall = mockGuard.mock.calls[0][0]
    expect((guardCall.to as Date).getTime()).toBe(expectedTo.getTime())
  })

  it('rejects an invalid until date', async () => {
    authenticateAsOwner()
    const res = await holdBed(SITE_ID, ITEM_ID, undefined, false, undefined, undefined, undefined, 'not-a-date')
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toMatch(/invalid date/i)
    expect(mockGuard).not.toHaveBeenCalled()
  })

  it('rejects until in the past', async () => {
    authenticateAsOwner()
    const past = dayjs().subtract(1, 'day').format('YYYY-MM-DD')
    const res = await holdBed(SITE_ID, ITEM_ID, undefined, false, undefined, undefined, undefined, past)
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toMatch(/past/i)
    expect(mockGuard).not.toHaveBeenCalled()
  })

  it('rejects until more than 90 days out', async () => {
    authenticateAsOwner()
    const far = dayjs().add(91, 'day').format('YYYY-MM-DD')
    const res = await holdBed(SITE_ID, ITEM_ID, undefined, false, undefined, undefined, undefined, far)
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toMatch(/90 days/i)
    expect(mockGuard).not.toHaveBeenCalled()
  })
})

// ─── resumeWalkIn ────────────────────────────────────────────────────────────

describe('resumeWalkIn', () => {
  it('transitions expected -> walked-in with checkedInAt stamped', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue({
      siteId: SITE_ID,
      operationalStatus: 'expected',
      site: SITE_TZ_STUB,
    } as any)
    vi.mocked(prisma.reservationDay.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.reservationDay.upsert).mockResolvedValue({
      id: 'rd-1', reservationId: RES_ID, date: new Date(), operationalStatus: 'walked-in',
      checkedInAt: new Date(), departedAt: null,
    } as any)
    vi.mocked(prisma.reservation.update).mockResolvedValue({} as any)

    const res = await resumeWalkIn(SITE_ID, RES_ID)
    expect(res.status).toBe('ok')

    const updateCall = vi.mocked(prisma.reservation.update).mock.calls[0][0]
    expect(updateCall.data.operationalStatus).toBe('walked-in')
    expect(updateCall.data.checkedInAt).toBeInstanceOf(Date)
    expect(vi.mocked(prisma.reservationDay.upsert)).toHaveBeenCalledOnce()
  })

  it('rejects when effective status is already walked-in (not expected)', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue({
      siteId: SITE_ID,
      operationalStatus: 'walked-in',
      site: SITE_TZ_STUB,
    } as any)
    vi.mocked(prisma.reservationDay.findUnique).mockResolvedValue({
      operationalStatus: 'walked-in',
    } as any)

    const res = await resumeWalkIn(SITE_ID, RES_ID)
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toContain('Cannot resume walk-in')
  })

  it('rejects when effective status is checked-in', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue({
      siteId: SITE_ID,
      operationalStatus: 'checked-in',
      site: SITE_TZ_STUB,
    } as any)
    vi.mocked(prisma.reservationDay.findUnique).mockResolvedValue({
      operationalStatus: 'checked-in',
    } as any)

    const res = await resumeWalkIn(SITE_ID, RES_ID)
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toContain('Cannot resume walk-in')
  })

  it('rejects when reservation belongs to a different site', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue({
      siteId: 'other-site',
      operationalStatus: 'expected',
      site: SITE_TZ_STUB,
    } as any)

    const res = await resumeWalkIn(SITE_ID, RES_ID)
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toContain('Reservation not found')
  })

  it('rejects unauthenticated caller', async () => {
    const res = await resumeWalkIn(SITE_ID, RES_ID)
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authenticated')
    expect(vi.mocked(prisma.reservation.findUnique)).not.toHaveBeenCalled()
  })

  it('rejects non-owner', async () => {
    authenticateAsNonOwner()
    const res = await resumeWalkIn(SITE_ID, RES_ID)
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authorized')
    expect(vi.mocked(prisma.reservation.findUnique)).not.toHaveBeenCalled()
  })
})

// ─── blockBeds: grouped block ────────────────────────────────────────────────

describe('blockBeds', () => {
  it('rejects unauthenticated caller', async () => {
    const res = await blockBeds(SITE_ID, [ITEM_ID])
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authenticated')
    expect(mockGuard).not.toHaveBeenCalled()
  })

  it('rejects non-owner', async () => {
    authenticateAsNonOwner()
    const res = await blockBeds(SITE_ID, [ITEM_ID])
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authorized')
    expect(mockGuard).not.toHaveBeenCalled()
  })

  it('rejects empty itemIds array', async () => {
    authenticateAsOwner()
    const res = await blockBeds(SITE_ID, [])
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toMatch(/no items selected/i)
    expect(mockGuard).not.toHaveBeenCalled()
  })

  it('creates ONE blocked reservation over ALL selected ids', async () => {
    authenticateAsOwner()

    const res = await blockBeds(SITE_ID, [ITEM_ID, 'item-2', 'item-3'])
    expect(res.status).toBe('ok')

    expect(mockGuard).toHaveBeenCalledTimes(1)
    const call = mockGuard.mock.calls[0][0]
    expect(call.itemIds).toEqual([ITEM_ID, 'item-2', 'item-3'])
    expect(call.siteId).toBe(SITE_ID)
    expect(call.status).toBe('paid-in-cash')
    expect(call.operationalStatus).toBe('blocked')
  })

  it('uses the sticky OUT_OF_SERVICE_TO far-future sentinel', async () => {
    authenticateAsOwner()

    await blockBeds(SITE_ID, [ITEM_ID, 'item-2'])

    const call = mockGuard.mock.calls[0][0]
    // The sticky block must survive the day rollover — `to` must be well into the future
    const fiveYearsFromNow = new Date(Date.now() + 5 * 365 * 24 * 60 * 60 * 1000)
    expect(call.to.getTime()).toBeGreaterThan(fiveYearsFromNow.getTime())
  })

  it('passes notes (truncated to 500) to guard', async () => {
    authenticateAsOwner()

    await blockBeds(SITE_ID, [ITEM_ID], 'N'.repeat(600))

    const call = mockGuard.mock.calls[0][0]
    expect(call.internalNotes).toHaveLength(500)
  })

  it('returns error when guard detects a conflict', async () => {
    authenticateAsOwner()
    mockGuard.mockResolvedValueOnce({ outcome: 'conflict', conflictingReservationId: 'existing' })

    const res = await blockBeds(SITE_ID, [ITEM_ID, 'item-2'])
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toMatch(/already occupied or blocked/i)
    expect(vi.mocked(prisma.reservation.create)).not.toHaveBeenCalled()
  })
})

// ─── compBeds: grouped comp ──────────────────────────────────────────────────

describe('compBeds', () => {
  it('rejects unauthenticated caller', async () => {
    const res = await compBeds(SITE_ID, [ITEM_ID])
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authenticated')
    expect(mockGuard).not.toHaveBeenCalled()
  })

  it('rejects non-owner', async () => {
    authenticateAsNonOwner()
    const res = await compBeds(SITE_ID, [ITEM_ID])
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authorized')
    expect(mockGuard).not.toHaveBeenCalled()
  })

  it('rejects empty itemIds array', async () => {
    authenticateAsOwner()
    const res = await compBeds(SITE_ID, [])
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toMatch(/no items selected/i)
    expect(mockGuard).not.toHaveBeenCalled()
  })

  it('creates ONE comp reservation over ALL selected ids', async () => {
    authenticateAsOwner()

    const res = await compBeds(SITE_ID, [ITEM_ID, 'item-2', 'item-3'])
    expect(res.status).toBe('ok')

    expect(mockGuard).toHaveBeenCalledTimes(1)
    const call = mockGuard.mock.calls[0][0]
    expect(call.itemIds).toEqual([ITEM_ID, 'item-2', 'item-3'])
    expect(call.siteId).toBe(SITE_ID)
    expect(call.status).toBe('paid-in-cash')
    expect(call.operationalStatus).toBe('comp')
  })

  it('sets isComp=true and paymentAmount=0', async () => {
    authenticateAsOwner()

    await compBeds(SITE_ID, [ITEM_ID, 'item-2'])

    const call = mockGuard.mock.calls[0][0]
    expect(call.isComp).toBe(true)
    expect(call.paymentAmount).toBe(0)
  })

  it('uses today-only window (to = venue-local end of today, not sticky sentinel)', async () => {
    authenticateAsOwner()

    await compBeds(SITE_ID, [ITEM_ID])

    const call = mockGuard.mock.calls[0][0]
    // `to` must be the venue-local end-of-today (Madrid fallback from mock with no tz fields).
    const { end: expectedTo } = siteDayBounds({})
    expect(call.to.getTime()).toBe(expectedTo.getTime())
    // Confirm it is NOT the sticky far-future sentinel used for blocks
    expect(call.to.getFullYear()).toBeLessThan(2999)
  })

  it('passes guestName (truncated) and notes (truncated) to guard', async () => {
    authenticateAsOwner()

    await compBeds(SITE_ID, [ITEM_ID], undefined, 'G'.repeat(300), 'N'.repeat(600))

    const call = mockGuard.mock.calls[0][0]
    expect(call.guestName).toHaveLength(200)
    expect(call.internalNotes).toHaveLength(500)
  })

  it('returns error when guard detects a conflict', async () => {
    authenticateAsOwner()
    mockGuard.mockResolvedValueOnce({ outcome: 'conflict', conflictingReservationId: 'existing' })

    const res = await compBeds(SITE_ID, [ITEM_ID, 'item-2'])
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toMatch(/already occupied or blocked/i)
    expect(vi.mocked(prisma.reservation.create)).not.toHaveBeenCalled()
  })
})

// ─── compBeds — multi-day until param ───────────────────────────────────────

describe('compBeds — multi-day until param', () => {
  it('falls back to today-only when until is not provided', async () => {
    authenticateAsOwner()

    await compBeds(SITE_ID, [ITEM_ID])

    const { end: expectedTo } = siteDayBounds({}) // Madrid fallback
    const call = mockGuard.mock.calls[0][0]
    expect((call.to as Date).getTime()).toBe(expectedTo.getTime())
  })

  it('extends `to` to the end of the given until date', async () => {
    authenticateAsOwner()
    const until = dayjs().add(3, 'day').format('YYYY-MM-DD')

    const res = await compBeds(SITE_ID, [ITEM_ID, 'item-2'], undefined, undefined, undefined, undefined, until)
    expect(res.status).toBe('ok')

    const expectedTo = siteDayBounds({}, new Date(until + 'T12:00:00.000Z')).end
    const call = mockGuard.mock.calls[0][0]
    expect((call.to as Date).getTime()).toBe(expectedTo.getTime())
  })

  it('rejects an invalid until date', async () => {
    authenticateAsOwner()
    const res = await compBeds(SITE_ID, [ITEM_ID], undefined, undefined, undefined, undefined, 'not-a-date')
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toMatch(/invalid date/i)
    expect(mockGuard).not.toHaveBeenCalled()
  })

  it('rejects until in the past', async () => {
    authenticateAsOwner()
    const past = dayjs().subtract(1, 'day').format('YYYY-MM-DD')
    const res = await compBeds(SITE_ID, [ITEM_ID], undefined, undefined, undefined, undefined, past)
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toMatch(/past/i)
    expect(mockGuard).not.toHaveBeenCalled()
  })

  it('rejects until more than 90 days out', async () => {
    authenticateAsOwner()
    const far = dayjs().add(91, 'day').format('YYYY-MM-DD')
    const res = await compBeds(SITE_ID, [ITEM_ID], undefined, undefined, undefined, undefined, far)
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toMatch(/90 days/i)
    expect(mockGuard).not.toHaveBeenCalled()
  })
})

// ─── settleReservation ────────────────────────────────────────────────────────

describe('settleReservation', () => {
  function stubCashWalkIn(operationalStatus = 'walked-in') {
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue({
      siteId: SITE_ID,
      status: 'paid-in-cash',
      operationalStatus,
    } as any)
  }

  it('rejects unauthenticated request', async () => {
    const res = await settleReservation(SITE_ID, RES_ID, 10)
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toMatch(/not authenticated/i)
  })

  it('rejects non-owner', async () => {
    authenticateAsNonOwner()
    const res = await settleReservation(SITE_ID, RES_ID, 10)
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toMatch(/not authorized/i)
  })

  it('rejects amount <= 0', async () => {
    authenticateAsOwner()
    stubCashWalkIn()
    const res = await settleReservation(SITE_ID, RES_ID, 0)
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toMatch(/positive number/i)
  })

  it('rejects negative amount', async () => {
    authenticateAsOwner()
    stubCashWalkIn()
    const res = await settleReservation(SITE_ID, RES_ID, -5)
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toMatch(/positive number/i)
  })

  it('rejects amount > 100000', async () => {
    authenticateAsOwner()
    stubCashWalkIn()
    const res = await settleReservation(SITE_ID, RES_ID, 100001)
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toMatch(/positive number/i)
  })

  it('rejects non-cash-walk-in reservation', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue({
      siteId: SITE_ID,
      status: 'complete',
      operationalStatus: 'walked-in',
    } as any)
    const res = await settleReservation(SITE_ID, RES_ID, 25)
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toMatch(/cash walk-in/i)
  })

  it('rejects cash walk-in in a non-occupiable state', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue({
      siteId: SITE_ID,
      status: 'paid-in-cash',
      operationalStatus: 'departed',
    } as any)
    const res = await settleReservation(SITE_ID, RES_ID, 25)
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toMatch(/cannot settle/i)
  })

  it('calls recordSettlement with correct args for a walked-in reservation', async () => {
    authenticateAsOwner()
    stubCashWalkIn('walked-in')
    // no employee
    vi.mocked(prisma.employee.findUnique).mockResolvedValue(null)
    const mockRecord = vi.mocked(recordSettlement)
    mockRecord.mockResolvedValueOnce({ id: 'te-1', amount: 25, siteId: SITE_ID, reservationId: RES_ID, employeeId: null, settledAt: new Date(), voidedAt: null, createdAt: new Date() })

    const res = await settleReservation(SITE_ID, RES_ID, 25)
    expect(res.status).toBe('ok')
    expect(mockRecord).toHaveBeenCalledWith(
      expect.objectContaining({ siteId: SITE_ID, reservationId: RES_ID, amount: 25 })
    )
  })

  it('also accepts expected operationalStatus (multiday between-day leg)', async () => {
    authenticateAsOwner()
    stubCashWalkIn('expected')
    vi.mocked(prisma.employee.findUnique).mockResolvedValue(null)
    const mockRecord = vi.mocked(recordSettlement)
    mockRecord.mockResolvedValueOnce({ id: 'te-2', amount: 30, siteId: SITE_ID, reservationId: RES_ID, employeeId: null, settledAt: new Date(), voidedAt: null, createdAt: new Date() })

    const res = await settleReservation(SITE_ID, RES_ID, 30)
    expect(res.status).toBe('ok')
    expect(mockRecord).toHaveBeenCalledWith(expect.objectContaining({ amount: 30 }))
  })

  it('resolves and stamps employeeId when valid', async () => {
    authenticateAsOwner()
    stubCashWalkIn()
    vi.mocked(prisma.employee.findUnique).mockResolvedValue({ accountId: OWNER_ID } as any)
    const mockRecord = vi.mocked(recordSettlement)
    mockRecord.mockResolvedValueOnce({ id: 'te-3', amount: 20, siteId: SITE_ID, reservationId: RES_ID, employeeId: 'emp-1', settledAt: new Date(), voidedAt: null, createdAt: new Date() })

    const res = await settleReservation(SITE_ID, RES_ID, 20, undefined, 'emp-1')
    expect(res.status).toBe('ok')
    expect(mockRecord).toHaveBeenCalledWith(
      expect.objectContaining({ employeeId: 'emp-1' })
    )
  })

  it('calls processConfirmedReservation with skipCommission=true after settlement', async () => {
    // At the settle point (when cash is actually taken) a PARTNER-only receipt
    // must be issued. skipCommission: true → no PLATFORM invoice; that is
    // reserved for online (Mollie-collected) payments only.
    authenticateAsOwner()
    stubCashWalkIn('walked-in')
    vi.mocked(prisma.employee.findUnique).mockResolvedValue(null)
    vi.mocked(recordSettlement).mockResolvedValueOnce({ id: 'te-4', amount: 50, siteId: SITE_ID, reservationId: RES_ID, employeeId: null, settledAt: new Date(), voidedAt: null, createdAt: new Date() })

    const res = await settleReservation(SITE_ID, RES_ID, 50)
    expect(res.status).toBe('ok')
    expect(mockProcessConfirmedReservation).toHaveBeenCalledOnce()
    expect(mockProcessConfirmedReservation).toHaveBeenCalledWith(RES_ID, { skipCommission: true, skipEmail: true })
  })

  it('does NOT fail if processConfirmedReservation throws (non-blocking receipt)', async () => {
    // The till entry + sale are the source of truth. A receipt failure must not
    // roll back or error the cash settlement.
    authenticateAsOwner()
    stubCashWalkIn('walked-in')
    vi.mocked(prisma.employee.findUnique).mockResolvedValue(null)
    vi.mocked(recordSettlement).mockResolvedValueOnce({ id: 'te-5', amount: 40, siteId: SITE_ID, reservationId: RES_ID, employeeId: null, settledAt: new Date(), voidedAt: null, createdAt: new Date() })
    mockProcessConfirmedReservation.mockRejectedValueOnce(new Error('invoice service down'))

    const res = await settleReservation(SITE_ID, RES_ID, 40)
    expect(res.status).toBe('ok')
  })
})

// ─── getTillStatus / closeTill (track 016 — day-anchored two-bucket till) ─────

describe('getTillStatus', () => {
  const EMPLOYEE_ID = 'emp-1'

  it('rejects unauthenticated request', async () => {
    const res = await getTillStatus(SITE_ID, EMPLOYEE_ID)
    expect(res.status).toBe('error')
  })

  it('rejects an unknown worker', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.employee.findUnique).mockResolvedValue(null)
    const res = await getTillStatus(SITE_ID, EMPLOYEE_ID)
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Unknown worker')
  })

  it('forwards a site-derived dayStart to getOpenTill and returns the today/carryOver buckets', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.employee.findUnique).mockResolvedValue({ accountId: OWNER_ID } as any)
    const today = { total: 25, count: 1 }
    const carryOver = { total: 15, count: 1, oldestAt: new Date('2026-07-01T08:00:00.000Z') }
    vi.mocked(getOpenTill).mockResolvedValueOnce({ total: 40, count: 2, today, carryOver })

    const res: any = await getTillStatus(SITE_ID, EMPLOYEE_ID)

    expect(res.status).toBe('ok')
    expect(res.total).toBe(40)
    expect(res.count).toBe(2)
    expect(res.today).toEqual(today)
    expect(res.carryOver).toEqual(carryOver)

    expect(getOpenTill).toHaveBeenCalledTimes(1)
    const [calledSiteId, calledEmployeeId, dayStart] = vi.mocked(getOpenTill).mock.calls[0]!
    expect(calledSiteId).toBe(SITE_ID)
    expect(calledEmployeeId).toBe(EMPLOYEE_ID)
    expect(dayStart).toBeInstanceOf(Date)
  })
})

describe('closeTill', () => {
  const EMPLOYEE_ID = 'emp-1'

  it('rejects unauthenticated request', async () => {
    const res = await closeTill(SITE_ID, EMPLOYEE_ID)
    expect(res.status).toBe('error')
  })

  it('delegates to closeEmployeeTill with a site-derived dayStart', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.employee.findUnique).mockResolvedValue({ accountId: OWNER_ID } as any)
    vi.mocked(closeEmployeeTill).mockResolvedValueOnce({
      closed: true,
      totalAmount: 40,
      txnCount: 2,
      carryOverAmount: 15,
      carryOverCount: 1,
      till: {
        total: 40,
        count: 2,
        today: { total: 25, count: 1 },
        carryOver: { total: 15, count: 1, oldestAt: new Date() },
      },
    })

    const res: any = await closeTill(SITE_ID, EMPLOYEE_ID)

    expect(res).toMatchObject({
      status: 'ok',
      total: 40,
      count: 2,
      closed: true,
      carryOverAmount: 15,
      carryOverCount: 1,
    })
    expect(closeEmployeeTill).toHaveBeenCalledTimes(1)
    const [calledSiteId, calledEmployeeId, dayStart] = vi.mocked(closeEmployeeTill).mock.calls[0]!
    expect(calledSiteId).toBe(SITE_ID)
    expect(calledEmployeeId).toBe(EMPLOYEE_ID)
    expect(dayStart).toBeInstanceOf(Date)
    expect(prisma.tillClose.create).not.toHaveBeenCalled()
  })

  it('preserves the zero-balance no-op contract: closed:false, no TillClose snapshot written', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.employee.findUnique).mockResolvedValue({ accountId: OWNER_ID } as any)
    vi.mocked(closeEmployeeTill).mockResolvedValueOnce({
      closed: false,
      totalAmount: 0,
      txnCount: 0,
      carryOverAmount: 0,
      carryOverCount: 0,
      till: {
        total: 0,
        count: 0,
        today: { total: 0, count: 0 },
        carryOver: { total: 0, count: 0, oldestAt: null },
      },
    })

    const res: any = await closeTill(SITE_ID, EMPLOYEE_ID)

    expect(res).toMatchObject({ status: 'ok', total: 0, count: 0, closed: false })
    expect(prisma.tillClose.create).not.toHaveBeenCalled()
  })
})

// ─── closeDay ────────────────────────────────────────────────────────────────

describe('closeDay', () => {
  // Auth-gate helpers (mirrors the admin-token gate used by getOpenTills / getTillDayReport).
  // verifySiteAdmin: token path requires resources: ['admin']; session path requires ownership.

  const OTHER_ID = 'other-user'

  function authenticateAsAdminSession() {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ sudo: false } as any)
    vi.mocked(prisma.site.findUnique).mockResolvedValue({ userId: OWNER_ID } as any)
    vi.mocked(closeAllOpenTills).mockResolvedValue({ closedCount: 2, totalClosed: 150 })
  }

  function authenticateAsSudoSession() {
    mockAuth.mockResolvedValue({ user: { id: 'sudo-user' } } as any)
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ sudo: true } as any)
    vi.mocked(prisma.site.findUnique).mockResolvedValue({ userId: OWNER_ID } as any)
    vi.mocked(closeAllOpenTills).mockResolvedValue({ closedCount: 1, totalClosed: 75 })
  }

  function authenticateAsAdminToken() {
    // Token path: securityToken with resources: ['admin'].
    // verifySiteAdmin checks hasSome: ['admin'] — a plain 'all'/'manage_site' token is rejected.
    mockAuth.mockResolvedValue(null)
    vi.mocked(prisma.securityToken.findUnique).mockResolvedValue({
      id: 'admin-token-key',
      userId: OWNER_ID,
      resources: ['admin'],
      expires: new Date(Date.now() + 3_600_000),
    } as any)
    vi.mocked(prisma.site.findUnique).mockResolvedValue({ userId: OWNER_ID } as any)
    vi.mocked(closeAllOpenTills).mockResolvedValue({ closedCount: 1, totalClosed: 80 })
  }

  // ── Auth gate: reject scenarios ───────────────────────────────────────────

  it('no session and no token → error, no side effects', async () => {
    // Gate must reject before touching tills.
    mockAuth.mockResolvedValue(null)
    vi.mocked(prisma.securityToken.findUnique).mockResolvedValue(null)

    const res = await closeDay(SITE_ID)
    expect(res.status).toBe('error')
    expect(res.errors).toBeDefined()
    expect(closeAllOpenTills).not.toHaveBeenCalled()
  })

  it('wrong-owner session → error, no side effects', async () => {
    // Different user who does not own the site.
    mockAuth.mockResolvedValue({ user: { id: OTHER_ID } } as any)
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ sudo: false } as any)
    vi.mocked(prisma.site.findUnique).mockResolvedValue({ userId: OWNER_ID } as any)

    const res = await closeDay(SITE_ID)
    expect(res.status).toBe('error')
    expect(closeAllOpenTills).not.toHaveBeenCalled()
  })

  it('plain manage token (no admin resource) → error, no side effects', async () => {
    // verifySiteAdmin rejects resources: ['all'] — only ['admin'] passes the token path.
    mockAuth.mockResolvedValue(null)
    vi.mocked(prisma.securityToken.findUnique).mockResolvedValue(null) // hasSome:['admin'] returns null for an 'all' token

    const res = await closeDay(SITE_ID, 'plain-manage-token')
    expect(res.status).toBe('error')
    expect(closeAllOpenTills).not.toHaveBeenCalled()
  })

  // ── Auth gate: allow scenarios ────────────────────────────────────────────

  it('admin token → ok, calls closeAllOpenTills (cash-up only, no floor mutation)', async () => {
    authenticateAsAdminToken()

    const res = await closeDay(SITE_ID, 'admin-token-key')
    expect(res.status).toBe('ok')
    expect(closeAllOpenTills).toHaveBeenCalledWith(SITE_ID, expect.any(Date))
    // closeDay is cash-up only — must never touch reservation rows
    expect(prisma.reservation.updateMany).not.toHaveBeenCalled()
  })

  it('owner session → ok (session path through verifySiteAdmin)', async () => {
    authenticateAsAdminSession()

    const res = await closeDay(SITE_ID)
    expect(res.status).toBe('ok')
    expect(closeAllOpenTills).toHaveBeenCalledWith(SITE_ID, expect.any(Date))
    expect(prisma.reservation.updateMany).not.toHaveBeenCalled()
  })

  it('sudo session → ok (bypasses ownership check)', async () => {
    authenticateAsSudoSession()

    const res = await closeDay(SITE_ID)
    expect(res.status).toBe('ok')
    expect(closeAllOpenTills).toHaveBeenCalledWith(SITE_ID, expect.any(Date))
  })

  // ── Happy-path: till summary only ─────────────────────────────────────────

  it('returns closedCount + totalClosed from tills; no departedCount field', async () => {
    authenticateAsAdminSession()
    vi.mocked(closeAllOpenTills).mockResolvedValue({ closedCount: 3, totalClosed: 210 })

    const res = await closeDay(SITE_ID)
    expect(res).toMatchObject({
      status: 'ok',
      closedCount: 3,
      totalClosed: 210,
    })
    // Must NOT carry a departedCount — that would imply floor mutation happened
    expect((res as any).departedCount).toBeUndefined()
  })

  it('surfaces carryOverClosed from closeAllOpenTills (track 016 — day-anchored close)', async () => {
    authenticateAsAdminSession()
    vi.mocked(closeAllOpenTills).mockResolvedValue({ closedCount: 2, totalClosed: 130, carryOverClosed: 45 })

    const res = await closeDay(SITE_ID)
    expect(res).toMatchObject({
      status: 'ok',
      closedCount: 2,
      totalClosed: 130,
      carryOverClosed: 45,
    })
  })

  it('passes a site-derived dayStart (venue-local start of today) to closeAllOpenTills', async () => {
    authenticateAsAdminSession()

    await closeDay(SITE_ID)

    expect(closeAllOpenTills).toHaveBeenCalledTimes(1)
    const [calledSiteId, dayStart] = vi.mocked(closeAllOpenTills).mock.calls[0]!
    expect(calledSiteId).toBe(SITE_ID)
    expect(dayStart).toBeInstanceOf(Date)
  })

  // ── Idempotency ───────────────────────────────────────────────────────────

  it('idempotent re-run: zero counts when all tills already closed', async () => {
    // After a successful closeDay all tills are at zero → re-running is a no-op.
    authenticateAsAdminSession()
    vi.mocked(closeAllOpenTills).mockResolvedValue({ closedCount: 0, totalClosed: 0 })

    const res = await closeDay(SITE_ID)
    expect(res).toMatchObject({
      status: 'ok',
      closedCount: 0,
      totalClosed: 0,
    })
  })
})

// ─── getDayShiftItems ─────────────────────────────────────────────────────────

describe('getDayShiftItems', () => {
  // Gate: verifySiteAdmin — same as getOpenTills / getTillDayReport / closeDay.
  // Requires 'admin' in token resources or an owner/sudo session.

  const OTHER_ID = 'other-user'
  const DATE_ISO = '2025-07-01'

  function authenticateAsAdminSession() {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ sudo: false } as any)
    vi.mocked(prisma.site.findUnique).mockResolvedValue({
      userId: OWNER_ID,
      timeZone: null,
      locationLat: null,
      locationLng: null,
    } as any)
  }

  function authenticateAsAdminToken() {
    mockAuth.mockResolvedValue(null)
    vi.mocked(prisma.securityToken.findUnique).mockResolvedValue({
      id: 'admin-token-key',
      userId: OWNER_ID,
      resources: ['admin'],
      expires: new Date(Date.now() + 3_600_000),
    } as any)
    vi.mocked(prisma.site.findUnique).mockResolvedValue({
      userId: OWNER_ID,
      timeZone: null,
      locationLat: null,
      locationLng: null,
    } as any)
  }

  // ── Auth gate: reject ─────────────────────────────────────────────────────

  it('no session, no token → error; does not call getEmployeeShiftItems', async () => {
    // Gate must fire before the DB shift query.
    mockAuth.mockResolvedValue(null)
    vi.mocked(prisma.securityToken.findUnique).mockResolvedValue(null)

    const res = await getDayShiftItems(SITE_ID, DATE_ISO)
    expect(res.status).toBe('error')
    expect(res.errors).toBeDefined()
    expect(getEmployeeShiftItems).not.toHaveBeenCalled()
  })

  it('wrong-owner session → error; does not call getEmployeeShiftItems', async () => {
    mockAuth.mockResolvedValue({ user: { id: OTHER_ID } } as any)
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ sudo: false } as any)
    vi.mocked(prisma.site.findUnique).mockResolvedValue({ userId: OWNER_ID } as any)

    const res = await getDayShiftItems(SITE_ID, DATE_ISO)
    expect(res.status).toBe('error')
    expect(getEmployeeShiftItems).not.toHaveBeenCalled()
  })

  it('plain manage token (no admin resource) → error; does not call getEmployeeShiftItems', async () => {
    // verifySiteAdmin checks hasSome: ['admin']; plain 'all' token is rejected.
    mockAuth.mockResolvedValue(null)
    vi.mocked(prisma.securityToken.findUnique).mockResolvedValue(null)

    const res = await getDayShiftItems(SITE_ID, DATE_ISO, 'plain-manage-token')
    expect(res.status).toBe('error')
    expect(getEmployeeShiftItems).not.toHaveBeenCalled()
  })

  // ── Date validation ───────────────────────────────────────────────────────

  it('bad dateIso (not YYYY-MM-DD) → error; does not call getEmployeeShiftItems', async () => {
    // Auth passes, but invalid date string must be rejected before the DB query.
    authenticateAsAdminSession()

    const res = await getDayShiftItems(SITE_ID, 'not-a-date')
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toMatch(/YYYY-MM-DD/)
    expect(getEmployeeShiftItems).not.toHaveBeenCalled()
  })

  it('empty dateIso → error', async () => {
    authenticateAsAdminSession()

    const res = await getDayShiftItems(SITE_ID, '')
    expect(res.status).toBe('error')
    expect(getEmployeeShiftItems).not.toHaveBeenCalled()
  })

  // ── Happy path ────────────────────────────────────────────────────────────

  it('admin token + valid date → ok, returns shifts from getEmployeeShiftItems', async () => {
    authenticateAsAdminToken()
    const mockShifts = [
      {
        employeeId: 'emp-1',
        name: 'Alice',
        active: true,
        total: 75,
        count: 3,
        items: [
          {
            reservationId: 'res-1',
            seats: ['A1'],
            amount: 25,
            at: new Date('2025-07-01T10:00:00Z'),
            channel: 'cash' as const,
          },
        ],
      },
    ]
    vi.mocked(getEmployeeShiftItems).mockResolvedValueOnce(mockShifts)

    const res = await getDayShiftItems(SITE_ID, DATE_ISO, 'admin-token-key')
    expect(res.status).toBe('ok')
    expect(res.shifts).toEqual(mockShifts)
    expect(getEmployeeShiftItems).toHaveBeenCalledWith(
      SITE_ID,
      expect.any(Date),
      expect.any(Date),
    )
  })

  it('owner session + valid date → ok, returns shifts', async () => {
    authenticateAsAdminSession()
    vi.mocked(getEmployeeShiftItems).mockResolvedValueOnce([])

    const res = await getDayShiftItems(SITE_ID, DATE_ISO)
    expect(res.status).toBe('ok')
    expect(res.shifts).toEqual([])
  })

  it('day bounds passed to getEmployeeShiftItems span the requested civil day', async () => {
    // Verify from < to and both are Date objects scoping roughly to the right day.
    authenticateAsAdminSession()
    vi.mocked(getEmployeeShiftItems).mockResolvedValueOnce([])

    await getDayShiftItems(SITE_ID, '2025-07-15')

    const [[, from, to]] = vi.mocked(getEmployeeShiftItems).mock.calls
    expect(from).toBeInstanceOf(Date)
    expect(to).toBeInstanceOf(Date)
    expect((from as Date) < (to as Date)).toBe(true)
    // The window must contain noon UTC on the requested day
    const noon = new Date('2025-07-15T12:00:00.000Z')
    expect((from as Date) <= noon && noon <= (to as Date)).toBe(true)
  })
})

// ─── getOpenTillItems ─────────────────────────────────────────────────────────

describe('getOpenTillItems', () => {
  // Gate: verifySiteAdmin — requires 'admin' in token resources, or owner/sudo session.
  // Mirrors getOpenTills gate; calls getOpenTillItemsByEmployee instead.

  const OTHER_ID = 'other-user'

  function authenticateAsAdminSession() {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ sudo: false } as any)
    vi.mocked(prisma.site.findUnique).mockResolvedValue({ userId: OWNER_ID } as any)
  }

  function authenticateAsSudoSession() {
    mockAuth.mockResolvedValue({ user: { id: 'sudo-user' } } as any)
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ sudo: true } as any)
    vi.mocked(prisma.site.findUnique).mockResolvedValue({ userId: OWNER_ID } as any)
  }

  function authenticateAsAdminToken() {
    mockAuth.mockResolvedValue(null)
    vi.mocked(prisma.securityToken.findUnique).mockResolvedValue({
      id: 'admin-token-key',
      userId: OWNER_ID,
      resources: ['admin'],
      expires: new Date(Date.now() + 3_600_000),
    } as any)
    vi.mocked(prisma.site.findUnique).mockResolvedValue({ userId: OWNER_ID } as any)
  }

  // ── Auth gate: reject scenarios ───────────────────────────────────────────

  it('no session and no token → error, getOpenTillItemsByEmployee not called', async () => {
    mockAuth.mockResolvedValue(null)
    vi.mocked(prisma.securityToken.findUnique).mockResolvedValue(null)

    const res = await getOpenTillItems(SITE_ID)
    expect(res.status).toBe('error')
    expect(res.errors).toBeDefined()
    expect(getOpenTillItemsByEmployee).not.toHaveBeenCalled()
  })

  it('wrong-owner session → error, getOpenTillItemsByEmployee not called', async () => {
    mockAuth.mockResolvedValue({ user: { id: OTHER_ID } } as any)
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ sudo: false } as any)
    vi.mocked(prisma.site.findUnique).mockResolvedValue({ userId: OWNER_ID } as any)

    const res = await getOpenTillItems(SITE_ID)
    expect(res.status).toBe('error')
    expect(getOpenTillItemsByEmployee).not.toHaveBeenCalled()
  })

  it('plain manage token (no admin resource) → error, getOpenTillItemsByEmployee not called', async () => {
    // verifySiteAdmin checks hasSome: ['admin'] — a plain 'all'/'manage_site' token is rejected.
    mockAuth.mockResolvedValue(null)
    vi.mocked(prisma.securityToken.findUnique).mockResolvedValue(null)

    const res = await getOpenTillItems(SITE_ID, 'plain-manage-token')
    expect(res.status).toBe('error')
    expect(getOpenTillItemsByEmployee).not.toHaveBeenCalled()
  })

  // ── Auth gate: allow scenarios ────────────────────────────────────────────

  it('admin token → ok, calls getOpenTillItemsByEmployee with siteId', async () => {
    authenticateAsAdminToken()
    const mockTills = [
      {
        employeeId: 'emp-1',
        name: 'Ana',
        active: true,
        total: 45,
        count: 2,
        items: [
          { id: 'te-1', kind: 'sunbed', label: 'Hamaca 5-1', amount: 25, at: new Date('2025-07-01T10:00:00Z') },
          { id: 'te-2', kind: 'rental', label: 'Kayak', amount: 20, at: new Date('2025-07-01T11:00:00Z') },
        ],
      },
    ]
    vi.mocked(getOpenTillItemsByEmployee).mockResolvedValueOnce(mockTills as any)

    const res = await getOpenTillItems(SITE_ID, 'admin-token-key')
    expect(res.status).toBe('ok')
    expect(getOpenTillItemsByEmployee).toHaveBeenCalledWith(SITE_ID, expect.any(Date))
    expect(res.tills).toEqual(mockTills)
  })

  it('owner session → ok (session path through verifySiteAdmin)', async () => {
    authenticateAsAdminSession()
    vi.mocked(getOpenTillItemsByEmployee).mockResolvedValueOnce([])

    const res = await getOpenTillItems(SITE_ID)
    expect(res.status).toBe('ok')
    expect(getOpenTillItemsByEmployee).toHaveBeenCalledWith(SITE_ID, expect.any(Date))
    expect(res.tills).toEqual([])
  })

  it('sudo session → ok (bypasses ownership check)', async () => {
    authenticateAsSudoSession()
    vi.mocked(getOpenTillItemsByEmployee).mockResolvedValueOnce([])

    const res = await getOpenTillItems(SITE_ID)
    expect(res.status).toBe('ok')
    expect(getOpenTillItemsByEmployee).toHaveBeenCalledWith(SITE_ID, expect.any(Date))
  })

  // ── Happy path: returns itemised tills ────────────────────────────────────

  it('happy path → tills array propagated with items superset', async () => {
    authenticateAsAdminSession()
    const mockTills = [
      {
        employeeId: 'emp-2',
        name: 'Bea',
        active: true,
        total: 75,
        count: 3,
        items: [
          { id: 'te-3', kind: 'sunbed', label: 'Hamaca 12-2', amount: 25, at: new Date() },
          { id: 'te-4', kind: 'sunbed', label: 'Hamaca 13-1', amount: 25, at: new Date() },
          { id: 'te-5', kind: 'rental', label: 'Paddle board', amount: 25, at: new Date() },
        ],
      },
    ]
    vi.mocked(getOpenTillItemsByEmployee).mockResolvedValueOnce(mockTills as any)

    const res = await getOpenTillItems(SITE_ID)
    expect(res.status).toBe('ok')
    expect(res.tills).toHaveLength(1)
    expect(res.tills![0].items).toHaveLength(3)
    expect(res.tills![0].total).toBe(75)
    // items sum matches total
    const itemSum = res.tills![0].items.reduce((s, i) => s + i.amount, 0)
    expect(itemSum).toBe(75)
  })

  it('empty roster → ok with empty tills array', async () => {
    authenticateAsAdminSession()
    vi.mocked(getOpenTillItemsByEmployee).mockResolvedValueOnce([])

    const res = await getOpenTillItems(SITE_ID)
    expect(res.status).toBe('ok')
    expect(res.tills).toEqual([])
  })
})

// ─── getManageTrends ─────────────────────────────────────────────────────────

describe('getManageTrends', () => {
  // Gate: verifySiteAdmin — same as getTillDayReport / closeDay / getDayShiftItems.
  // Requires 'admin' in token resources, or owner/sudo session.
  // Window math must be IDENTICAL to the accounting trend actions (same
  // TREND_WINDOWS, same last-N-days formula).

  const OTHER_ID = 'other-user'

  function authenticateAsAdminSession() {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ sudo: false } as any)
    vi.mocked(prisma.site.findUnique).mockResolvedValue({ userId: OWNER_ID } as any)
  }

  function authenticateAsSudoSession() {
    mockAuth.mockResolvedValue({ user: { id: 'sudo-user' } } as any)
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ sudo: true } as any)
    vi.mocked(prisma.site.findUnique).mockResolvedValue({ userId: OWNER_ID } as any)
  }

  function authenticateAsAdminToken() {
    mockAuth.mockResolvedValue(null)
    vi.mocked(prisma.securityToken.findUnique).mockResolvedValue({
      id: 'admin-token-key',
      userId: OWNER_ID,
      resources: ['admin'],
      expires: new Date(Date.now() + 3_600_000),
    } as any)
    vi.mocked(prisma.site.findUnique).mockResolvedValue({ userId: OWNER_ID } as any)
  }

  // ── Auth gate: reject scenarios ───────────────────────────────────────────

  it('no session, no token → error; does not call analytics functions', async () => {
    // Gate must fire before any analytics query.
    mockAuth.mockResolvedValue(null)
    vi.mocked(prisma.securityToken.findUnique).mockResolvedValue(null)

    const res = await getManageTrends(SITE_ID, 30)
    expect(res.status).toBe('error')
    expect(res.errors).toBeDefined()
    expect(getRevenueByChannelByDay).not.toHaveBeenCalled()
    expect(getOccupancyByDay).not.toHaveBeenCalled()
    expect(getReservationDayStats).not.toHaveBeenCalled()
  })

  it('wrong-owner session → error; does not call analytics functions', async () => {
    mockAuth.mockResolvedValue({ user: { id: OTHER_ID } } as any)
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ sudo: false } as any)
    vi.mocked(prisma.site.findUnique).mockResolvedValue({ userId: OWNER_ID } as any)

    const res = await getManageTrends(SITE_ID, 30)
    expect(res.status).toBe('error')
    expect(getRevenueByChannelByDay).not.toHaveBeenCalled()
  })

  it('plain manage token (no admin resource) → error; does not call analytics functions', async () => {
    // verifySiteAdmin checks hasSome: ['admin'] — a plain manage_site token is rejected.
    mockAuth.mockResolvedValue(null)
    vi.mocked(prisma.securityToken.findUnique).mockResolvedValue(null)

    const res = await getManageTrends(SITE_ID, 30, 'plain-manage-token')
    expect(res.status).toBe('error')
    expect(getRevenueByChannelByDay).not.toHaveBeenCalled()
  })

  // ── Auth gate: allow scenarios ────────────────────────────────────────────

  it('admin token → ok; calls all three analytics queries', async () => {
    authenticateAsAdminToken()

    const res = await getManageTrends(SITE_ID, 30, 'admin-token-key')
    expect(res.status).toBe('ok')
    expect(getRevenueByChannelByDay).toHaveBeenCalledWith(SITE_ID, expect.any(Date), expect.any(Date))
    expect(getOccupancyByDay).toHaveBeenCalledWith(SITE_ID, expect.any(Date), expect.any(Date))
    expect(getReservationDayStats).toHaveBeenCalledWith(SITE_ID, expect.any(Date), expect.any(Date))
  })

  it('owner session → ok (session path through verifySiteAdmin)', async () => {
    authenticateAsAdminSession()

    const res = await getManageTrends(SITE_ID, 7)
    expect(res.status).toBe('ok')
  })

  it('sudo session → ok (bypasses ownership check)', async () => {
    authenticateAsSudoSession()

    const res = await getManageTrends(SITE_ID, 30)
    expect(res.status).toBe('ok')
  })

  // ── Happy-path: return shape ──────────────────────────────────────────────

  it('returns revenue, occupancy, operations with rows and summary', async () => {
    authenticateAsAdminSession()

    const mockRevenueRows = [{ date: '2025-07-01', cash: 50, qr: 20, online: 30, total: 100 }]
    const mockOccupancyRows = [{ date: '2025-07-01', capacity: 10, occupied: 6, comps: 1, occupancyPct: 60 }]
    const mockOperationsRows = [{ date: '2025-07-01', rentedSeats: 6, revenue: 150 }]
    vi.mocked(getRevenueByChannelByDay).mockResolvedValueOnce(mockRevenueRows as any)
    vi.mocked(getOccupancyByDay).mockResolvedValueOnce(mockOccupancyRows as any)
    vi.mocked(getReservationDayStats).mockResolvedValueOnce(mockOperationsRows as any)

    const res = await getManageTrends(SITE_ID, 7)
    expect(res.status).toBe('ok')
    expect(res.revenue).toMatchObject({ rows: mockRevenueRows, summary: expect.any(Object) })
    expect(res.occupancy).toMatchObject({ rows: mockOccupancyRows, summary: expect.any(Object) })
    expect(res.operations).toMatchObject({ rows: mockOperationsRows, summary: expect.any(Object) })
  })

  it('returns the clamped days value in the response', async () => {
    authenticateAsAdminSession()

    const res = await getManageTrends(SITE_ID, 30)
    expect(res.days).toBe(30)
  })

  // ── days validation / clamp ───────────────────────────────────────────────

  it('unknown days value (e.g. 14) → clamps to 30 and returns ok', async () => {
    // Accounting actions clamp to 30 for unknown window values;
    // getManageTrends must do the same (window-parity).
    authenticateAsAdminSession()

    const res = await getManageTrends(SITE_ID, 14)
    expect(res.status).toBe('ok')
    expect(res.days).toBe(30)
  })

  it('accepts all valid TREND_WINDOWS values: 1, 7, 30, 365', async () => {
    // All four windows must be accepted without clamping.
    for (const w of [1, 7, 30, 365]) {
      authenticateAsAdminSession()
      const res = await getManageTrends(SITE_ID, w)
      expect(res.status).toBe('ok')
      expect(res.days).toBe(w)
    }
  })

  // ── Window-parity: same bounds as accounting actions ──────────────────────

  it('window bounds match accounting trend formula: from = to - (window-1)*DAY_MS', async () => {
    // The key invariant: getManageTrends must use exactly the same rolling-window
    // math as getRevenueChannelTrend / getOccupancyTrend / getOperationsTrend in
    // accounting/actions.ts. We verify this by inspecting the Date args passed to
    // one of the analytics calls.
    authenticateAsAdminSession()

    const before = Date.now()
    await getManageTrends(SITE_ID, 7)
    const after = Date.now()

    const [[, fromArg, toArg]] = vi.mocked(getRevenueByChannelByDay).mock.calls
    // `to` is Date.now() at call time — must be between our before/after bookend.
    expect(toArg.getTime()).toBeGreaterThanOrEqual(before)
    expect(toArg.getTime()).toBeLessThanOrEqual(after)
    // `from` is exactly (window-1) days before `to`.
    const DAY_MS = 24 * 60 * 60 * 1000
    expect(toArg.getTime() - fromArg.getTime()).toBe((7 - 1) * DAY_MS)
  })
})

// ─── getManageTrendsCsv ───────────────────────────────────────────────────────

describe('getManageTrendsCsv', () => {
  // Gate: verifySiteAdmin — same as getManageTrends.
  // Mirrors getRevenueCsv in accounting/actions.ts: same window, same
  // getRevenueByDay + toFiguresCsv call chain.

  const OTHER_ID = 'other-user'

  function authenticateAsAdminSession() {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ sudo: false } as any)
    vi.mocked(prisma.site.findUnique).mockResolvedValue({ userId: OWNER_ID } as any)
  }

  function authenticateAsAdminToken() {
    mockAuth.mockResolvedValue(null)
    vi.mocked(prisma.securityToken.findUnique).mockResolvedValue({
      id: 'admin-token-key',
      userId: OWNER_ID,
      resources: ['admin'],
      expires: new Date(Date.now() + 3_600_000),
    } as any)
    vi.mocked(prisma.site.findUnique).mockResolvedValue({ userId: OWNER_ID } as any)
  }

  // ── Auth gate: reject scenarios ───────────────────────────────────────────

  it('no session, no token → error; does not call getRevenueByDay', async () => {
    mockAuth.mockResolvedValue(null)
    vi.mocked(prisma.securityToken.findUnique).mockResolvedValue(null)

    const res = await getManageTrendsCsv(SITE_ID, 30)
    expect(res.status).toBe('error')
    expect(res.errors).toBeDefined()
    expect(getRevenueByDay).not.toHaveBeenCalled()
  })

  it('wrong-owner session → error; does not call getRevenueByDay', async () => {
    mockAuth.mockResolvedValue({ user: { id: OTHER_ID } } as any)
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ sudo: false } as any)
    vi.mocked(prisma.site.findUnique).mockResolvedValue({ userId: OWNER_ID } as any)

    const res = await getManageTrendsCsv(SITE_ID, 30)
    expect(res.status).toBe('error')
    expect(getRevenueByDay).not.toHaveBeenCalled()
  })

  it('plain manage token (no admin resource) → error; does not call getRevenueByDay', async () => {
    mockAuth.mockResolvedValue(null)
    vi.mocked(prisma.securityToken.findUnique).mockResolvedValue(null)

    const res = await getManageTrendsCsv(SITE_ID, 30, 'plain-manage-token')
    expect(res.status).toBe('error')
    expect(getRevenueByDay).not.toHaveBeenCalled()
  })

  // ── Auth gate: allow scenarios ────────────────────────────────────────────

  it('admin token → ok; calls getRevenueByDay and toFiguresCsv', async () => {
    authenticateAsAdminToken()
    vi.mocked(toFiguresCsv).mockReturnValueOnce('date,rentals,revenue\n2025-07-01,3,150.00\n')

    const res = await getManageTrendsCsv(SITE_ID, 7, 'admin-token-key')
    expect(res.status).toBe('ok')
    expect(getRevenueByDay).toHaveBeenCalledWith(SITE_ID, expect.any(Date), expect.any(Date))
    expect(toFiguresCsv).toHaveBeenCalled()
  })

  it('owner session → ok (session path through verifySiteAdmin)', async () => {
    authenticateAsAdminSession()

    const res = await getManageTrendsCsv(SITE_ID, 30)
    expect(res.status).toBe('ok')
    expect(res.csv).toBeDefined()
  })

  // ── Happy-path: return shape ──────────────────────────────────────────────

  it('returns { status: ok, csv } where csv is a string', async () => {
    authenticateAsAdminSession()
    vi.mocked(toFiguresCsv).mockReturnValueOnce('date,rentals,revenue\n2025-07-01,5,200.00\n')

    const res = await getManageTrendsCsv(SITE_ID, 30)
    expect(res.status).toBe('ok')
    expect(typeof res.csv).toBe('string')
    expect(res.csv).toContain('date,rentals,revenue')
  })

  // ── days validation / clamp ───────────────────────────────────────────────

  it('unknown days value (e.g. 10) → clamps to 30', async () => {
    authenticateAsAdminSession()

    // Verify the clamp by inspecting the time delta of the Date args.
    await getManageTrendsCsv(SITE_ID, 10)

    const [[, fromArg, toArg]] = vi.mocked(getRevenueByDay).mock.calls
    const DAY_MS = 24 * 60 * 60 * 1000
    // Should be a 30-day window: (30-1) * DAY_MS
    expect(toArg.getTime() - fromArg.getTime()).toBe((30 - 1) * DAY_MS)
  })

  it('valid days value 7 → uses 7-day window', async () => {
    authenticateAsAdminSession()

    await getManageTrendsCsv(SITE_ID, 7)

    const [[, fromArg, toArg]] = vi.mocked(getRevenueByDay).mock.calls
    const DAY_MS = 24 * 60 * 60 * 1000
    expect(toArg.getTime() - fromArg.getTime()).toBe((7 - 1) * DAY_MS)
  })
})
