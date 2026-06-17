/**
 * Integration tests for rentals/actions.ts — requires the real sunbnb_test DB.
 *
 * Scope: deleteRentalItem active-booking guard and getRentalItems booking-count aggregate.
 *
 * The auth dimension is covered by the unit auth-matrix; these tests mock only
 * auth + next/cache so that all DB logic runs against real Postgres.
 *
 * deleteRentalItem now checks for active bookings before deleting: if any
 * RentalBooking for the item exists (complete, pending, etc.), the action returns
 * { status: 'error' } and leaves the booking rows intact. These tests guard against
 * that guard being removed — if the guard disappears, the schema's onDelete:Cascade
 * would silently wipe bookings and the tests would fail.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import { cleanDatabase, disconnectDatabase, prisma } from '@/app/test/setup'
import {
  createTestUser,
  createTestSite,
  createTestRentalItem,
  createTestRentalBooking,
} from '@/app/test/fixtures'
import { RENTAL_COMPLETE, RENTAL_PENDING } from '@repo/data/reservation-status'

// ---------------------------------------------------------------------------
// Mocks — only auth and next/cache; all DB access runs against real Postgres.
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
// Import actions AFTER mocks are declared (hoisting safety)
// ---------------------------------------------------------------------------

import { deleteRentalItem, getRentalItems } from './actions'

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

// ═══════════════════════════════════════════════════════════════════════════════
// deleteRentalItem — BUG-REVEALING: active-booking guard
// ═══════════════════════════════════════════════════════════════════════════════

describe('deleteRentalItem — active booking guard', () => {
  /**
   * deleteRentalItem counts existing bookings before deleting. If any booking
   * exists (complete, pending, etc.), it returns { status: 'error' } so booking
   * history is never silently cascade-deleted. These tests are regression guards:
   * if the booking check is removed, the schema's onDelete:Cascade would delete
   * all associated RentalBooking rows and the tests would fail.
   */
  it('should reject deleting a rental item that has an active (complete) booking', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    const item = await createTestRentalItem(site.id)
    const booking = await createTestRentalBooking(user.id, site.id, item.id, {
      status: RENTAL_COMPLETE,
    })
    mockUserId = user.id

    const result = await deleteRentalItem(site.id, item.id)

    // CORRECT behaviour: action must refuse to delete when active bookings exist
    expect(result.status).toBe('error')
    // Booking rows must still exist — not cascade-deleted
    const survivingBooking = await prisma.rentalBooking.findUnique({ where: { id: booking.id } })
    expect(survivingBooking).not.toBeNull()
  })

  it('should reject deleting a rental item with a pending booking', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    const item = await createTestRentalItem(site.id)
    const booking = await createTestRentalBooking(user.id, site.id, item.id, {
      status: RENTAL_PENDING,
    })
    mockUserId = user.id

    const result = await deleteRentalItem(site.id, item.id)

    // CORRECT behaviour: pending bookings are in-flight — must not be orphaned
    expect(result.status).toBe('error')
    const survivingBooking = await prisma.rentalBooking.findUnique({ where: { id: booking.id } })
    expect(survivingBooking).not.toBeNull()
  })

  it('succeeds when there are NO bookings for the item', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    const item = await createTestRentalItem(site.id)
    mockUserId = user.id

    // No bookings created — safe to delete
    const result = await deleteRentalItem(site.id, item.id)
    expect(result.status).toBe('ok')

    // Item must no longer exist in the DB
    const gone = await prisma.rentalItem.findUnique({ where: { id: item.id } })
    expect(gone).toBeNull()
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// getRentalItems — booking count aggregate (integration: needs real COUNT)
// ═══════════════════════════════════════════════════════════════════════════════

describe('getRentalItems — booking count', () => {
  it('returns items with the correct _count.bookings from real DB aggregation', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    const itemA = await createTestRentalItem(site.id, { name: 'Kayak' })
    const itemB = await createTestRentalItem(site.id, { name: 'Paddleboard' })

    // Create 2 bookings for itemA, 0 for itemB
    await createTestRentalBooking(user.id, site.id, itemA.id)
    await createTestRentalBooking(user.id, site.id, itemA.id)
    mockUserId = user.id

    const res = await getRentalItems(site.id)
    expect(res.status).toBe('ok')
    const items = (res as any).items as Array<{ id: string; _count: { bookings: number } }>

    const kayak = items.find((i) => i.id === itemA.id)
    const paddle = items.find((i) => i.id === itemB.id)

    expect(kayak?._count.bookings).toBe(2)
    expect(paddle?._count.bookings).toBe(0)
  })

  it('returns items ordered by createdAt ascending', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    // Create items with a tiny delay via sequence (timestamps differ by counter)
    const itemA = await createTestRentalItem(site.id, { name: 'First' })
    const itemB = await createTestRentalItem(site.id, { name: 'Second' })
    mockUserId = user.id

    const res = await getRentalItems(site.id)
    expect(res.status).toBe('ok')
    const items = (res as any).items as Array<{ id: string }>
    const ids = items.map((i) => i.id)

    // itemA was created first, so it must appear before itemB
    expect(ids.indexOf(itemA.id)).toBeLessThan(ids.indexOf(itemB.id))
  })
})
