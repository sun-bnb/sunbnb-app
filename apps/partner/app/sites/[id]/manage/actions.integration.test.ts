import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import dayjs from 'dayjs'
import { cleanDatabase, disconnectDatabase, prisma } from '@/app/test/setup'
import {
  createTestUser,
  createTestPartnerAccount,
  createTestSite,
  createTestInventoryItem,
  createTestRentalItem,
  createTestReservation,
} from '@/app/test/fixtures'

// ---------------------------------------------------------------------------
// Mocks — only auth and next/cache. Everything else (including
// verifySiteOwnership) uses the real implementation against the test DB.
// ---------------------------------------------------------------------------

let mockUserId: string | null = null

vi.mock('@/app/auth', () => ({
  auth: vi.fn(async () =>
    mockUserId ? { user: { id: mockUserId } } : null
  ),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Import actions AFTER mocks are declared
// ---------------------------------------------------------------------------

import {
  reserveItem,
  reserveItems,
  unreserveItem,
  checkInReservation,
  markDeparted,
  markNoShow,
  moveReservation,
  moveReservationToSeats,
  blockBed,
  blockBeds,
  unblockBed,
  holdBeds,
  releaseHold,
  cancelReservation,
  compBeds,
  uncompBed,
  markRentalPickedUp,
  markRentalReturned,
  createWalkInRental,
  convertHoldToWalkIn,
  splitWalkInSeat,
  getTillStatus,
  closeTill,
  findReservations,
} from './actions'
import { resolveTodayRow } from './reservation-day'

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

beforeAll(async () => {
  await cleanDatabase()
})

beforeEach(async () => {
  await cleanDatabase()
  mockUserId = null
})

afterAll(async () => {
  await cleanDatabase()
  await disconnectDatabase()
})

// ---------------------------------------------------------------------------
// Walk-in reservation lifecycle
// ---------------------------------------------------------------------------

describe('reserveItem', () => {
  it('creates reservation in DB with paid-in-cash status and walked-in operational status', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    const item = await createTestInventoryItem(user.id, site.id)
    mockUserId = user.id

    const result = await reserveItem(site.id, item.id, 'John Doe', 'VIP guest')
    expect(result).toEqual({ status: 'ok' })

    const reservations = await prisma.reservation.findMany({
      where: { siteId: site.id },
      include: { items: true },
    })
    expect(reservations).toHaveLength(1)

    const res = reservations[0]
    expect(res.status).toBe('paid-in-cash')
    expect(res.operationalStatus).toBe('walked-in')
    expect(res.checkedInAt).toBeTruthy()
    expect(res.guestName).toBe('John Doe')
    expect(res.internalNotes).toBe('VIP guest')
    expect(res.items).toHaveLength(1)
    expect(res.items[0].id).toBe(item.id)
  })

  it('auto-includes paired item when items are paired', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    const itemA = await createTestInventoryItem(user.id, site.id, { number: 1 })
    const itemB = await createTestInventoryItem(user.id, site.id, { number: 2, pairId: itemA.id })
    mockUserId = user.id

    const result = await reserveItem(site.id, itemA.id)
    expect(result).toEqual({ status: 'ok' })

    const reservation = await prisma.reservation.findFirst({
      where: { siteId: site.id },
      include: { items: { orderBy: { number: 'asc' } } },
    })
    expect(reservation!.items).toHaveLength(2)
    const itemIds = reservation!.items.map(i => i.id).sort()
    expect(itemIds).toEqual([itemA.id, itemB.id].sort())
  })

  it('truncates long guestName at 200 and notes at 500 characters in DB', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    const item = await createTestInventoryItem(user.id, site.id)
    mockUserId = user.id

    const longName = 'A'.repeat(300)
    const longNotes = 'B'.repeat(700)

    await reserveItem(site.id, item.id, longName, longNotes)

    const reservation = await prisma.reservation.findFirst({ where: { siteId: site.id } })
    expect(reservation!.guestName).toHaveLength(200)
    expect(reservation!.internalNotes).toHaveLength(500)
  })

  it('rejects non-owner and creates nothing in DB', async () => {
    const owner = await createTestUser()
    const stranger = await createTestUser()
    const site = await createTestSite(owner.id)
    const item = await createTestInventoryItem(owner.id, site.id)
    mockUserId = stranger.id

    const result = await reserveItem(site.id, item.id)
    expect(result.status).toBe('error')

    const count = await prisma.reservation.count({ where: { siteId: site.id } })
    expect(count).toBe(0)
  })
})

describe('unreserveItem', () => {
  it('only deletes today walk-in reservation, leaves other reservations untouched', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    const item = await createTestInventoryItem(user.id, site.id)
    mockUserId = user.id

    // Create a walk-in via reserveItem
    await reserveItem(site.id, item.id)

    // Also create a regular (non walk-in) reservation on the same item
    await createTestReservation(user.id, site.id, [item.id], {
      status: 'complete',
      operationalStatus: 'expected',
    })

    const beforeCount = await prisma.reservation.count({ where: { siteId: site.id } })
    expect(beforeCount).toBe(2)

    const result = await unreserveItem(site.id, item.id)
    expect(result).toEqual({ status: 'ok' })

    const remaining = await prisma.reservation.findMany({ where: { siteId: site.id } })
    expect(remaining).toHaveLength(1)
    expect(remaining[0].status).toBe('complete')
  })

  it('deletes a multi-day walk-in that extends beyond today', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    const item = await createTestInventoryItem(user.id, site.id)
    mockUserId = user.id

    // Create a multi-day walk-in spanning today + 3 more days
    const until = dayjs().add(3, 'day').format('YYYY-MM-DD')
    const reserveResult = await reserveItem(site.id, item.id, 'Multi-day guest', undefined, undefined, until)
    expect(reserveResult.status).toBe('ok')

    const beforeCount = await prisma.reservation.count({ where: { siteId: site.id } })
    expect(beforeCount).toBe(1)

    const result = await unreserveItem(site.id, item.id)
    expect(result).toEqual({ status: 'ok' })

    const afterCount = await prisma.reservation.count({ where: { siteId: site.id } })
    expect(afterCount).toBe(0)
  })

  it('returns error and deletes nothing when the bed has no active walk-in', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    const item = await createTestInventoryItem(user.id, site.id)
    mockUserId = user.id

    // A regular complete/expected reservation — NOT a walk-in
    await createTestReservation(user.id, site.id, [item.id], {
      status: 'complete',
      operationalStatus: 'expected',
    })

    const result = await unreserveItem(site.id, item.id)
    expect(result.status).toBe('error')
    expect(result.errors![0]).toMatch(/no walk-in reservation found/i)

    // The complete/expected reservation must survive
    const remaining = await prisma.reservation.count({ where: { siteId: site.id } })
    expect(remaining).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Check-in / departure state machine
// ---------------------------------------------------------------------------

describe('check-in / departure lifecycle', () => {
  it('full lifecycle: expected -> checked-in -> departed with timestamps', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    const item = await createTestInventoryItem(user.id, site.id)
    mockUserId = user.id

    const reservation = await createTestReservation(user.id, site.id, [item.id], {
      status: 'complete',
      operationalStatus: 'expected',
    })

    // Check in
    const checkInResult = await checkInReservation(site.id, reservation.id)
    expect(checkInResult).toEqual({ status: 'ok' })

    const afterCheckIn = await prisma.reservation.findUnique({ where: { id: reservation.id } })
    expect(afterCheckIn!.operationalStatus).toBe('checked-in')
    expect(afterCheckIn!.checkedInAt).toBeTruthy()

    // Mark departed
    const departResult = await markDeparted(site.id, reservation.id)
    expect(departResult).toEqual({ status: 'ok' })

    const afterDepart = await prisma.reservation.findUnique({ where: { id: reservation.id } })
    expect(afterDepart!.operationalStatus).toBe('departed')
    expect(afterDepart!.departedAt).toBeTruthy()
  })

  it('markDeparted on a MULTIDAY booking returns it to RESERVED (expected), not departed — daily cycle', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    const item = await createTestInventoryItem(user.id, site.id)
    mockUserId = user.id

    // A booking that extends past today (future reserved days remain).
    const reservation = await createTestReservation(user.id, site.id, [item.id], {
      status: 'complete',
      operationalStatus: 'checked-in',
      from: new Date(new Date().setHours(0, 0, 0, 0)),
      to: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
    })

    const departResult = await markDeparted(site.id, reservation.id)
    expect(departResult).toEqual({ status: 'ok' })

    // Returned to reserved for the rest of the stay — NOT a terminal 'departed'.
    const after = await prisma.reservation.findUnique({ where: { id: reservation.id } })
    expect(after!.operationalStatus).toBe('expected')
    expect(after!.departedAt).toBeNull()

    // Still HELD: the bed blocks a new booking on the same seat (future days remain).
    const reRent = await reserveItems(site.id, [item.id], 'New Party')
    expect(reRent.status).toBe('error')
  })

  it('checkInReservation rejects non-expected status and DB stays unchanged', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    const item = await createTestInventoryItem(user.id, site.id)
    mockUserId = user.id

    const reservation = await createTestReservation(user.id, site.id, [item.id], {
      status: 'complete',
      operationalStatus: 'checked-in',
    })

    const result = await checkInReservation(site.id, reservation.id)
    expect(result.status).toBe('error')
    expect(result.errors![0]).toContain('Cannot check in')

    const unchanged = await prisma.reservation.findUnique({ where: { id: reservation.id } })
    expect(unchanged!.operationalStatus).toBe('checked-in')
  })

  it('markDeparted rejects expected status (only checked-in/walked-in allowed)', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    const item = await createTestInventoryItem(user.id, site.id)
    mockUserId = user.id

    const reservation = await createTestReservation(user.id, site.id, [item.id], {
      status: 'complete',
      operationalStatus: 'expected',
    })

    const result = await markDeparted(site.id, reservation.id)
    expect(result.status).toBe('error')
    expect(result.errors![0]).toContain('Cannot mark departed')

    const unchanged = await prisma.reservation.findUnique({ where: { id: reservation.id } })
    expect(unchanged!.operationalStatus).toBe('expected')
  })

  it('markNoShow only works from expected, rejects checked-in', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    const item = await createTestInventoryItem(user.id, site.id)
    mockUserId = user.id

    const reservation = await createTestReservation(user.id, site.id, [item.id], {
      status: 'complete',
      operationalStatus: 'checked-in',
    })

    const result = await markNoShow(site.id, reservation.id)
    expect(result.status).toBe('error')
    expect(result.errors![0]).toContain('Cannot mark no-show')

    const unchanged = await prisma.reservation.findUnique({ where: { id: reservation.id } })
    expect(unchanged!.operationalStatus).toBe('checked-in')
  })
})

// ---------------------------------------------------------------------------
// moveReservation
// ---------------------------------------------------------------------------

describe('moveReservation', () => {
  it('disconnects old items and connects new items in DB', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    const itemA = await createTestInventoryItem(user.id, site.id, { number: 1 })
    const itemB = await createTestInventoryItem(user.id, site.id, { number: 2 })
    const itemC = await createTestInventoryItem(user.id, site.id, { number: 3 })
    mockUserId = user.id

    const reservation = await createTestReservation(user.id, site.id, [itemA.id], {
      status: 'complete',
      operationalStatus: 'expected',
    })

    const result = await moveReservation(site.id, reservation.id, [itemB.id, itemC.id])
    expect(result).toEqual({ status: 'ok' })

    const updated = await prisma.reservation.findUnique({
      where: { id: reservation.id },
      include: { items: true },
    })
    const connectedIds = updated!.items.map(i => i.id).sort()
    expect(connectedIds).toEqual([itemB.id, itemC.id].sort())
    expect(connectedIds).not.toContain(itemA.id)
  })

  it('rejects move to inactive items and leaves reservation items unchanged', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    const itemA = await createTestInventoryItem(user.id, site.id, { number: 1 })
    const itemB = await createTestInventoryItem(user.id, site.id, { number: 2, status: 'inactive' })
    mockUserId = user.id

    const reservation = await createTestReservation(user.id, site.id, [itemA.id], {
      status: 'complete',
      operationalStatus: 'expected',
    })

    const result = await moveReservation(site.id, reservation.id, [itemB.id])
    expect(result.status).toBe('error')
    expect(result.errors![0]).toContain('not found or inactive')

    const unchanged = await prisma.reservation.findUnique({
      where: { id: reservation.id },
      include: { items: true },
    })
    expect(unchanged!.items).toHaveLength(1)
    expect(unchanged!.items[0].id).toBe(itemA.id)
  })

  it('rejects move for departed reservation', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    const itemA = await createTestInventoryItem(user.id, site.id, { number: 1 })
    const itemB = await createTestInventoryItem(user.id, site.id, { number: 2 })
    mockUserId = user.id

    const reservation = await createTestReservation(user.id, site.id, [itemA.id], {
      status: 'complete',
      operationalStatus: 'departed',
    })

    const result = await moveReservation(site.id, reservation.id, [itemB.id])
    expect(result.status).toBe('error')
    expect(result.errors![0]).toContain('Cannot move')

    const unchanged = await prisma.reservation.findUnique({
      where: { id: reservation.id },
      include: { items: true },
    })
    expect(unchanged!.items[0].id).toBe(itemA.id)
  })
})

