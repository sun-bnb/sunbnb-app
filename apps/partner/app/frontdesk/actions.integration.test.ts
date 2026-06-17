/**
 * Integration test for app/frontdesk/actions.ts — searchAllReservations
 *
 * Purpose: prove the cross-partner data-isolation property that a unit mock
 * cannot give. A mocked prisma.reservation.findMany accepts whatever siteIds
 * we inject; only a real Postgres query proves that the WHERE siteId: { in: siteIds }
 * clause actually excludes another partner's reservations.
 *
 * Requires local sunbnb_test DB (npm run test:integration).
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import { cleanDatabase, disconnectDatabase, prisma } from '@/app/test/setup'
import {
  createTestUser,
  createTestSite,
  createTestInventoryItem,
  createTestReservation,
  createTestRentalItem,
  createTestRentalBooking,
} from '@/app/test/fixtures'

// ---------------------------------------------------------------------------
// Mocks — only auth and next/cache.  Real Prisma client used against sunbnb_test.
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

import { searchAllReservations } from './actions'

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
// Cross-partner data-isolation proof
// ---------------------------------------------------------------------------

describe('searchAllReservations — data isolation', () => {
  it('returns only owner reservations even when another partner has a matching reservation', async () => {
    // Setup owner
    const owner = await createTestUser()
    const ownerSite = await createTestSite(owner.id)
    const ownerItem = await createTestInventoryItem(owner.id, ownerSite.id)

    // Setup other partner — separate user with separate site
    const other = await createTestUser()
    const otherSite = await createTestSite(other.id)
    const otherItem = await createTestInventoryItem(other.id, otherSite.id)

    // Both reservations match the search term (same guestName)
    await createTestReservation(owner.id, ownerSite.id, [ownerItem.id], {
      guestName: 'IsolationTestGuest',
      status: 'complete',
    })
    await createTestReservation(other.id, otherSite.id, [otherItem.id], {
      guestName: 'IsolationTestGuest', // same — would match query
      status: 'complete',
    })

    // Authenticate as owner and search
    mockUserId = owner.id
    const result = await searchAllReservations('IsolationTestGuest')

    // Only the owner's reservation must be returned — not the other partner's
    expect(result.sunbedReservations).toHaveLength(1)
    expect(result.sunbedReservations[0].siteId).toBe(ownerSite.id)

    // Sanity: if both were returned, this would catch the leak
    const returnedSiteIds = result.sunbedReservations.map((r) => r.siteId)
    expect(returnedSiteIds).not.toContain(otherSite.id)
  })

  it('returns only owner rental bookings even when another partner has a matching booking', async () => {
    const owner = await createTestUser()
    const ownerSite = await createTestSite(owner.id)
    const ownerRentalItem = await createTestRentalItem(ownerSite.id)

    const other = await createTestUser()
    const otherSite = await createTestSite(other.id)
    const otherRentalItem = await createTestRentalItem(otherSite.id)

    // Both rental bookings have the same guestName — both would match the query
    await createTestRentalBooking(owner.id, ownerSite.id, ownerRentalItem.id, {
      guestName: 'RentalIsolationGuest',
      status: 'complete',
      operationalStatus: 'reserved',
    })
    await createTestRentalBooking(other.id, otherSite.id, otherRentalItem.id, {
      guestName: 'RentalIsolationGuest',
      status: 'complete',
      operationalStatus: 'reserved',
    })

    mockUserId = owner.id
    const result = await searchAllReservations('RentalIsolationGuest')

    expect(result.rentalBookings).toHaveLength(1)
    expect(result.rentalBookings[0].siteId).toBe(ownerSite.id)

    const returnedSiteIds = result.rentalBookings.map((r) => r.siteId)
    expect(returnedSiteIds).not.toContain(otherSite.id)
  })

  it('returns reservations from all owner sites (multi-site partner)', async () => {
    const owner = await createTestUser()
    const site1 = await createTestSite(owner.id, { name: 'Beach A' })
    const site2 = await createTestSite(owner.id, { name: 'Beach B' })
    const item1 = await createTestInventoryItem(owner.id, site1.id)
    const item2 = await createTestInventoryItem(owner.id, site2.id)

    await createTestReservation(owner.id, site1.id, [item1.id], {
      guestName: 'MultiSiteGuest',
      status: 'complete',
    })
    await createTestReservation(owner.id, site2.id, [item2.id], {
      guestName: 'MultiSiteGuest',
      status: 'complete',
    })

    mockUserId = owner.id
    const result = await searchAllReservations('MultiSiteGuest')

    // Both sites belong to the same owner — both reservations must be returned
    expect(result.sunbedReservations).toHaveLength(2)
    const returnedSiteIds = result.sunbedReservations.map((r) => r.siteId)
    expect(returnedSiteIds).toContain(site1.id)
    expect(returnedSiteIds).toContain(site2.id)
  })

  it('returns empty results when unauthenticated (no session)', async () => {
    const owner = await createTestUser()
    const site = await createTestSite(owner.id)
    const item = await createTestInventoryItem(owner.id, site.id)
    await createTestReservation(owner.id, site.id, [item.id], {
      guestName: 'UnauthGuest',
      status: 'complete',
    })

    // mockUserId stays null — unauthenticated
    const result = await searchAllReservations('UnauthGuest')
    expect(result.sunbedReservations).toHaveLength(0)
    expect(result.rentalBookings).toHaveLength(0)
  })

  it('excludes canceled reservations from search results', async () => {
    const owner = await createTestUser()
    const site = await createTestSite(owner.id)
    const item = await createTestInventoryItem(owner.id, site.id)

    // Create both an active and a canceled reservation matching the query
    await createTestReservation(owner.id, site.id, [item.id], {
      guestName: 'CancelFilterGuest',
      status: 'complete',
    })
    await createTestReservation(owner.id, site.id, [item.id], {
      guestName: 'CancelFilterGuest',
      status: 'canceled',
    })

    mockUserId = owner.id
    const result = await searchAllReservations('CancelFilterGuest')

    // Only the non-canceled reservation should be returned
    expect(result.sunbedReservations).toHaveLength(1)
    expect(result.sunbedReservations[0].status).not.toBe('canceled')
  })
})
