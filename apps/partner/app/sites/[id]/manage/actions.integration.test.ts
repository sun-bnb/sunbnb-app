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
  blockBed,
  unblockBed,
  holdBeds,
  markRentalPickedUp,
  markRentalReturned,
  createWalkInRental,
  getTillStatus,
  closeTill,
  findReservations,
} from './actions'

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