// ---------------------------------------------------------------------------
// Bed blocking
// ---------------------------------------------------------------------------

describe('blockBed / unblockBed', () => {
  it('blockBed creates reservation with blocked operationalStatus in DB', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    const item = await createTestInventoryItem(user.id, site.id)
    mockUserId = user.id

    const result = await blockBed(site.id, item.id, 'Maintenance')
    expect(result).toEqual({ status: 'ok' })

    const reservations = await prisma.reservation.findMany({
      where: { siteId: site.id },
      include: { items: true },
    })
    expect(reservations).toHaveLength(1)
    expect(reservations[0].operationalStatus).toBe('blocked')
    expect(reservations[0].internalNotes).toBe('Maintenance')
    expect(reservations[0].items[0].id).toBe(item.id)
  })

  it('unblockBed removes blocked reservation, leaves other reservations', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    const item = await createTestInventoryItem(user.id, site.id)
    mockUserId = user.id

    // Create a block
    await blockBed(site.id, item.id, 'Maintenance')

    // Create a regular reservation on the same item
    await createTestReservation(user.id, site.id, [item.id], {
      status: 'complete',
      operationalStatus: 'expected',
    })

    const beforeCount = await prisma.reservation.count({ where: { siteId: site.id } })
    expect(beforeCount).toBe(2)

    const result = await unblockBed(site.id, item.id)
    expect(result).toEqual({ status: 'ok' })

    const remaining = await prisma.reservation.findMany({ where: { siteId: site.id } })
    expect(remaining).toHaveLength(1)
    expect(remaining[0].operationalStatus).toBe('expected')
  })

  it('blockBed is sticky — stores a far-future end date (survives the day rollover)', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    const item = await createTestInventoryItem(user.id, site.id)
    mockUserId = user.id

    await blockBed(site.id, item.id, 'Broken slat')

    const res = await prisma.reservation.findFirstOrThrow({
      where: { siteId: site.id, operationalStatus: 'blocked' },
    })
    // Far-future `to` ⇒ overlaps every future day's manage query (sticky) and is
    // never < now, so the cleanup cron never sweeps it — only Unblock clears it.
    expect(res.to.getUTCFullYear()).toBe(2999)
  })

  it('unblockBed clears a block placed on a previous day (durable across rollover)', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    const item = await createTestInventoryItem(user.id, site.id)
    mockUserId = user.id

    // A sticky block placed days ago: `from` in the past, far-future `to`.
    await createTestReservation(user.id, site.id, [item.id], {
      status: 'paid-in-cash',
      operationalStatus: 'blocked',
      from: dayjs().subtract(5, 'day').startOf('day').toDate(),
      to: new Date('2999-12-31T23:59:59.999Z'),
    })

    const result = await unblockBed(site.id, item.id)
    expect(result).toEqual({ status: 'ok' })

    const remaining = await prisma.reservation.count({
      where: { siteId: site.id, operationalStatus: 'blocked' },
    })
    expect(remaining).toBe(0)
  })

})

// ---------------------------------------------------------------------------
// Rental operations
// ---------------------------------------------------------------------------

describe('markRentalPickedUp', () => {
  it('transitions reserved -> picked-up with pickedUpAt timestamp in DB', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    const rentalItem = await createTestRentalItem(site.id)
    mockUserId = user.id

    const booking = await prisma.rentalBooking.create({
      data: {
        siteId: site.id,
        rentalItemId: rentalItem.id,
        userId: user.id,
        from: new Date(),
        to: new Date(Date.now() + 24 * 60 * 60 * 1000),
        quantity: 1,
        durationType: 'days',
        totalPrice: 15,
        paymentAmount: 15,
        status: 'complete',
        operationalStatus: 'reserved',
      },
    })

    const result = await markRentalPickedUp(site.id, booking.id)
    expect(result).toEqual({ status: 'ok' })

    const updated = await prisma.rentalBooking.findUnique({ where: { id: booking.id } })
    expect(updated!.operationalStatus).toBe('picked-up')
    expect(updated!.pickedUpAt).toBeTruthy()
  })
})

describe('markRentalReturned', () => {
  it('transitions picked-up -> returned with returnedAt timestamp in DB', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    const rentalItem = await createTestRentalItem(site.id)
    mockUserId = user.id

    const booking = await prisma.rentalBooking.create({
      data: {
        siteId: site.id,
        rentalItemId: rentalItem.id,
        userId: user.id,
        from: new Date(),
        to: new Date(Date.now() + 24 * 60 * 60 * 1000),
        quantity: 1,
        durationType: 'days',
        totalPrice: 15,
        paymentAmount: 15,
        status: 'complete',
        operationalStatus: 'picked-up',
        pickedUpAt: new Date(),
      },
    })

    const result = await markRentalReturned(site.id, booking.id)
    expect(result).toEqual({ status: 'ok' })

    const updated = await prisma.rentalBooking.findUnique({ where: { id: booking.id } })
    expect(updated!.operationalStatus).toBe('returned')
    expect(updated!.returnedAt).toBeTruthy()
  })

  it('rejects from reserved status and DB stays unchanged', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    const rentalItem = await createTestRentalItem(site.id)
    mockUserId = user.id

    const booking = await prisma.rentalBooking.create({
      data: {
        siteId: site.id,
        rentalItemId: rentalItem.id,
        userId: user.id,
        from: new Date(),
        to: new Date(Date.now() + 24 * 60 * 60 * 1000),
        quantity: 1,
        durationType: 'days',
        totalPrice: 15,
        paymentAmount: 15,
        status: 'complete',
        operationalStatus: 'reserved',
      },
    })

    const result = await markRentalReturned(site.id, booking.id)
    expect(result.status).toBe('error')
    expect(result.errors![0]).toContain('Cannot return')

    const unchanged = await prisma.rentalBooking.findUnique({ where: { id: booking.id } })
    expect(unchanged!.operationalStatus).toBe('reserved')
  })
})

// ---------------------------------------------------------------------------
// createWalkInRental
// ---------------------------------------------------------------------------

describe('createWalkInRental', () => {
  it('creates booking in DB with correct pricing (pricePerDay x quantity) and paymentAmount', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    const rentalItem = await createTestRentalItem(site.id, { pricePerDay: 20, totalQuantity: 5 })
    mockUserId = user.id

    const result = await createWalkInRental({
      siteId: site.id,
      items: [{ rentalItemId: rentalItem.id, quantity: 2 }],
      durationType: 'days',
      paymentType: 'cash',
    })

    expect(result.status).toBe('ok')
    expect(result.bookingIds).toHaveLength(1)

    const booking = await prisma.rentalBooking.findUnique({
      where: { id: result.bookingIds![0] },
    })
    expect(booking).toBeTruthy()
    // pricePerDay * 1 day * 2 quantity = 20 * 1 * 2 = 40
    expect(booking!.totalPrice).toBe(40)
    expect(booking!.paymentAmount).toBe(40)
    expect(booking!.status).toBe('paid-in-cash')
    expect(booking!.operationalStatus).toBe('picked-up')
    expect(booking!.pickedUpAt).toBeTruthy()
    expect(booking!.quantity).toBe(2)
    expect(booking!.guestName).toBeNull()
  })

  it('rejects when quantity exceeds availability (real aggregate query)', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    const rentalItem = await createTestRentalItem(site.id, { pricePerDay: 10, totalQuantity: 3 })
    mockUserId = user.id

    // Create existing bookings that use up 2 of 3 available
    await prisma.rentalBooking.create({
      data: {
        siteId: site.id,
        rentalItemId: rentalItem.id,
        userId: user.id,
        from: new Date(),
        to: new Date(Date.now() + 24 * 60 * 60 * 1000),
        quantity: 2,
        durationType: 'days',
        totalPrice: 20,
        paymentAmount: 20,
        status: 'complete',
        operationalStatus: 'reserved',
      },
    })

    // Try to rent 2 more (only 1 available)
    const result = await createWalkInRental({
      siteId: site.id,
      items: [{ rentalItemId: rentalItem.id, quantity: 2 }],
      durationType: 'days',
      paymentType: 'cash',
    })

    expect(result.status).toBe('error')
    expect(result.errors![0]).toContain('available')

    // Verify nothing was created beyond the pre-existing one
    const bookings = await prisma.rentalBooking.count({ where: { siteId: site.id } })
    expect(bookings).toBe(1)
  })

  it('sets zero totalPrice and paymentAmount for free rentals', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    const rentalItem = await createTestRentalItem(site.id, { pricePerDay: 25, totalQuantity: 5 })
    mockUserId = user.id

    const result = await createWalkInRental({
      siteId: site.id,
      items: [{ rentalItemId: rentalItem.id, quantity: 1 }],
      durationType: 'days',
      paymentType: 'free',
    })

    expect(result.status).toBe('ok')

    const booking = await prisma.rentalBooking.findUnique({
      where: { id: result.bookingIds![0] },
    })
    expect(booking!.totalPrice).toBe(0)
    expect(booking!.paymentAmount).toBe(0)
    expect(booking!.status).toBe('complete')
  })
})

// ---------------------------------------------------------------------------
// Bug-revealing: moveReservation double-booking (bug closed by
// moveReservationWithConflictGuard).
//
// Before this fix, moveReservation used a bare prisma.reservation.update with
// NO conflict check. A move onto a bed already reserved by a different guest
// would silently succeed, leaving two reservations covering the same bed.
// ---------------------------------------------------------------------------

describe('moveReservation — conflict detection (was a silent double-book before)', () => {
  it('rejects moving a reservation onto a bed already occupied by another reservation', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    const itemA = await createTestInventoryItem(user.id, site.id, { number: 1 })
    const itemB = await createTestInventoryItem(user.id, site.id, { number: 2 })
    mockUserId = user.id

    const today0 = new Date(new Date().setHours(0, 0, 0, 0))
    const today23 = new Date(new Date().setHours(23, 59, 59, 999))

    // reservation1 sits on itemA — we will attempt to move this to itemB
    const reservation1 = await createTestReservation(user.id, site.id, [itemA.id], {
      from: today0,
      to: today23,
      status: 'complete',
      operationalStatus: 'expected',
    })

    // reservation2 already occupies itemB — this is the conflict
    await createTestReservation(user.id, site.id, [itemB.id], {
      from: today0,
      to: today23,
      status: 'complete',
      operationalStatus: 'expected',
    })

    // Attempt to move reservation1 onto itemB (already occupied by reservation2)
    const result = await moveReservation(site.id, reservation1.id, [itemB.id])

    // Guard must detect the conflict and reject
    expect(result.status).toBe('error')
    expect(result.errors![0]).toMatch(/already reserved/i)

    // reservation1 must still be on itemA (the move must have been rolled back)
    const unchanged = await prisma.reservation.findUnique({
      where: { id: reservation1.id },
      include: { items: true },
    })
    expect(unchanged!.items).toHaveLength(1)
    expect(unchanged!.items[0].id).toBe(itemA.id)

    // Both reservations must still exist (nothing was corrupted)
    const totalCount = await prisma.reservation.count({ where: { siteId: site.id } })
    expect(totalCount).toBe(2)
  })

  it('succeeds when the target bed is genuinely free (clean move path)', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    const itemA = await createTestInventoryItem(user.id, site.id, { number: 1 })
    const itemB = await createTestInventoryItem(user.id, site.id, { number: 2 })
    mockUserId = user.id

    const reservation = await createTestReservation(user.id, site.id, [itemA.id], {
      status: 'complete',
      operationalStatus: 'expected',
    })

    const result = await moveReservation(site.id, reservation.id, [itemB.id])
    expect(result.status).toBe('ok')

    const updated = await prisma.reservation.findUnique({
      where: { id: reservation.id },
      include: { items: true },
    })
    expect(updated!.items).toHaveLength(1)
    expect(updated!.items[0].id).toBe(itemB.id)
  })
})

// ---------------------------------------------------------------------------
// markDeparted — split-then-depart (cash walk-in per-seat)
//
// These tests verify the split path added to `markDeparted`:
//   - 3-seat cash walk-in → split-depart one seat → original keeps 2 items
//     walked-in with reduced amount; new 1-item reservation departed with
//     per-seat amount and original employeeId.
//   - Till conservation: sum of both amounts equals the original total.
//   - Multi-day variant: new reservation expected (not departed) on a non-last day.
//   - Last-day variant: new reservation departed.
// ---------------------------------------------------------------------------

