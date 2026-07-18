/**
 * Integration tests for siteService.searchSites and availabilityService.countAvailableToday.
 *
 * These tests encode the agreed availability semantics:
 *   - item_count: active items only (not inactive or new)
 *   - available_count: active items not blocked by a BLOCKING_STATUS reservation
 *     overlapping today, minus the no-show/departed release rule.
 *
 * Run via: npm run test:integration (requires sunbnb_test DB running locally)
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { searchSites } from './siteService'
import { countAvailableToday } from './availabilityService'
import { cleanDatabase, disconnectDatabase, prisma } from '@/app/test/setup'
import {
  createTestUser,
  createTestSite,
  createTestInventoryItem,
  createTestReservation,
} from '@/app/test/fixtures'
import { BLOCKING_STATUSES, OP_NO_SHOW, OP_DEPARTED } from '@repo/data/reservation-status'

// A non-blocking status (canceled) for contrast
const CANCELED = 'canceled'

beforeEach(async () => {
  await cleanDatabase()
})

afterAll(async () => {
  await disconnectDatabase()
})

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function createReadySite(user: Awaited<ReturnType<typeof createTestUser>>) {
  // searchSites requires: active status, name, location not 0, at least one active item,
  // at least one working hours entry, an image, and either non-paid type or price+vat set.
  const site = await createTestSite(user.id, {
    name: 'Test Beach',
    status: 'active',
    image: 'https://example.com/img.jpg',
    type: 'free',
    locationLat: '36.7',
    locationLng: '3.0',
    features: ['sunbeds'],
  })
  // Add a working hours entry so the site passes the WHERE filter
  await prisma.siteWorkingHours.create({
    data: {
      siteId: site.id,
      day: 1,
      openTime: new Date('1970-01-01T08:00:00Z'),
      closeTime: new Date('1970-01-01T20:00:00Z'),
    },
  })
  return site
}

// today's bounds (server-local)
function todayBounds() {
  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)
  const endOfToday = new Date()
  endOfToday.setHours(23, 59, 59, 999)
  return { startOfToday, endOfToday }
}

// ─── searchSites: item_count semantics ────────────────────────────────────────

describe('searchSites item_count — active items only', () => {
  it('counts only active inventory items', async () => {
    const user = await createTestUser()
    const site = await createReadySite(user)

    // 2 active, 1 inactive, 1 new
    await createTestInventoryItem(user.id, site.id, { number: 1, status: 'active' })
    await createTestInventoryItem(user.id, site.id, { number: 2, status: 'active' })
    await createTestInventoryItem(user.id, site.id, { number: 3, status: 'inactive' })
    await createTestInventoryItem(user.id, site.id, { number: 4, status: 'new' })

    const { sites } = await searchSites()
    const result = sites.find(s => s.id === site.id)
    expect(result).toBeDefined()
    expect(result!.itemCount).toBe(2)
  })
})

// ─── searchSites: available_count semantics ───────────────────────────────────

describe('searchSites available_count — canonical blocking rule', () => {
  it('counts all active items as available when no reservations exist', async () => {
    const user = await createTestUser()
    const site = await createReadySite(user)

    await createTestInventoryItem(user.id, site.id, { number: 1, status: 'active' })
    await createTestInventoryItem(user.id, site.id, { number: 2, status: 'active' })

    const { sites } = await searchSites()
    const result = sites.find(s => s.id === site.id)
    expect(result!.availableCount).toBe(2)
    expect(result!.itemCount).toBe(2)
  })

  it('blocks items with a reservation in a blocking status overlapping today', async () => {
    const user = await createTestUser()
    const site = await createReadySite(user)

    const item1 = await createTestInventoryItem(user.id, site.id, { number: 1, status: 'active' })
    const item2 = await createTestInventoryItem(user.id, site.id, { number: 2, status: 'active' })

    const { startOfToday, endOfToday } = todayBounds()

    // item1 is blocked by a complete reservation spanning today
    await createTestReservation(user.id, site.id, [item1.id], {
      status: 'complete',
      from: startOfToday,
      to: endOfToday,
    })

    const { sites } = await searchSites()
    const result = sites.find(s => s.id === site.id)
    // item1 blocked, item2 free
    expect(result!.availableCount).toBe(1)
    expect(result!.itemCount).toBe(2)
  })

  it('does NOT block items when reservation status is canceled (non-blocking)', async () => {
    const user = await createTestUser()
    const site = await createReadySite(user)

    const item = await createTestInventoryItem(user.id, site.id, { number: 1, status: 'active' })

    const { startOfToday, endOfToday } = todayBounds()

    await createTestReservation(user.id, site.id, [item.id], {
      status: CANCELED,
      from: startOfToday,
      to: endOfToday,
    })

    const { sites } = await searchSites()
    const result = sites.find(s => s.id === site.id)
    // canceled is not in BLOCKING_STATUSES — item should be free
    expect(result!.availableCount).toBe(1)
  })

  it('does NOT block items when reservation status is refunded (non-blocking)', async () => {
    const user = await createTestUser()
    const site = await createReadySite(user)

    const item = await createTestInventoryItem(user.id, site.id, { number: 1, status: 'active' })

    const { startOfToday, endOfToday } = todayBounds()

    await createTestReservation(user.id, site.id, [item.id], {
      status: 'refunded',
      from: startOfToday,
      to: endOfToday,
    })

    const { sites } = await searchSites()
    const result = sites.find(s => s.id === site.id)
    expect(result!.availableCount).toBe(1)
  })

  it('does NOT block items for reservations that do not overlap today', async () => {
    const user = await createTestUser()
    const site = await createReadySite(user)

    const item = await createTestInventoryItem(user.id, site.id, { number: 1, status: 'active' })

    // A past reservation (ended yesterday) — blocking status but not overlapping today
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    yesterday.setHours(0, 0, 0, 0)
    const yesterdayEnd = new Date()
    yesterdayEnd.setDate(yesterdayEnd.getDate() - 1)
    yesterdayEnd.setHours(23, 59, 59, 999)

    await createTestReservation(user.id, site.id, [item.id], {
      status: 'complete',
      from: yesterday,
      to: yesterdayEnd,
    })

    const { sites } = await searchSites()
    const result = sites.find(s => s.id === site.id)
    // Past reservation should not block today
    expect(result!.availableCount).toBe(1)
  })

  it('releases no-show reservation whose end date is on or before end of today', async () => {
    const user = await createTestUser()
    const site = await createReadySite(user)

    const item = await createTestInventoryItem(user.id, site.id, { number: 1, status: 'active' })

    const { startOfToday, endOfToday } = todayBounds()

    // Blocking status + no-show operational status + ended today = released
    await createTestReservation(user.id, site.id, [item.id], {
      status: 'complete',
      operationalStatus: OP_NO_SHOW,
      from: startOfToday,
      to: endOfToday,
    })

    const { sites } = await searchSites()
    const result = sites.find(s => s.id === site.id)
    // No-show ended today — bed freed by the release rule
    expect(result!.availableCount).toBe(1)
  })

  it('releases departed reservation whose end date is on or before end of today', async () => {
    const user = await createTestUser()
    const site = await createReadySite(user)

    const item = await createTestInventoryItem(user.id, site.id, { number: 1, status: 'active' })

    const { startOfToday, endOfToday } = todayBounds()

    await createTestReservation(user.id, site.id, [item.id], {
      status: 'complete',
      operationalStatus: OP_DEPARTED,
      from: startOfToday,
      to: endOfToday,
    })

    const { sites } = await searchSites()
    const result = sites.find(s => s.id === site.id)
    expect(result!.availableCount).toBe(1)
  })

  it('does NOT release no-show reservation with future end date (multiday stay with remaining days)', async () => {
    const user = await createTestUser()
    const site = await createReadySite(user)

    const item = await createTestInventoryItem(user.id, site.id, { number: 1, status: 'active' })

    const { startOfToday } = todayBounds()
    const future = new Date()
    future.setDate(future.getDate() + 2)
    future.setHours(23, 59, 59, 999)

    // No-show but multi-day stay ends in the future — bed stays blocked
    await createTestReservation(user.id, site.id, [item.id], {
      status: 'complete',
      operationalStatus: OP_NO_SHOW,
      from: startOfToday,
      to: future,
    })

    const { sites } = await searchSites()
    const result = sites.find(s => s.id === site.id)
    // Release condition not met (to > endOfToday) — bed still blocked
    expect(result!.availableCount).toBe(0)
  })

  it('does NOT count inactive items as blocking or available', async () => {
    const user = await createTestUser()
    const site = await createReadySite(user)

    const activeItem = await createTestInventoryItem(user.id, site.id, { number: 1, status: 'active' })
    const inactiveItem = await createTestInventoryItem(user.id, site.id, { number: 2, status: 'inactive' })

    const { startOfToday, endOfToday } = todayBounds()

    // Reservation on the inactive item — should have no effect on counts
    await createTestReservation(user.id, site.id, [inactiveItem.id], {
      status: 'complete',
      from: startOfToday,
      to: endOfToday,
    })

    const { sites } = await searchSites()
    const result = sites.find(s => s.id === site.id)
    // Only 1 active item; no reservation on it
    expect(result!.itemCount).toBe(1)
    expect(result!.availableCount).toBe(1)
  })

  it('includes features in the search result', async () => {
    const user = await createTestUser()
    const site = await createReadySite(user)
    await createTestInventoryItem(user.id, site.id, { number: 1, status: 'active' })

    const { sites } = await searchSites()
    const result = sites.find(s => s.id === site.id)
    expect(result!.features).toEqual(['sunbeds'])
  })
})

// ─── countAvailableToday ──────────────────────────────────────────────────────

describe('countAvailableToday', () => {
  it('returns itemCount = active items and availableCount = unblocked items', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)

    const item1 = await createTestInventoryItem(user.id, site.id, { number: 1, status: 'active' })
    const item2 = await createTestInventoryItem(user.id, site.id, { number: 2, status: 'active' })
    await createTestInventoryItem(user.id, site.id, { number: 3, status: 'inactive' })

    const { startOfToday, endOfToday } = todayBounds()

    // Block item1 with a blocking reservation today
    await createTestReservation(user.id, site.id, [item1.id], {
      status: 'complete',
      from: startOfToday,
      to: endOfToday,
    })

    const result = await countAvailableToday(site.id)
    // 2 active items, 1 blocked = 1 available
    expect(result.itemCount).toBe(2)
    expect(result.availableCount).toBe(1)
  })

  it('returns itemCount = 0 and availableCount = 0 for a site with no active items', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)

    const result = await countAvailableToday(site.id)
    expect(result.itemCount).toBe(0)
    expect(result.availableCount).toBe(0)
  })

  it('respects the no-show/departed release rule', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)

    const item = await createTestInventoryItem(user.id, site.id, { number: 1, status: 'active' })

    const { startOfToday, endOfToday } = todayBounds()

    // No-show ended today — should be released
    await createTestReservation(user.id, site.id, [item.id], {
      status: 'complete',
      operationalStatus: OP_NO_SHOW,
      from: startOfToday,
      to: endOfToday,
    })

    const result = await countAvailableToday(site.id)
    expect(result.availableCount).toBe(1)
  })
})
