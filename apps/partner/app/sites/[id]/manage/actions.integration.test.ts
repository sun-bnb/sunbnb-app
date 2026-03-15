import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import { cleanDatabase, disconnectDatabase, prisma } from '@/app/test/setup'
import {
  createTestUser,
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
  unreserveItem,
  checkInReservation,
  markDeparted,
  markNoShow,
  moveReservation,
  blockBed,
  unblockBed,
  markRentalPickedUp,
  markRentalReturned,
  createWalkInRental,
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
    expect(result.errors![0]).toContain('1')
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