describe('markDeparted — split-then-depart (cash walk-in)', () => {
  it('3-seat multi-day cash walk-in: splits one seat, original keeps 2 items walked-in', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id, { type: 'paid', price: 10 })
    const itemA = await createTestInventoryItem(user.id, site.id, { number: 1 })
    const itemB = await createTestInventoryItem(user.id, site.id, { number: 2 })
    const itemC = await createTestInventoryItem(user.id, site.id, { number: 3 })
    mockUserId = user.id

    // Create a 3-seat multi-day cash walk-in (today → tomorrow)
    const today0 = dayjs().startOf('day').toDate()
    const tomorrow23 = dayjs().add(1, 'day').endOf('day').toDate()
    const reservation = await createTestReservation(user.id, site.id, [itemA.id, itemB.id, itemC.id], {
      from: today0,
      to: tomorrow23,
      status: 'paid-in-cash',
      operationalStatus: 'walked-in',
      checkedInAt: new Date(),
      paymentAmount: 30, // 3 seats × 10€ × 1 day (initial, will be split)
      employeeId: null,
    })

    // Split-depart itemA
    const result = await markDeparted(site.id, reservation.id, undefined, [itemA.id])
    expect(result.status).toBe('ok')

    // Original reservation must still have 2 items
    const original = await prisma.reservation.findUnique({
      where: { id: reservation.id },
      include: { items: true },
    })
    expect(original).not.toBeNull()
    const originalItemIds = original!.items.map((i) => i.id).sort()
    expect(originalItemIds).toEqual([itemB.id, itemC.id].sort())
    // Original stays walked-in
    expect(original!.operationalStatus).toBe('walked-in')
    // Original's amount = 2 remaining seats × 10€ × 2 days = 40
    // (computeWalkInAmount: days = Math.max(1, Math.round((tomorrow23 - today0) / 86400000)) = 2)
    expect(original!.paymentAmount).toBe(40) // 2 seats × 10€ × 2 days

    // A new reservation must exist for itemA
    const newRes = await prisma.reservation.findFirst({
      where: {
        siteId: site.id,
        id: { not: reservation.id },
      },
      include: { items: true },
    })
    expect(newRes).not.toBeNull()
    expect(newRes!.items).toHaveLength(1)
    expect(newRes!.items[0].id).toBe(itemA.id)
    expect(newRes!.status).toBe('paid-in-cash')
    // Multi-day → new reservation should be expected (departed today, re-rentable tomorrow)
    expect(newRes!.operationalStatus).toBe('expected')
    expect(newRes!.paymentAmount).toBe(20) // 1 seat × 10€ × 2 days
  })

  it('till is conserved: split amounts sum to original total', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id, { type: 'paid', price: 15 })
    const itemA = await createTestInventoryItem(user.id, site.id, { number: 1 })
    const itemB = await createTestInventoryItem(user.id, site.id, { number: 2 })
    const itemC = await createTestInventoryItem(user.id, site.id, { number: 3 })
    mockUserId = user.id

    const today0 = dayjs().startOf('day').toDate()
    const today23 = dayjs().endOf('day').toDate()
    const reservation = await createTestReservation(user.id, site.id, [itemA.id, itemB.id, itemC.id], {
      from: today0,
      to: today23,
      status: 'paid-in-cash',
      operationalStatus: 'walked-in',
      checkedInAt: new Date(),
      paymentAmount: 45, // 3 × 15€ × 1 day
      employeeId: null,
    })

    await markDeparted(site.id, reservation.id, undefined, [itemA.id])

    const original = await prisma.reservation.findUnique({ where: { id: reservation.id } })
    const newRes = await prisma.reservation.findFirst({
      where: { siteId: site.id, id: { not: reservation.id } },
    })

    expect(original!.paymentAmount! + newRes!.paymentAmount!).toBe(45)
  })

  it('last-day split: new reservation is departed (bed freed)', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id, { type: 'paid', price: 10 })
    const itemA = await createTestInventoryItem(user.id, site.id, { number: 1 })
    const itemB = await createTestInventoryItem(user.id, site.id, { number: 2 })
    mockUserId = user.id

    // Today-only (last day)
    const today0 = dayjs().startOf('day').toDate()
    const today23 = dayjs().endOf('day').toDate()
    const reservation = await createTestReservation(user.id, site.id, [itemA.id, itemB.id], {
      from: today0,
      to: today23,
      status: 'paid-in-cash',
      operationalStatus: 'walked-in',
      checkedInAt: new Date(),
      paymentAmount: 20,
      employeeId: null,
    })

    await markDeparted(site.id, reservation.id, undefined, [itemA.id])

    const newRes = await prisma.reservation.findFirst({
      where: { siteId: site.id, id: { not: reservation.id } },
    })
    expect(newRes!.operationalStatus).toBe('departed')
    expect(newRes!.departedAt).toBeInstanceOf(Date)
  })

  it('original employeeId is preserved on the new reservation', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id, { type: 'paid', price: 10 })
    const itemA = await createTestInventoryItem(user.id, site.id, { number: 1 })
    const itemB = await createTestInventoryItem(user.id, site.id, { number: 2 })
    mockUserId = user.id

    // Create a PartnerAccount (Employee.accountId FK points to PartnerAccount)
    const account = await createTestPartnerAccount(user.id)
    // Create an employee to attribute
    const employee = await prisma.employee.create({
      data: { accountId: account.userId, name: 'Staff Member', active: true },
    })

    const today0 = dayjs().startOf('day').toDate()
    const today23 = dayjs().endOf('day').toDate()
    const reservation = await createTestReservation(user.id, site.id, [itemA.id, itemB.id], {
      from: today0,
      to: today23,
      status: 'paid-in-cash',
      operationalStatus: 'walked-in',
      checkedInAt: new Date(),
      paymentAmount: 20,
      employeeId: employee.id,
    })

    await markDeparted(site.id, reservation.id, undefined, [itemA.id])

    const newRes = await prisma.reservation.findFirst({
      where: { siteId: site.id, id: { not: reservation.id } },
    })
    // Original employeeId preserved on the new reservation (not the departing worker)
    expect(newRes!.employeeId).toBe(employee.id)
  })
})

// ---------------------------------------------------------------------------
// Bug-revealing: pair-expansion double-booking (suspect bug #2)
//
// Before this fix, reserveItem checked availability on only the requested
// itemId, then expanded to siblings AFTER — so a sibling already booked was
// invisible to the conflict check. These tests would have produced a silent
// overbook (two reservations covering the same sibling) pre-fix.
// ---------------------------------------------------------------------------

describe('reserveItem — pair-expansion conflict detection (bug #2)', () => {
  it('rejects reserving a primary item when its SunbedGroup sibling is already booked today', async () => {
    // Bug scenario: sibling (itemB) is already occupied. Partner tries to
    // reserve itemA (the primary). Old code checked only itemA → passed → created
    // a reservation covering itemA+itemB even though itemB was already taken.
    const user = await createTestUser()
    const site = await createTestSite(user.id)

    // Set up a SunbedGroup with two members (itemA = primary, itemB = sibling)
    const group = await prisma.sunbedGroup.create({ data: { siteId: site.id } })
    const itemA = await createTestInventoryItem(user.id, site.id, {
      number: 1,
      sunbedGroupId: group.id,
    })
    const itemB = await createTestInventoryItem(user.id, site.id, {
      number: 2,
      sunbedGroupId: group.id,
    })
    mockUserId = user.id

    // Pre-existing reservation occupying the SIBLING (itemB) today
    await createTestReservation(user.id, site.id, [itemB.id], {
      from: new Date(new Date().setHours(0, 0, 0, 0)),
      to: new Date(new Date().setHours(23, 59, 59, 999)),
      status: 'complete',
      operationalStatus: 'expected',
    })

    // Now try to reserve itemA — should detect sibling conflict and reject
    const result = await reserveItem(site.id, itemA.id)

    expect(result.status).toBe('error')
    expect(result.errors?.[0]).toMatch(/already reserved/i)

    // Verify no additional reservation was created beyond the pre-existing one
    const count = await prisma.reservation.count({ where: { siteId: site.id } })
    expect(count).toBe(1)
  })

  it('rejects reserving a primary item when its legacy pairId sibling is already booked today', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)

    // Legacy pair: itemA has pairId pointing to itemB
    const itemA = await createTestInventoryItem(user.id, site.id, { number: 1 })
    const itemB = await createTestInventoryItem(user.id, site.id, {
      number: 2,
      pairId: itemA.id,
    })
    mockUserId = user.id

    // Pre-existing reservation occupying the SIBLING (itemB) today
    await createTestReservation(user.id, site.id, [itemB.id], {
      from: new Date(new Date().setHours(0, 0, 0, 0)),
      to: new Date(new Date().setHours(23, 59, 59, 999)),
      status: 'complete',
      operationalStatus: 'expected',
    })

    // Reserve itemA — should detect conflict on itemB (its pair) and reject
    const result = await reserveItem(site.id, itemA.id)

    expect(result.status).toBe('error')
    expect(result.errors?.[0]).toMatch(/already reserved/i)

    const count = await prisma.reservation.count({ where: { siteId: site.id } })
    expect(count).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Bug-revealing: blockBed missing conflict check
//
// Before this fix, blockBed had NO conflict check — it blindly created a
// reservation row. These tests prove that an already-occupied bed is rejected.
// ---------------------------------------------------------------------------

describe('blockBed — conflict detection (previously missing)', () => {
  it('rejects blocking a bed that already has an active walk-in reservation today', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    const item = await createTestInventoryItem(user.id, site.id)
    mockUserId = user.id

    // Walk-in reservation already occupies the bed
    await reserveItem(site.id, item.id, 'Existing guest')

    // Attempt to block the same bed
    const blockResult = await blockBed(site.id, item.id)

    expect(blockResult.status).toBe('error')
    expect(blockResult.errors?.[0]).toMatch(/already occupied or blocked/i)

    // Verify no second reservation was created
    const count = await prisma.reservation.count({ where: { siteId: site.id } })
    expect(count).toBe(1)
  })

  it('rejects double-blocking the same bed', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    const item = await createTestInventoryItem(user.id, site.id)
    mockUserId = user.id

    // First block succeeds
    const first = await blockBed(site.id, item.id, 'Maintenance')
    expect(first.status).toBe('ok')

    // Second block must be rejected
    const second = await blockBed(site.id, item.id, 'Double block attempt')
    expect(second.status).toBe('error')
    expect(second.errors?.[0]).toMatch(/already occupied or blocked/i)

    // Only one block reservation in DB
    const count = await prisma.reservation.count({ where: { siteId: site.id } })
    expect(count).toBe(1)
  })

  it('rejects blocking a bed whose SunbedGroup sibling is already occupied', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)

    const group = await prisma.sunbedGroup.create({ data: { siteId: site.id } })
    const itemA = await createTestInventoryItem(user.id, site.id, {
      number: 1,
      sunbedGroupId: group.id,
    })
    const itemB = await createTestInventoryItem(user.id, site.id, {
      number: 2,
      sunbedGroupId: group.id,
    })
    mockUserId = user.id

    // Reserve itemB (the sibling)
    await createTestReservation(user.id, site.id, [itemB.id], {
      from: new Date(new Date().setHours(0, 0, 0, 0)),
      to: new Date(new Date().setHours(23, 59, 59, 999)),
      status: 'complete',
      operationalStatus: 'expected',
    })

    // Try to block itemA — sibling itemB is occupied, should reject
    const result = await blockBed(site.id, itemA.id)

    expect(result.status).toBe('error')
    expect(result.errors?.[0]).toMatch(/already occupied or blocked/i)

    const count = await prisma.reservation.count({ where: { siteId: site.id } })
    expect(count).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Floor-staff attribution (track 008) — employeeId stamping + walk-in cash €
// ---------------------------------------------------------------------------

describe('floor-staff attribution', () => {
  // A roster employee requires a PartnerAccount (Employee.accountId → userId).
  async function setupWithEmployee(siteOverrides: Record<string, any> = {}) {
    const user = await createTestUser()
    await createTestPartnerAccount(user.id)
    const site = await createTestSite(user.id, siteOverrides)
    const item = await createTestInventoryItem(user.id, site.id)
    const employee = await prisma.employee.create({
      data: { accountId: user.id, name: 'Alice' },
    })
    mockUserId = user.id
    return { user, site, item, employee }
  }

  it('reserveItem stamps a valid worker and records the walk-in cash on a paid site', async () => {
    const { site, item, employee } = await setupWithEmployee({ type: 'paid', price: 12 })

    const result = await reserveItem(site.id, item.id, undefined, undefined, undefined, undefined, true, employee.id)
    expect(result).toEqual({ status: 'ok' })

    const res = await prisma.reservation.findFirstOrThrow({ where: { siteId: site.id } })
    expect(res.employeeId).toBe(employee.id)
    // Single chair, one day, site price 12 → € recorded so the till has money.
    expect(res.paymentAmount).toBe(12)
  })

  it('reserveItem drops a cross-account worker id (no spoofing) but still books', async () => {
    const { site, item } = await setupWithEmployee({ type: 'paid', price: 12 })
    // An employee belonging to a DIFFERENT account.
    const otherUser = await createTestUser()
    await createTestPartnerAccount(otherUser.id)
    const foreign = await prisma.employee.create({ data: { accountId: otherUser.id, name: 'Mallory' } })

    const result = await reserveItem(site.id, item.id, undefined, undefined, undefined, undefined, true, foreign.id)
    expect(result).toEqual({ status: 'ok' })

    const res = await prisma.reservation.findFirstOrThrow({ where: { siteId: site.id } })
    expect(res.employeeId).toBeNull()
  })

  it('reserveItem records no cash on a free site but still attributes the worker', async () => {
    const { site, item, employee } = await setupWithEmployee({ type: 'free', price: 12 })

    await reserveItem(site.id, item.id, undefined, undefined, undefined, undefined, true, employee.id)

    const res = await prisma.reservation.findFirstOrThrow({ where: { siteId: site.id } })
    expect(res.employeeId).toBe(employee.id)
    expect(res.paymentAmount).toBe(0)
  })

  it('createWalkInRental stamps the worker on each booking', async () => {
    const { site, employee } = await setupWithEmployee()
    const rentalItem = await createTestRentalItem(site.id)

    const result = await createWalkInRental({
      siteId: site.id,
      items: [{ rentalItemId: rentalItem.id, quantity: 1 }],
      durationType: 'hours',
      hours: 2,
      paymentType: 'cash',
      employeeId: employee.id,
    })
    expect(result.status).toBe('ok')

    const booking = await prisma.rentalBooking.findFirstOrThrow({ where: { siteId: site.id } })
    expect(booking.employeeId).toBe(employee.id)
  })
})

// ---------------------------------------------------------------------------
// Per-worker till (track 008 Phase 3) — getTillStatus + closeTill
// ---------------------------------------------------------------------------

describe('per-worker till', () => {
  async function setupWithEmployee(siteOverrides: Record<string, any> = {}) {
    const user = await createTestUser()
    await createTestPartnerAccount(user.id)
    const site = await createTestSite(user.id, siteOverrides)
    const item = await createTestInventoryItem(user.id, site.id)
    const employee = await prisma.employee.create({ data: { accountId: user.id, name: 'Alice' } })
    mockUserId = user.id
    return { user, site, item, employee }
  }

  it('getTillStatus reflects a cash walk-in attributed to the worker', async () => {
    const { site, item, employee } = await setupWithEmployee({ type: 'paid', price: 10 })
    await reserveItem(site.id, item.id, undefined, undefined, undefined, undefined, true, employee.id)

    expect(await getTillStatus(site.id, employee.id)).toEqual({ status: 'ok', total: 10, count: 1 })
  })

  it('closeTill snapshots the open total and resets the open till to zero', async () => {
    const { site, item, employee } = await setupWithEmployee({ type: 'paid', price: 10 })
    await reserveItem(site.id, item.id, undefined, undefined, undefined, undefined, true, employee.id)

    const closed = await closeTill(site.id, employee.id)
    expect(closed).toMatchObject({ status: 'ok', total: 10, count: 1, closed: true })

    const snaps = await prisma.tillClose.findMany({ where: { siteId: site.id, employeeId: employee.id } })
    expect(snaps).toHaveLength(1)
    expect(snaps[0].totalAmount).toBe(10)
    expect(snaps[0].txnCount).toBe(1)

    // Open till now reads zero — only cash AFTER the close counts.
    expect(await getTillStatus(site.id, employee.id)).toEqual({ status: 'ok', total: 0, count: 0 })
  })

  it('closeTill on an empty till is a no-op (no snapshot written)', async () => {
    const { site, employee } = await setupWithEmployee()

    const res = await closeTill(site.id, employee.id)
    expect(res).toEqual({ status: 'ok', total: 0, count: 0, closed: false })
    expect(await prisma.tillClose.count({ where: { siteId: site.id } })).toBe(0)
  })

  it('getTillStatus rejects an unknown / cross-account worker', async () => {
    const { site } = await setupWithEmployee()
    const res = await getTillStatus(site.id, 'no-such-employee')
    expect(res.status).toBe('error')
  })
})

// ---------------------------------------------------------------------------
// Floor reservation lookup / arrivals (track 010) — findReservations
// ---------------------------------------------------------------------------

describe('findReservations', () => {
  it('no query → today arrivals (expected complete + held); excludes already-seated walk-ins', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    const i1 = await createTestInventoryItem(user.id, site.id, { number: 1 })
    const i2 = await createTestInventoryItem(user.id, site.id, { number: 2 })
    const i3 = await createTestInventoryItem(user.id, site.id, { number: 3 })
    mockUserId = user.id

    await createTestReservation(user.id, site.id, [i1.id], { status: 'complete', operationalStatus: 'expected', guestName: 'Online Expected' })
    await createTestReservation(user.id, site.id, [i2.id], { status: 'held', operationalStatus: 'expected', guestName: 'Pencilled In' })
    // already seated → not an "arrival"
    await createTestReservation(user.id, site.id, [i3.id], { status: 'paid-in-cash', operationalStatus: 'walked-in', guestName: 'Already Here' })

    const res = await findReservations(site.id)
    expect(res.status).toBe('ok')
    expect(res.reservations.map((r) => r.guestName).sort()).toEqual(['Online Expected', 'Pencilled In'])
    // carries party size + bed numbers for the row + Locate
    const online = res.reservations.find((r) => r.guestName === 'Online Expected')!
    expect(online.partySize).toBe(1)
    expect(online.items.map((i) => i.number)).toEqual([1])
  })

  it('search by name matches case-insensitively', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    const item = await createTestInventoryItem(user.id, site.id)
    mockUserId = user.id
    await createTestReservation(user.id, site.id, [item.id], { status: 'complete', operationalStatus: 'expected', guestName: 'Pedro Garcia' })

    const res = await findReservations(site.id, 'GARCIA')
    expect(res.reservations).toHaveLength(1)
    expect(res.reservations[0].guestName).toBe('Pedro Garcia')
  })

  it('search surfaces a FUTURE booking that is not on today\'s grid', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    const item = await createTestInventoryItem(user.id, site.id)
    mockUserId = user.id
    await createTestReservation(user.id, site.id, [item.id], {
      status: 'complete', operationalStatus: 'expected', guestName: 'Future Garcia',
      from: dayjs().add(7, 'day').startOf('day').toDate(),
      to: dayjs().add(7, 'day').endOf('day').toDate(),
    })

    // The default arrivals view (today) can't see it…
    expect((await findReservations(site.id)).reservations).toHaveLength(0)
    // …but search reaches into the near future.
    const res = await findReservations(site.id, 'garcia')
    expect(res.reservations).toHaveLength(1)
    expect(res.reservations[0].guestName).toBe('Future Garcia')
  })

  it('search excludes canceled / refunded bookings', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    const item = await createTestInventoryItem(user.id, site.id)
    mockUserId = user.id
    await createTestReservation(user.id, site.id, [item.id], { status: 'canceled', operationalStatus: 'expected', guestName: 'Canceled Garcia' })

    const res = await findReservations(site.id, 'garcia')
    expect(res.reservations).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Grouped walk-in: reserveItems (track 011 P1)
// ---------------------------------------------------------------------------

describe('reserveItems — grouped walk-in', () => {
  it('creates ONE Reservation row with all N items connected', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    const itemA = await createTestInventoryItem(user.id, site.id, { number: 1 })
    const itemB = await createTestInventoryItem(user.id, site.id, { number: 2 })
    const itemC = await createTestInventoryItem(user.id, site.id, { number: 3 })
    mockUserId = user.id

    const result = await reserveItems(site.id, [itemA.id, itemB.id, itemC.id], 'Group A')
    expect(result).toEqual({ status: 'ok' })

    const reservations = await prisma.reservation.findMany({
      where: { siteId: site.id },
      include: { items: true },
    })
    // Exactly ONE reservation created
    expect(reservations).toHaveLength(1)

    const res = reservations[0]
    expect(res.status).toBe('paid-in-cash')
    expect(res.operationalStatus).toBe('walked-in')
    expect(res.checkedInAt).toBeTruthy()
    expect(res.guestName).toBe('Group A')

    // All 3 items are connected to the single reservation
    const connectedIds = res.items.map((i) => i.id).sort()
    expect(connectedIds).toEqual([itemA.id, itemB.id, itemC.id].sort())
  })

  it('sums paymentAmount across all seats from DB prices (paid site, 1 day)', async () => {
    const user = await createTestUser()
    await createTestPartnerAccount(user.id)
    const site = await createTestSite(user.id, { type: 'paid', price: 10 })
    // item-level prices: 20 and 15; site fallback would be 10 but won't be used here
    const itemA = await createTestInventoryItem(user.id, site.id, { number: 1, price: 20 })
    const itemB = await createTestInventoryItem(user.id, site.id, { number: 2, price: 15 })
    mockUserId = user.id

    await reserveItems(site.id, [itemA.id, itemB.id])

    const res = await prisma.reservation.findFirstOrThrow({ where: { siteId: site.id } })
    // 20 + 15 = 35 for today (1 day)
    expect(res.paymentAmount).toBe(35)
  })

  it('falls back to site price when items have no individual price', async () => {
    const user = await createTestUser()
    await createTestPartnerAccount(user.id)
    const site = await createTestSite(user.id, { type: 'paid', price: 12 })
    const itemA = await createTestInventoryItem(user.id, site.id, { number: 1 })
    const itemB = await createTestInventoryItem(user.id, site.id, { number: 2 })
    mockUserId = user.id

    await reserveItems(site.id, [itemA.id, itemB.id])

    const res = await prisma.reservation.findFirstOrThrow({ where: { siteId: site.id } })
    // 12 + 12 = 24 (both fall back to site price) × 1 day
    expect(res.paymentAmount).toBe(24)
  })

  it('conflict atomicity: if ONE seat is already taken, NOTHING is created', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    const itemA = await createTestInventoryItem(user.id, site.id, { number: 1 })
    const itemB = await createTestInventoryItem(user.id, site.id, { number: 2 })
    const itemC = await createTestInventoryItem(user.id, site.id, { number: 3 })
    mockUserId = user.id

    // Pre-existing reservation occupying itemB only
    await createTestReservation(user.id, site.id, [itemB.id], {
      from: new Date(new Date().setHours(0, 0, 0, 0)),
      to: new Date(new Date().setHours(23, 59, 59, 999)),
      status: 'complete',
      operationalStatus: 'expected',
    })

    // Attempt to group-reserve all three — itemB conflict must fail everything
    const result = await reserveItems(site.id, [itemA.id, itemB.id, itemC.id])
    expect(result.status).toBe('error')
    expect(result.errors?.[0]).toMatch(/already reserved/i)

    // Only the pre-existing reservation survives; no partial reservation created
    const allReservations = await prisma.reservation.findMany({ where: { siteId: site.id } })
    expect(allReservations).toHaveLength(1)

    // itemA and itemC remain free (not connected to any new reservation)
    const newRes = allReservations[0]
    expect(newRes.status).toBe('complete')
    const connectedItems = await prisma.reservation.findFirst({
      where: { siteId: site.id },
      include: { items: true },
    })
    const connectedIds = connectedItems!.items.map((i) => i.id)
    expect(connectedIds).not.toContain(itemA.id)
    expect(connectedIds).not.toContain(itemC.id)
  })

  it('till records ONE summed walk-in amount (one line) for the group', async () => {
    const user = await createTestUser()
    await createTestPartnerAccount(user.id)
    const site = await createTestSite(user.id, { type: 'paid', price: 10 })
    const itemA = await createTestInventoryItem(user.id, site.id, { number: 1 })
    const itemB = await createTestInventoryItem(user.id, site.id, { number: 2 })
    const employee = await prisma.employee.create({ data: { accountId: user.id, name: 'Beach Staff' } })
    mockUserId = user.id

    await reserveItems(site.id, [itemA.id, itemB.id], 'Couple', undefined, undefined, undefined, employee.id)

    // Till should show ONE transaction worth 2 × 10 = 20
    const till = await getTillStatus(site.id, employee.id)
    expect(till.status).toBe('ok')
    expect((till as any).count).toBe(1)
    expect((till as any).total).toBe(20)
  })

  it('rejects non-owner and creates nothing in DB', async () => {
    const owner = await createTestUser()
    const stranger = await createTestUser()
    const site = await createTestSite(owner.id)
    const item = await createTestInventoryItem(owner.id, site.id)
    mockUserId = stranger.id

    const result = await reserveItems(site.id, [item.id])
    expect(result.status).toBe('error')

    expect(await prisma.reservation.count({ where: { siteId: site.id } })).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Grouped hold: holdBeds (track 011 P1)
// ---------------------------------------------------------------------------

describe('holdBeds — grouped hold', () => {
  it('creates ONE held Reservation row with all N items connected', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    const itemA = await createTestInventoryItem(user.id, site.id, { number: 1 })
    const itemB = await createTestInventoryItem(user.id, site.id, { number: 2 })
    mockUserId = user.id

    const result = await holdBeds(site.id, [itemA.id, itemB.id], undefined, 'Group B')
    expect(result).toEqual({ status: 'ok' })

    const reservations = await prisma.reservation.findMany({
      where: { siteId: site.id },
      include: { items: true },
    })
    expect(reservations).toHaveLength(1)

    const res = reservations[0]
    expect(res.status).toBe('held')
    expect(res.operationalStatus).toBe('expected')
    expect(res.checkedInAt).toBeNull()
    expect(res.guestName).toBe('Group B')
    expect(res.paymentAmount).toBe(0)

    const connectedIds = res.items.map((i) => i.id).sort()
    expect(connectedIds).toEqual([itemA.id, itemB.id].sort())
  })

  it('conflict atomicity: if ONE seat is taken, NOTHING is created', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    const itemA = await createTestInventoryItem(user.id, site.id, { number: 1 })
    const itemB = await createTestInventoryItem(user.id, site.id, { number: 2 })
    mockUserId = user.id

    // Pre-occupy itemA
    await reserveItem(site.id, itemA.id, 'Existing guest')

    // Attempt to hold both — conflict on itemA must roll back everything
    const result = await holdBeds(site.id, [itemA.id, itemB.id])
    expect(result.status).toBe('error')
    expect(result.errors?.[0]).toMatch(/already occupied or blocked/i)

    // Only the walk-in from reserveItem survives; no hold reservation created
    const allReservations = await prisma.reservation.findMany({ where: { siteId: site.id } })
    expect(allReservations).toHaveLength(1)
    expect(allReservations[0].status).toBe('paid-in-cash')

    // itemB is still free (not connected to any new reservation)
    const holdRes = await prisma.reservation.findFirst({
      where: { siteId: site.id, status: 'held' },
    })
    expect(holdRes).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// P3 — Grouped-reservation lifecycle (track 011)
//
// A grouped reservation is ONE Reservation row connected to N InventoryItems.
// These tests verify that check-in / depart / no-show / cancel / move all act
// on the WHOLE booking — no seat left behind — when the reservation was
// created by reserveItems (walk-in) or holdBeds (hold).
// ---------------------------------------------------------------------------

describe('grouped reservation lifecycle (track 011 P3)', () => {
  // ─── Helper: build a 3-seat grouped walk-in ────────────────────────────────

  async function buildGroupedWalkIn() {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    const itemA = await createTestInventoryItem(user.id, site.id, { number: 1 })
    const itemB = await createTestInventoryItem(user.id, site.id, { number: 2 })
    const itemC = await createTestInventoryItem(user.id, site.id, { number: 3 })
    mockUserId = user.id

    const result = await reserveItems(site.id, [itemA.id, itemB.id, itemC.id], 'Group Test')
    expect(result).toEqual({ status: 'ok' })

    const reservation = await prisma.reservation.findFirstOrThrow({
      where: { siteId: site.id },
      include: { items: true },
    })
    expect(reservation.items).toHaveLength(3)

    return { user, site, items: [itemA, itemB, itemC], reservation }
  }

  async function buildGroupedHold() {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    const itemA = await createTestInventoryItem(user.id, site.id, { number: 1 })
    const itemB = await createTestInventoryItem(user.id, site.id, { number: 2 })
    const itemC = await createTestInventoryItem(user.id, site.id, { number: 3 })
    mockUserId = user.id

    const result = await holdBeds(site.id, [itemA.id, itemB.id, itemC.id], undefined, 'Hold Group')
    expect(result).toEqual({ status: 'ok' })

    const reservation = await prisma.reservation.findFirstOrThrow({
      where: { siteId: site.id },
      include: { items: true },
    })
    expect(reservation.items).toHaveLength(3)

    return { user, site, items: [itemA, itemB, itemC], reservation }
  }

  // ─── 1. Check-in spans all N seats ─────────────────────────────────────────

  it('checkInReservation: sets checked-in on the grouped reservation row (covers all N seats)', async () => {
    // A grouped reservation is one row; check-in on the reservationId naturally
    // covers all connected seats. This test confirms that.
    const { site, items, reservation } = await buildGroupedWalkIn()
    // Walk-ins already have operationalStatus=walked-in; create a grouped
    // consumer-style reservation with operationalStatus=expected to exercise the
    // expected→checked-in transition.
    const user2 = await createTestUser()
    const site2 = await createTestSite(user2.id)
    const i1 = await createTestInventoryItem(user2.id, site2.id, { number: 1 })
    const i2 = await createTestInventoryItem(user2.id, site2.id, { number: 2 })
    const i3 = await createTestInventoryItem(user2.id, site2.id, { number: 3 })
    mockUserId = user2.id

    const groupRes = await createTestReservation(user2.id, site2.id, [i1.id, i2.id, i3.id], {
      status: 'complete',
      operationalStatus: 'expected',
      from: new Date(new Date().setHours(0, 0, 0, 0)),
      to: new Date(new Date().setHours(23, 59, 59, 999)),
    })

    const checkInResult = await checkInReservation(site2.id, groupRes.id)
    expect(checkInResult).toEqual({ status: 'ok' })

    // The ONE reservation row is checked-in.
    const updated = await prisma.reservation.findUnique({
      where: { id: groupRes.id },
      include: { items: true },
    })
    expect(updated!.operationalStatus).toBe('checked-in')
    expect(updated!.checkedInAt).toBeTruthy()

    // All 3 seats are still connected — none were dropped.
    const connectedIds = updated!.items.map((i) => i.id).sort()
    expect(connectedIds).toEqual([i1.id, i2.id, i3.id].sort())
  })

  // ─── 2. Depart frees all N seats ───────────────────────────────────────────

  it('markDeparted: departing a single-day grouped walk-in releases all its seats (stay over → re-rentable)', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    const i1 = await createTestInventoryItem(user.id, site.id, { number: 1 })
    const i2 = await createTestInventoryItem(user.id, site.id, { number: 2 })
    const i3 = await createTestInventoryItem(user.id, site.id, { number: 3 })
    mockUserId = user.id

    // Build grouped walk-in with walked-in status (allows markDeparted).
    const groupRes = await createTestReservation(user.id, site.id, [i1.id, i2.id, i3.id], {
      status: 'paid-in-cash',
      operationalStatus: 'walked-in',
      from: new Date(new Date().setHours(0, 0, 0, 0)),
      to: new Date(new Date().setHours(23, 59, 59, 999)),
    })

    const departResult = await markDeparted(site.id, groupRes.id)
    expect(departResult).toEqual({ status: 'ok' })

    const departed = await prisma.reservation.findUnique({
      where: { id: groupRes.id },
      include: { items: true },
    })
    expect(departed!.operationalStatus).toBe('departed')
    expect(departed!.departedAt).toBeTruthy()

    // track 012 stay-over rule: this is a SAME-DAY walk-in (to = end of today), so
    // departing it ends the stay → the seats are released and re-rentable. (A
    // MULTIDAY booking departed mid-stay stays held — covered by the conflict-guard
    // integration tests in @repo/data.)
    const newResResult = await reserveItems(site.id, [i1.id, i2.id, i3.id], 'New Group')
    expect(newResResult).toEqual({ status: 'ok' })

    // One original + one new reservation.
    const allReservations = await prisma.reservation.findMany({ where: { siteId: site.id } })
    expect(allReservations).toHaveLength(2)
  })

  // ─── 3. No-show applies to whole reservation ───────────────────────────────

  it('markNoShow: applied to grouped reservation — single row updated, all seats handled', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    const i1 = await createTestInventoryItem(user.id, site.id, { number: 1 })
    const i2 = await createTestInventoryItem(user.id, site.id, { number: 2 })
    const i3 = await createTestInventoryItem(user.id, site.id, { number: 3 })
    mockUserId = user.id

    const groupRes = await createTestReservation(user.id, site.id, [i1.id, i2.id, i3.id], {
      status: 'complete',
      operationalStatus: 'expected',
      from: new Date(new Date().setHours(0, 0, 0, 0)),
      to: new Date(new Date().setHours(23, 59, 59, 999)),
    })

    const noShowResult = await markNoShow(site.id, groupRes.id)
    expect(noShowResult).toEqual({ status: 'ok' })

    const updated = await prisma.reservation.findUnique({
      where: { id: groupRes.id },
      include: { items: true },
    })
    expect(updated!.operationalStatus).toBe('no-show')

    // All 3 seats still connected — the row was updated, not deleted.
    expect(updated!.items).toHaveLength(3)

    // track 012 stay-over rule: same-day no-show → stay over → seats released, so
    // rebooking the same seats succeeds (no explicit release needed for a stay
    // that's already over). A multiday mid-stay no-show would stay held.
    const newRes = await reserveItems(site.id, [i1.id, i2.id, i3.id], 'Replacement Group')
    expect(newRes).toEqual({ status: 'ok' })
  })

  // ─── 4. Cancel via one itemId cancels the entire grouped reservation ────────

  it('cancelReservation: canceling via ONE itemId of the group cancels the WHOLE reservation (all N seats freed)', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    const i1 = await createTestInventoryItem(user.id, site.id, { number: 1 })
    const i2 = await createTestInventoryItem(user.id, site.id, { number: 2 })
    const i3 = await createTestInventoryItem(user.id, site.id, { number: 3 })
    // Extra seat to verify it stays free (scope check)
    const i4 = await createTestInventoryItem(user.id, site.id, { number: 4 })
    mockUserId = user.id

    // A grouped consumer reservation (status=complete so cancelReservation finds it)
    const groupRes = await createTestReservation(user.id, site.id, [i1.id, i2.id, i3.id], {
      status: 'complete',
      operationalStatus: 'expected',
      from: new Date(new Date().setHours(0, 0, 0, 0)),
      to: new Date(new Date().setHours(23, 59, 59, 999)),
    })

    // Cancel using just ONE of the 3 item ids (i1).
    const cancelResult = await cancelReservation(site.id, i1.id)
    expect(cancelResult).toEqual({ status: 'ok' })

    // The entire reservation is now canceled (one row).
    const canceled = await prisma.reservation.findUnique({
      where: { id: groupRes.id },
    })
    expect(canceled!.status).toBe('canceled')

    // All 3 previously-grouped seats are now free — verify by rebooking all 3.
    const newRes = await reserveItems(site.id, [i1.id, i2.id, i3.id], 'Post-Cancel Group')
    expect(newRes).toEqual({ status: 'ok' })

    // i2 and i3 in particular must not be stranded / still show as occupied.
    const finalReservations = await prisma.reservation.findMany({
      where: { siteId: site.id },
      include: { items: true },
    })
    // canceled row + new walk-in row
    expect(finalReservations).toHaveLength(2)
    const newWalkIn = finalReservations.find((r) => r.status === 'paid-in-cash')!
    const newIds = newWalkIn.items.map((i) => i.id).sort()
    expect(newIds).toEqual([i1.id, i2.id, i3.id].sort())

    // i4 remains unconnected to any new reservation (scope check)
    expect(newIds).not.toContain(i4.id)
  })

  // ─── 5. Move relocates entire grouped reservation (preserves identity) ──────

  it('moveReservationToSeats: moves a grouped reservation to a same-size set of free seats (identity preserved)', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    // Original 3 seats
    const i1 = await createTestInventoryItem(user.id, site.id, { number: 1 })
    const i2 = await createTestInventoryItem(user.id, site.id, { number: 2 })
    const i3 = await createTestInventoryItem(user.id, site.id, { number: 3 })
    // Destination 3 seats (free)
    const d1 = await createTestInventoryItem(user.id, site.id, { number: 4 })
    const d2 = await createTestInventoryItem(user.id, site.id, { number: 5 })
    const d3 = await createTestInventoryItem(user.id, site.id, { number: 6 })
    mockUserId = user.id

    const today0 = new Date(new Date().setHours(0, 0, 0, 0))
    const today23 = new Date(new Date().setHours(23, 59, 59, 999))

    const groupRes = await createTestReservation(user.id, site.id, [i1.id, i2.id, i3.id], {
      status: 'complete',
      operationalStatus: 'expected',
      from: today0,
      to: today23,
      guestName: 'Moving Group',
    })

    // Move to the 3 destination seats.
    const moveResult = await moveReservationToSeats(site.id, groupRes.id, [d1.id, d2.id, d3.id])
    expect(moveResult).toEqual({ status: 'ok' })

    // Same reservation id — identity preserved.
    const updated = await prisma.reservation.findUnique({
      where: { id: groupRes.id },
      include: { items: true },
    })
    expect(updated).toBeTruthy()
    expect(updated!.guestName).toBe('Moving Group') // payment/identity preserved
    expect(updated!.status).toBe('complete')

    // Now points at the 3 destination seats.
    const newIds = updated!.items.map((i) => i.id).sort()
    expect(newIds).toEqual([d1.id, d2.id, d3.id].sort())

    // Old seats are fully free — rebooking them must succeed.
    const oldSeatRes = await reserveItems(site.id, [i1.id, i2.id, i3.id], 'Reclaimed')
    expect(oldSeatRes).toEqual({ status: 'ok' })

    // Total: original (moved) + reclaimed new walk-in.
    const allRes = await prisma.reservation.findMany({ where: { siteId: site.id } })
    expect(allRes).toHaveLength(2)
  })

  it('moveReservation: count-change move of grouped reservation — old seats freed, new seats occupied', async () => {
    // moveReservation (not ToSeats) allows changing seat count.
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    const i1 = await createTestInventoryItem(user.id, site.id, { number: 1 })
    const i2 = await createTestInventoryItem(user.id, site.id, { number: 2 })
    const i3 = await createTestInventoryItem(user.id, site.id, { number: 3 })
    const d1 = await createTestInventoryItem(user.id, site.id, { number: 4 })
    const d2 = await createTestInventoryItem(user.id, site.id, { number: 5 })
    mockUserId = user.id

    const today0 = new Date(new Date().setHours(0, 0, 0, 0))
    const today23 = new Date(new Date().setHours(23, 59, 59, 999))

    const groupRes = await createTestReservation(user.id, site.id, [i1.id, i2.id, i3.id], {
      status: 'complete',
      operationalStatus: 'expected',
      from: today0,
      to: today23,
    })

    // Move 3-seat group to 2 destination seats (count change is allowed by moveReservation).
    const moveResult = await moveReservation(site.id, groupRes.id, [d1.id, d2.id])
    expect(moveResult).toEqual({ status: 'ok' })

    const updated = await prisma.reservation.findUnique({
      where: { id: groupRes.id },
      include: { items: true },
    })
    // Reservation now covers exactly d1, d2 — old seats i1,i2,i3 are disconnected.
    const newIds = updated!.items.map((i) => i.id).sort()
    expect(newIds).toEqual([d1.id, d2.id].sort())
    expect(newIds).not.toContain(i1.id)
    expect(newIds).not.toContain(i2.id)
    expect(newIds).not.toContain(i3.id)

    // All 3 old seats are free.
    const reclaimResult = await reserveItems(site.id, [i1.id, i2.id, i3.id])
    expect(reclaimResult).toEqual({ status: 'ok' })
  })

  // ─── 6. Hold: releaseHold via one itemId — partial vs whole-group release ────
  //
  // view.tsx frees a single tapped seat with applyToPair=false (line 651). On a
  // grouped hold (N>1 items) this is PARTIAL release BY DESIGN: it frees exactly
  // the tapped seat and leaves the rest of the party held — the same single-seat
  // semantics (originally for pair partners) that let an operator release one
  // guest's bed without dropping the whole booking. The bulk "Free" path frees
  // every selected seat by calling this once per seat (the final seat deletes the
  // now-single-item row). applyToPair=true is the whole-group release. Both verified.

  it('releaseHold (applyToPair=false) on a grouped hold frees only the tapped seat; the rest stay held', async () => {
    const { site, items, reservation } = await buildGroupedHold()
    const [itemA, itemB, itemC] = items
    mockUserId = (await prisma.site.findUniqueOrThrow({ where: { id: site.id }, select: { userId: true } })).userId

    // The view.tsx single-tap path: applyToPair=false → partial release.
    const releaseResult = await releaseHold(site.id, itemA.id, undefined, false)
    expect(releaseResult).toEqual({ status: 'ok' })

    // The hold row survives, now without itemA.
    const holdRes = await prisma.reservation.findUnique({
      where: { id: reservation.id },
      include: { items: true },
    })
    expect(holdRes).not.toBeNull()
    const remainingIds = holdRes!.items.map((i) => i.id)
    expect(remainingIds).not.toContain(itemA.id)

    // itemB and itemC remain held — CORRECT: only the tapped guest's bed was freed,
    // so they stay occupied and (correctly) are not rebookable.
    expect(remainingIds).toContain(itemB.id)
    expect(remainingIds).toContain(itemC.id)
    expect((await reserveItems(site.id, [itemB.id])).status).toBe('error')

    // The freed seat A is genuinely available again — rebooking it succeeds.
    expect((await reserveItems(site.id, [itemA.id], 'Rebooked A')).status).toBe('ok')
  })

  it('releaseHold (applyToPair=true) on a grouped hold releases the WHOLE party (deletes the row)', async () => {
    const { site, items, reservation } = await buildGroupedHold()
    const [itemA, itemB, itemC] = items
    mockUserId = (await prisma.site.findUniqueOrThrow({ where: { id: site.id }, select: { userId: true } })).userId

    // applyToPair=true is the whole-group release: deletes the entire hold row.
    const releaseResult = await releaseHold(site.id, itemA.id, undefined, true)
    expect(releaseResult).toEqual({ status: 'ok' })

    // The entire hold reservation is gone.
    const holdRes = await prisma.reservation.findUnique({ where: { id: reservation.id } })
    expect(holdRes).toBeNull()

    // All 3 seats are free — rebooking all 3 must succeed.
    const rebook = await reserveItems(site.id, [itemA.id, itemB.id, itemC.id], 'After Full Release')
    expect(rebook).toEqual({ status: 'ok' })
  })

  // ─── 7. Walk-in release: unreserveItem via one itemId — partial vs whole-group ─
  //
  // Same single-seat semantics as releaseHold. view.tsx frees a tapped seat with
  // applyToPair=false (line 652); on a grouped walk-in (N>1 items) that frees just
  // that seat and leaves the rest of the party walked-in — by design. The bulk
  // "Free" path frees all selected seats one-by-one. applyToPair=true releases the
  // whole walk-in.

  it('unreserveItem (applyToPair=false) on a grouped walk-in frees only the tapped seat; the rest stay walked-in', async () => {
    const { site, items, reservation } = await buildGroupedWalkIn()
    const [itemA, itemB, itemC] = items
    mockUserId = (await prisma.site.findUniqueOrThrow({ where: { id: site.id }, select: { userId: true } })).userId

    // The view.tsx single-tap path: applyToPair=false → partial release.
    const releaseResult = await unreserveItem(site.id, itemA.id, undefined, false)
    expect(releaseResult).toEqual({ status: 'ok' })

    // The walk-in row survives, now without itemA.
    const walkInRes = await prisma.reservation.findUnique({
      where: { id: reservation.id },
      include: { items: true },
    })
    expect(walkInRes).not.toBeNull()
    const remainingIds = walkInRes!.items.map((i) => i.id)
    expect(remainingIds).not.toContain(itemA.id)

    // itemB and itemC remain walked-in — CORRECT: only the tapped seat was freed,
    // so they stay occupied and (correctly) are not rebookable.
    expect(remainingIds).toContain(itemB.id)
    expect(remainingIds).toContain(itemC.id)
    expect((await reserveItems(site.id, [itemB.id])).status).toBe('error')

    // The freed seat A is genuinely available again — rebooking it succeeds.
    expect((await reserveItems(site.id, [itemA.id], 'Rebooked A')).status).toBe('ok')
  })

  it('unreserveItem (applyToPair=true) on a grouped walk-in releases the WHOLE party (deletes the row)', async () => {
    const { site, items, reservation } = await buildGroupedWalkIn()
    const [itemA, itemB, itemC] = items
    mockUserId = (await prisma.site.findUniqueOrThrow({ where: { id: site.id }, select: { userId: true } })).userId

    // applyToPair=true deletes the whole walk-in row.
    const releaseResult = await unreserveItem(site.id, itemA.id, undefined, true)
    expect(releaseResult).toEqual({ status: 'ok' })

    // The entire walk-in reservation is gone.
    const walkInRes = await prisma.reservation.findUnique({ where: { id: reservation.id } })
    expect(walkInRes).toBeNull()

    // All 3 seats are free — rebooking all 3 must succeed.
    const rebook = await reserveItems(site.id, [itemA.id, itemB.id, itemC.id], 'After Full Unreserve')
    expect(rebook).toEqual({ status: 'ok' })
  })
})

// ---------------------------------------------------------------------------
// Bug-revealing: resolveTodayRow concurrent RSC prefetch race (P2002)
//
// Prisma upsert is SELECT-then-INSERT/UPDATE — NOT atomic. Next.js RSC prefetch
// fires the same manage page route 4× simultaneously. If two renders call
// resolveTodayRow for the same (reservationId, date) and both see "no row", both
// attempt INSERT, and the loser throws P2002. Before the fix this crashed the
// manage page render. After the fix both callers resolve to the same row id with
// no throw.
// ---------------------------------------------------------------------------

describe('resolveTodayRow — concurrent upsert race safety (P2002 fix)', () => {
  it('two concurrent calls for the same reservation+date both resolve to the SAME row id without throwing', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    const item = await createTestInventoryItem(user.id, site.id)
    mockUserId = user.id

    const reservation = await createTestReservation(user.id, site.id, [item.id], {
      status: 'complete',
      operationalStatus: 'expected',
    })

    const siteForDay = {
      timeZone: site.timeZone ?? null,
      locationLat: site.locationLat ?? null,
      locationLng: site.locationLng ?? null,
    }

    // Fire two concurrent resolveTodayRow calls for the same (reservationId, date).
    // Before the fix: the loser throws PrismaClientKnownRequestError P2002.
    // After the fix: both resolve successfully to the same row id.
    const [rowA, rowB] = await Promise.all([
      resolveTodayRow(reservation, siteForDay),
      resolveTodayRow(reservation, siteForDay),
    ])

    expect(rowA.id).toBe(rowB.id)
    expect(rowA.reservationId).toBe(reservation.id)
    expect(rowA.operationalStatus).toBe('expected')

    // Exactly one row was created in the DB — not two.
    const count = await prisma.reservationDay.count({ where: { reservationId: reservation.id } })
    expect(count).toBe(1)
  })

  it('concurrent calls for DIFFERENT reservations all succeed (no cross-contamination)', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    const itemA = await createTestInventoryItem(user.id, site.id, { number: 1 })
    const itemB = await createTestInventoryItem(user.id, site.id, { number: 2 })
    const itemC = await createTestInventoryItem(user.id, site.id, { number: 3 })
    mockUserId = user.id

    const resA = await createTestReservation(user.id, site.id, [itemA.id], { status: 'complete', operationalStatus: 'expected' })
    const resB = await createTestReservation(user.id, site.id, [itemB.id], { status: 'complete', operationalStatus: 'expected' })
    const resC = await createTestReservation(user.id, site.id, [itemC.id], { status: 'complete', operationalStatus: 'expected' })

    const siteForDay = {
      timeZone: site.timeZone ?? null,
      locationLat: site.locationLat ?? null,
      locationLng: site.locationLng ?? null,
    }

    // Simulate the manage page rendering 3 reservations concurrently — all different
    // (reservation_id, date) pairs, so no constraint collision, but must all succeed.
    const results = await Promise.all([
      resolveTodayRow(resA, siteForDay),
      resolveTodayRow(resB, siteForDay),
      resolveTodayRow(resC, siteForDay),
    ])

    expect(results[0].reservationId).toBe(resA.id)
    expect(results[1].reservationId).toBe(resB.id)
    expect(results[2].reservationId).toBe(resC.id)

    // One row per reservation — three total.
    const count = await prisma.reservationDay.count({
      where: { reservationId: { in: [resA.id, resB.id, resC.id] } },
    })
    expect(count).toBe(3)
  })
})

// ---------------------------------------------------------------------------
// convertHoldToWalkIn — single-seat split path (real DB)
// ---------------------------------------------------------------------------

describe('convertHoldToWalkIn split-seat path', () => {
  it('3-seat hold + applyToGroup=false: splits one seat off, original hold keeps 2 seats', async () => {
    // Happy-path split: a 3-seat hold exists; staff tap one seat and choose Seat scope.
    // Expected outcome:
    //   - Original hold: 2 remaining items, status still `held`
    //   - New walk-in: 1 item (the tapped seat), status `paid-in-cash`, operationalStatus `walked-in`
    const user = await createTestUser()
    const site = await createTestSite(user.id, { type: 'paid', price: 10 })
    const itemA = await createTestInventoryItem(user.id, site.id, { number: 1 })
    const itemB = await createTestInventoryItem(user.id, site.id, { number: 2 })
    const itemC = await createTestInventoryItem(user.id, site.id, { number: 3 })
    mockUserId = user.id

    // Create a 3-seat hold (today-scoped, as holdBeds produces)
    const holdRes = await createTestReservation(user.id, site.id, [itemA.id, itemB.id, itemC.id], {
      status: 'held',
      operationalStatus: 'expected',
      paymentAmount: 0,
      from: new Date(new Date().setHours(0, 0, 0, 0)),
      to: new Date(new Date().setHours(23, 59, 59, 999)),
    })

    // Split item A off as a walk-in
    const result = await convertHoldToWalkIn(site.id, itemA.id, undefined, 'Maria', undefined, undefined, false)
    expect(result).toEqual({ status: 'ok' })

    // Original hold: must still exist with 2 items (B + C) and stay `held`
    const updatedHold = await prisma.reservation.findUnique({
      where: { id: holdRes.id },
      include: { items: { orderBy: { number: 'asc' } } },
    })
    expect(updatedHold).not.toBeNull()
    expect(updatedHold!.status).toBe('held')
    expect(updatedHold!.operationalStatus).toBe('expected')
    expect(updatedHold!.items).toHaveLength(2)
    const remainingIds = updatedHold!.items.map(i => i.id).sort()
    expect(remainingIds).toEqual([itemB.id, itemC.id].sort())
    expect(remainingIds).not.toContain(itemA.id)

    // New walk-in: must exist with only item A
    const allReservations = await prisma.reservation.findMany({
      where: { siteId: site.id },
      include: { items: true },
    })
    const newWalkIn = allReservations.find(r => r.id !== holdRes.id)
    expect(newWalkIn).toBeDefined()
    expect(newWalkIn!.status).toBe('paid-in-cash')
    expect(newWalkIn!.operationalStatus).toBe('walked-in')
    expect(newWalkIn!.checkedInAt).toBeTruthy()
    expect(newWalkIn!.items).toHaveLength(1)
    expect(newWalkIn!.items[0]!.id).toBe(itemA.id)
    // guestName passed through
    expect(newWalkIn!.guestName).toBe('Maria')
  })

  it('per-seat paymentAmount: split walk-in records site price for 1 day (not all 3 seats)', async () => {
    // Site charges 10€/day. A 3-seat hold split off 1 seat should record 10€,
    // NOT 30€ (which would be the whole-hold amount).
    const user = await createTestUser()
    const site = await createTestSite(user.id, { type: 'paid', price: 10 })
    const itemA = await createTestInventoryItem(user.id, site.id, { number: 1 })
    const itemB = await createTestInventoryItem(user.id, site.id, { number: 2 })
    const itemC = await createTestInventoryItem(user.id, site.id, { number: 3 })
    mockUserId = user.id

    await createTestReservation(user.id, site.id, [itemA.id, itemB.id, itemC.id], {
      status: 'held',
      operationalStatus: 'expected',
      paymentAmount: 0,
      from: new Date(new Date().setHours(0, 0, 0, 0)),
      to: new Date(new Date().setHours(23, 59, 59, 999)),
    })

    await convertHoldToWalkIn(site.id, itemA.id, undefined, undefined, undefined, undefined, false)

    const allRes = await prisma.reservation.findMany({ where: { siteId: site.id } })
    const walkIn = allRes.find(r => r.status === 'paid-in-cash')
    expect(walkIn).toBeDefined()
    // 10€ × 1 day × 1 seat = 10
    expect(walkIn!.paymentAmount).toBe(10)
  })

  it('applyToGroup=true on a 3-seat hold whole-converts (existing Group behaviour unchanged)', async () => {
    // Regression guard: Group scope must not split — it converts the whole hold.
    const user = await createTestUser()
    const site = await createTestSite(user.id, { type: 'paid', price: 10 })
    const itemA = await createTestInventoryItem(user.id, site.id, { number: 1 })
    const itemB = await createTestInventoryItem(user.id, site.id, { number: 2 })
    const itemC = await createTestInventoryItem(user.id, site.id, { number: 3 })
    mockUserId = user.id

    const holdRes = await createTestReservation(user.id, site.id, [itemA.id, itemB.id, itemC.id], {
      status: 'held',
      operationalStatus: 'expected',
      paymentAmount: 0,
      from: new Date(new Date().setHours(0, 0, 0, 0)),
      to: new Date(new Date().setHours(23, 59, 59, 999)),
    })

    const result = await convertHoldToWalkIn(site.id, itemA.id, undefined, undefined, undefined, undefined, true)
    expect(result).toEqual({ status: 'ok' })

    // Still only ONE reservation — the original hold, now a walk-in
    const allRes = await prisma.reservation.findMany({
      where: { siteId: site.id },
      include: { items: true },
    })
    expect(allRes).toHaveLength(1)
    expect(allRes[0]!.id).toBe(holdRes.id)
    expect(allRes[0]!.status).toBe('paid-in-cash')
    expect(allRes[0]!.items).toHaveLength(3)
    // Whole-hold amount: 30€ (10€ × 3 seats × 1 day)
    expect(allRes[0]!.paymentAmount).toBe(30)
  })
})

// ---------------------------------------------------------------------------
// markDeparted — 2-of-3 subset split (bulk Depart via multiselect)
// ---------------------------------------------------------------------------

describe('markDeparted — bulk multiselect 2-of-3 subset split', () => {
  it('splits 2 selected seats into ONE new reservation, original keeps 1 — amounts conserved', async () => {
    // Scenario: 3-seat cash walk-in; operator selects 2 seats in multiselect and taps Depart.
    // Expected:
    //   - original reservation keeps 1 seat (walked-in), reduced paymentAmount
    //   - ONE new reservation with the 2 selected seats → departed (last-day)
    //   - sum of both paymentAmounts === original total
    const user = await createTestUser()
    const site = await createTestSite(user.id, { type: 'paid', price: 10 })
    const itemA = await createTestInventoryItem(user.id, site.id, { number: 1 })
    const itemB = await createTestInventoryItem(user.id, site.id, { number: 2 })
    const itemC = await createTestInventoryItem(user.id, site.id, { number: 3 })
    mockUserId = user.id

    // Today-only 3-seat walk-in (last day → subset should be departed)
    const today0 = dayjs().startOf('day').toDate()
    const today23 = dayjs().endOf('day').toDate()
    const reservation = await createTestReservation(user.id, site.id, [itemA.id, itemB.id, itemC.id], {
      from: today0,
      to: today23,
      status: 'paid-in-cash',
      operationalStatus: 'walked-in',
      checkedInAt: new Date(),
      paymentAmount: 30, // 3 × 10€ × 1 day
      employeeId: null,
    })

    // Bulk depart: select 2 seats (A + B), leave C on the original
    const result = await markDeparted(site.id, reservation.id, undefined, [itemA.id, itemB.id])
    expect(result.status).toBe('ok')

    // Original must keep only itemC
    const original = await prisma.reservation.findUnique({
      where: { id: reservation.id },
      include: { items: true },
    })
    expect(original).not.toBeNull()
    expect(original!.items).toHaveLength(1)
    expect(original!.items[0]!.id).toBe(itemC.id)
    // Original stays walked-in (not departed)
    expect(original!.operationalStatus).toBe('walked-in')
    // 1 seat × 10€ × 1 day = 10€
    expect(original!.paymentAmount).toBe(10)

    // ONE new reservation with the 2 selected seats
    const allRes = await prisma.reservation.findMany({
      where: { siteId: site.id, id: { not: reservation.id } },
      include: { items: true },
    })
    expect(allRes).toHaveLength(1)
    const newRes = allRes[0]!
    const newItemIds = newRes.items.map(i => i.id).sort()
    expect(newItemIds).toEqual([itemA.id, itemB.id].sort())
    // Last day → departed
    expect(newRes.operationalStatus).toBe('departed')
    expect(newRes.departedAt).toBeInstanceOf(Date)
    // 2 seats × 10€ × 1 day = 20€
    expect(newRes.paymentAmount).toBe(20)

    // Till conservation: original + new = 30€
    expect(original!.paymentAmount! + newRes.paymentAmount!).toBe(30)
  })

  it('attribution (employeeId, guestName) is preserved on the new subset reservation', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id, { type: 'paid', price: 10 })
    const itemA = await createTestInventoryItem(user.id, site.id, { number: 1 })
    const itemB = await createTestInventoryItem(user.id, site.id, { number: 2 })
    const itemC = await createTestInventoryItem(user.id, site.id, { number: 3 })
    mockUserId = user.id

    const account = await createTestPartnerAccount(user.id)
    const employee = await prisma.employee.create({
      data: { accountId: account.userId, name: 'Beach Staff', active: true },
    })

    const today0 = dayjs().startOf('day').toDate()
    const today23 = dayjs().endOf('day').toDate()
    const reservation = await createTestReservation(user.id, site.id, [itemA.id, itemB.id, itemC.id], {
      from: today0,
      to: today23,
      status: 'paid-in-cash',
      operationalStatus: 'walked-in',
      checkedInAt: new Date(),
      paymentAmount: 30,
      employeeId: employee.id,
      guestName: 'Alice',
    })

    await markDeparted(site.id, reservation.id, undefined, [itemA.id, itemB.id])

    const newRes = await prisma.reservation.findFirst({
      where: { siteId: site.id, id: { not: reservation.id } },
    })
    expect(newRes!.employeeId).toBe(employee.id)
    expect(newRes!.guestName).toBe('Alice')
  })
})

// ---------------------------------------------------------------------------
// convertHoldToWalkIn — 2-of-3 subset split (bulk Rent via multiselect)
// ---------------------------------------------------------------------------

describe('convertHoldToWalkIn — bulk multiselect 2-of-3 subset split', () => {
  it('splits 2 selected seats into ONE new walk-in, hold keeps 1 — amounts conserved', async () => {
    // Scenario: 3-seat hold; operator selects 2 seats in multiselect and taps Rent.
    // Expected:
    //   - hold keeps 1 seat (still held, paymentAmount stays 0)
    //   - ONE new walk-in with 2 seats (paid-in-cash, walked-in)
    //   - new walk-in paymentAmount = 2 seats × site price
    const user = await createTestUser()
    const site = await createTestSite(user.id, { type: 'paid', price: 10 })
    const itemA = await createTestInventoryItem(user.id, site.id, { number: 1 })
    const itemB = await createTestInventoryItem(user.id, site.id, { number: 2 })
    const itemC = await createTestInventoryItem(user.id, site.id, { number: 3 })
    mockUserId = user.id

    // Today-scoped 3-seat hold (as holdBeds produces)
    const holdRes = await createTestReservation(user.id, site.id, [itemA.id, itemB.id, itemC.id], {
      status: 'held',
      operationalStatus: 'expected',
      paymentAmount: 0,
      from: new Date(new Date().setHours(0, 0, 0, 0)),
      to: new Date(new Date().setHours(23, 59, 59, 999)),
    })

    // Bulk rent: select 2 seats (A + B), leave C on the hold
    const result = await convertHoldToWalkIn(
      site.id, itemA.id, undefined, 'Bob', undefined, undefined,
      false, [itemA.id, itemB.id],
    )
    expect(result.status).toBe('ok')

    // Hold must keep only itemC, still held
    const updatedHold = await prisma.reservation.findUnique({
      where: { id: holdRes.id },
      include: { items: true },
    })
    expect(updatedHold).not.toBeNull()
    expect(updatedHold!.status).toBe('held')
    expect(updatedHold!.items).toHaveLength(1)
    expect(updatedHold!.items[0]!.id).toBe(itemC.id)

    // ONE new walk-in with items A + B
    const allRes = await prisma.reservation.findMany({
      where: { siteId: site.id },
      include: { items: true },
    })
    const newWalkIn = allRes.find(r => r.id !== holdRes.id)
    expect(newWalkIn).toBeDefined()
    expect(newWalkIn!.status).toBe('paid-in-cash')
    expect(newWalkIn!.operationalStatus).toBe('walked-in')
    expect(newWalkIn!.checkedInAt).toBeTruthy()
    const walkInItemIds = newWalkIn!.items.map(i => i.id).sort()
    expect(walkInItemIds).toEqual([itemA.id, itemB.id].sort())
    expect(newWalkIn!.guestName).toBe('Bob')
    // 2 seats × 10€ × 1 day = 20€
    expect(newWalkIn!.paymentAmount).toBe(20)

    // Exactly ONE new reservation (not two separate single-seat ones)
    expect(allRes.filter(r => r.id !== holdRes.id)).toHaveLength(1)
  })

  it('subset covering all hold items: whole-convert in place (no split)', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id, { type: 'paid', price: 10 })
    const itemA = await createTestInventoryItem(user.id, site.id, { number: 1 })
    const itemB = await createTestInventoryItem(user.id, site.id, { number: 2 })
    const itemC = await createTestInventoryItem(user.id, site.id, { number: 3 })
    mockUserId = user.id

    const holdRes = await createTestReservation(user.id, site.id, [itemA.id, itemB.id, itemC.id], {
      status: 'held',
      operationalStatus: 'expected',
      paymentAmount: 0,
      from: new Date(new Date().setHours(0, 0, 0, 0)),
      to: new Date(new Date().setHours(23, 59, 59, 999)),
    })

    // Pass ALL 3 seats — should whole-convert, not split
    const result = await convertHoldToWalkIn(
      site.id, itemA.id, undefined, undefined, undefined, undefined,
      false, [itemA.id, itemB.id, itemC.id],
    )
    expect(result.status).toBe('ok')

    // Still only ONE reservation — the original hold, now a walk-in
    const allRes = await prisma.reservation.findMany({
      where: { siteId: site.id },
      include: { items: true },
    })
    expect(allRes).toHaveLength(1)
    expect(allRes[0]!.id).toBe(holdRes.id)
    expect(allRes[0]!.status).toBe('paid-in-cash')
    expect(allRes[0]!.items).toHaveLength(3)
    // 3 × 10€ × 1 day = 30€
    expect(allRes[0]!.paymentAmount).toBe(30)
  })
})

// ---------------------------------------------------------------------------
// splitWalkInSeat — real DB
// ---------------------------------------------------------------------------

describe('splitWalkInSeat', () => {
  it('3-seat cash walk-in → original keeps 2 items + reduced amount; new 1-item walked-in has per-seat amount + copied employeeId', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id, { type: 'paid', price: 10 })
    const itemA = await createTestInventoryItem(user.id, site.id, { number: 1 })
    const itemB = await createTestInventoryItem(user.id, site.id, { number: 2 })
    const itemC = await createTestInventoryItem(user.id, site.id, { number: 3 })
    mockUserId = user.id

    // Walk-in with 3 seats, 10€ each, 1 day → total 30€
    const walkIn = await createTestReservation(user.id, site.id, [itemA.id, itemB.id, itemC.id], {
      status: 'paid-in-cash',
      operationalStatus: 'walked-in',
      paymentAmount: 30,
      from: new Date(new Date().setHours(0, 0, 0, 0)),
      to: new Date(new Date().setHours(23, 59, 59, 999)),
    })

    const result = await splitWalkInSeat(site.id, walkIn.id, itemA.id)
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return

    // Original: still has 2 items, reduced paymentAmount.
    const original = await prisma.reservation.findUnique({
      where: { id: walkIn.id },
      include: { items: true },
    })
    expect(original).not.toBeNull()
    expect(original!.items).toHaveLength(2)
    const remainingIds = original!.items.map(i => i.id)
    expect(remainingIds).not.toContain(itemA.id)
    expect(remainingIds).toContain(itemB.id)
    expect(remainingIds).toContain(itemC.id)
    // 2 seats × 10€ × 1 day = 20€
    expect(original!.paymentAmount).toBe(20)
    expect(original!.operationalStatus).toBe('walked-in')

    // New: single-seat reservation pointing at itemA.
    const newRes = await prisma.reservation.findUnique({
      where: { id: result.reservationId },
      include: { items: true },
    })
    expect(newRes).not.toBeNull()
    expect(newRes!.status).toBe('paid-in-cash')
    expect(newRes!.operationalStatus).toBe('walked-in')
    expect(newRes!.items).toHaveLength(1)
    expect(newRes!.items[0]!.id).toBe(itemA.id)
    // 1 seat × 10€ × 1 day = 10€
    expect(newRes!.paymentAmount).toBe(10)
  })

  it('till total conserved: sum of original + new paymentAmount equals the original total', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id, { type: 'paid', price: 10 })
    const itemA = await createTestInventoryItem(user.id, site.id, { number: 1 })
    const itemB = await createTestInventoryItem(user.id, site.id, { number: 2 })
    const itemC = await createTestInventoryItem(user.id, site.id, { number: 3 })
    mockUserId = user.id

    const originalTotal = 30
    const walkIn = await createTestReservation(user.id, site.id, [itemA.id, itemB.id, itemC.id], {
      status: 'paid-in-cash',
      operationalStatus: 'walked-in',
      paymentAmount: originalTotal,
      from: new Date(new Date().setHours(0, 0, 0, 0)),
      to: new Date(new Date().setHours(23, 59, 59, 999)),
    })

    const result = await splitWalkInSeat(site.id, walkIn.id, itemA.id)
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return

    const original = await prisma.reservation.findUnique({ where: { id: walkIn.id } })
    const newRes = await prisma.reservation.findUnique({ where: { id: result.reservationId } })

    // Till conservation invariant: sum across both equals the original total.
    expect((original!.paymentAmount ?? 0) + (newRes!.paymentAmount ?? 0)).toBe(originalTotal)
  })
})

// ---------------------------------------------------------------------------
// unreserveItem disconnect: till conservation (real DB)
// ---------------------------------------------------------------------------

describe('unreserveItem disconnect — till conservation', () => {
  it('disconnecting one seat of a 3-seat walk-in reduces paymentAmount to the remaining 2 seats share', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id, { type: 'paid', price: 10 })
    const itemA = await createTestInventoryItem(user.id, site.id, { number: 1 })
    const itemB = await createTestInventoryItem(user.id, site.id, { number: 2 })
    const itemC = await createTestInventoryItem(user.id, site.id, { number: 3 })
    mockUserId = user.id

    // 3-seat walk-in, 10€ each, 1 day → 30€
    const walkIn = await createTestReservation(user.id, site.id, [itemA.id, itemB.id, itemC.id], {
      status: 'paid-in-cash',
      operationalStatus: 'walked-in',
      paymentAmount: 30,
      from: new Date(new Date().setHours(0, 0, 0, 0)),
      to: new Date(new Date().setHours(23, 59, 59, 999)),
    })

    // Unreserve one seat (Seat mode).
    const result = await unreserveItem(site.id, itemA.id, undefined, false)
    expect(result).toEqual({ status: 'ok' })

    // Original reservation survives with 2 items and reduced paymentAmount.
    const remaining = await prisma.reservation.findUnique({
      where: { id: walkIn.id },
      include: { items: true },
    })
    expect(remaining).not.toBeNull()
    expect(remaining!.items).toHaveLength(2)
    expect(remaining!.items.map(i => i.id)).not.toContain(itemA.id)
    // 2 seats × 10€ × 1 day = 20€ (freed seat's 10€ leaves the till)
    expect(remaining!.paymentAmount).toBe(20)
  })
})

// ─── blockBeds: grouped block (track 011 Block/Comp parity) ─────────────────

describe('blockBeds — grouped block', () => {
  it('creates ONE blocked reservation with all 3 selected items', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    const itemA = await createTestInventoryItem(user.id, site.id, { number: 1 })
    const itemB = await createTestInventoryItem(user.id, site.id, { number: 2 })
    const itemC = await createTestInventoryItem(user.id, site.id, { number: 3 })
    mockUserId = user.id

    const result = await blockBeds(site.id, [itemA.id, itemB.id, itemC.id], 'VIP area')
    expect(result).toEqual({ status: 'ok' })

    const reservations = await prisma.reservation.findMany({
      where: { siteId: site.id },
      include: { items: true },
    })
    // Exactly ONE reservation
    expect(reservations).toHaveLength(1)

    const res = reservations[0]!
    expect(res.operationalStatus).toBe('blocked')
    expect(res.status).toBe('paid-in-cash')
    expect(res.items).toHaveLength(3)
    expect(res.items.map(i => i.id).sort()).toEqual([itemA.id, itemB.id, itemC.id].sort())
    // Sticky: far-future `to`
    const fiveYearsFromNow = new Date(Date.now() + 5 * 365 * 24 * 60 * 60 * 1000)
    expect(res.to.getTime()).toBeGreaterThan(fiveYearsFromNow.getTime())
    // Notes stored
    expect(res.internalNotes).toBe('VIP area')
  })

  it('unblock ONE seat (applyToGroup=false) leaves the other 2 still blocked', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    const itemA = await createTestInventoryItem(user.id, site.id, { number: 1 })
    const itemB = await createTestInventoryItem(user.id, site.id, { number: 2 })
    const itemC = await createTestInventoryItem(user.id, site.id, { number: 3 })
    mockUserId = user.id

    await blockBeds(site.id, [itemA.id, itemB.id, itemC.id])

    // Peel off itemA only (Seat mode → applyToGroup=false).
    const unblockResult = await unblockBed(site.id, itemA.id, undefined, false)
    expect(unblockResult).toEqual({ status: 'ok' })

    const reservations = await prisma.reservation.findMany({
      where: { siteId: site.id },
      include: { items: true },
    })
    // ONE block reservation still exists (itemB + itemC remain blocked)
    expect(reservations).toHaveLength(1)
    const remaining = reservations[0]!
    expect(remaining.operationalStatus).toBe('blocked')
    expect(remaining.items).toHaveLength(2)
    expect(remaining.items.map(i => i.id)).not.toContain(itemA.id)
    expect(remaining.items.map(i => i.id).sort()).toEqual([itemB.id, itemC.id].sort())

    // itemA is now free — can be reserved
    const newRes = await reserveItem(site.id, itemA.id, 'Guest After Partial Unblock')
    expect(newRes).toEqual({ status: 'ok' })
  })

  it('conflict on one taken seat → nothing created (all-or-nothing)', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    const itemA = await createTestInventoryItem(user.id, site.id, { number: 1 })
    const itemB = await createTestInventoryItem(user.id, site.id, { number: 2 })
    const itemC = await createTestInventoryItem(user.id, site.id, { number: 3 })
    mockUserId = user.id

    // itemB is already occupied
    await reserveItem(site.id, itemB.id, 'Occupant')

    const result = await blockBeds(site.id, [itemA.id, itemB.id, itemC.id])
    expect(result.status).toBe('error')
    expect(result.errors?.[0]).toMatch(/already occupied or blocked/i)

    // No block reservation was created
    const blockReservations = await prisma.reservation.findMany({
      where: { siteId: site.id, operationalStatus: 'blocked' },
    })
    expect(blockReservations).toHaveLength(0)
  })
})

// ─── compBeds: grouped comp (track 011 Block/Comp parity) ────────────────────

describe('compBeds — grouped comp', () => {
  it('creates ONE comp reservation with all 3 selected items', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    const itemA = await createTestInventoryItem(user.id, site.id, { number: 1 })
    const itemB = await createTestInventoryItem(user.id, site.id, { number: 2 })
    const itemC = await createTestInventoryItem(user.id, site.id, { number: 3 })
    mockUserId = user.id

    const result = await compBeds(site.id, [itemA.id, itemB.id, itemC.id], undefined, 'VIP Guest')
    expect(result).toEqual({ status: 'ok' })

    const reservations = await prisma.reservation.findMany({
      where: { siteId: site.id },
      include: { items: true },
    })
    // Exactly ONE reservation
    expect(reservations).toHaveLength(1)

    const res = reservations[0]!
    expect(res.operationalStatus).toBe('comp')
    expect(res.status).toBe('paid-in-cash')
    expect(res.isComp).toBe(true)
    expect(res.paymentAmount).toBe(0)
    expect(res.guestName).toBe('VIP Guest')
    expect(res.items).toHaveLength(3)
    expect(res.items.map(i => i.id).sort()).toEqual([itemA.id, itemB.id, itemC.id].sort())
    // Today-only window (not sticky)
    const endOfToday = new Date(new Date().setHours(23, 59, 59, 999))
    expect(res.to.getTime()).toBeLessThanOrEqual(endOfToday.getTime() + 1000)
  })

  it('uncomp ONE seat (applyToGroup=false) leaves the other 2 still comped', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    const itemA = await createTestInventoryItem(user.id, site.id, { number: 1 })
    const itemB = await createTestInventoryItem(user.id, site.id, { number: 2 })
    const itemC = await createTestInventoryItem(user.id, site.id, { number: 3 })
    mockUserId = user.id

    await compBeds(site.id, [itemA.id, itemB.id, itemC.id], undefined, 'Party of 3')

    // Peel off itemA only (Seat mode → applyToGroup=false).
    const uncompResult = await uncompBed(site.id, itemA.id, undefined, false)
    expect(uncompResult).toEqual({ status: 'ok' })

    const reservations = await prisma.reservation.findMany({
      where: { siteId: site.id },
      include: { items: true },
    })
    // ONE comp reservation still exists (itemB + itemC remain comped)
    expect(reservations).toHaveLength(1)
    const remaining = reservations[0]!
    expect(remaining.operationalStatus).toBe('comp')
    expect(remaining.items).toHaveLength(2)
    expect(remaining.items.map(i => i.id)).not.toContain(itemA.id)
    expect(remaining.items.map(i => i.id).sort()).toEqual([itemB.id, itemC.id].sort())

    // itemA is now free — can be reserved
    const newRes = await reserveItem(site.id, itemA.id, 'Guest After Partial Uncomp')
    expect(newRes).toEqual({ status: 'ok' })
  })

  it('conflict on one taken seat → nothing created (all-or-nothing)', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    const itemA = await createTestInventoryItem(user.id, site.id, { number: 1 })
    const itemB = await createTestInventoryItem(user.id, site.id, { number: 2 })
    const itemC = await createTestInventoryItem(user.id, site.id, { number: 3 })
    mockUserId = user.id

    // itemB is already occupied
    await reserveItem(site.id, itemB.id, 'Occupant')

    const result = await compBeds(site.id, [itemA.id, itemB.id, itemC.id])
    expect(result.status).toBe('error')
    expect(result.errors?.[0]).toMatch(/already occupied or blocked/i)

    // No comp reservation was created
    const compReservations = await prisma.reservation.findMany({
      where: { siteId: site.id, operationalStatus: 'comp' },
    })
    expect(compReservations).toHaveLength(0)
  })
})
