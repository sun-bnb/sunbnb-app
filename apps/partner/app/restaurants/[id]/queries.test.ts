/**
 * Unit tests for app/restaurants/[id]/queries.ts — 6 read functions.
 *
 * Requirements-driven / bug-revealing:
 *   - Ownership guard (requireRestaurantOwner) is the critical gate; the real
 *     lib/auth-helpers.ts code runs (it is NOT mocked), exercising the actual
 *     auth() + prisma.user.findUnique + prisma.restaurant.findUnique path.
 *   - Every function returns null on unauthenticated and on non-owner calls
 *     WITHOUT calling any @repo/table-reservations-core function — verified via
 *     the mock spy not-called assertions.
 *   - Happy-path tests assert correct data shape / argument forwarding.
 *
 * Mocking strategy:
 *   @repo/table-reservations-core — fully mocked; stub return values per test.
 *   @repo/data/PrismaCient        — aliased to __mocks__ by vitest.config.ts.
 *   @/app/auth                    — mocked so auth() can be controlled.
 *   lib/auth-helpers.ts           — intentionally NOT mocked; real code runs.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/auth', () => ({ auth: vi.fn() }))

// Fully mock @repo/table-reservations-core; only the functions used by queries.ts.
vi.mock('@repo/table-reservations-core', () => ({
  getRestaurantById: vi.fn(),
  listTablesForRestaurant: vi.fn(),
  listLayoutElementsForRestaurant: vi.fn(),
  listMenuItemsForRestaurant: vi.fn(),
  listShiftsForRestaurant: vi.fn(),
  listCombinationsForRestaurant: vi.fn(),
  listWaitlistForRestaurant: vi.fn(),
}))

import prisma from '@repo/data/PrismaCient'
import { auth } from '@/app/auth'
import {
  getRestaurantById,
  listTablesForRestaurant,
  listLayoutElementsForRestaurant,
  listMenuItemsForRestaurant,
  listShiftsForRestaurant,
  listCombinationsForRestaurant,
  listWaitlistForRestaurant,
} from '@repo/table-reservations-core'
import {
  getRestaurant,
  getRestaurantShifts,
  getRestaurantCombinations,
  getRestaurantWaitlist,
  getRestaurantLayout,
  getRestaurantMenu,
} from './queries'

const mockAuth = vi.mocked(auth)
const mockGetRestaurantById = vi.mocked(getRestaurantById)
const mockListShifts = vi.mocked(listShiftsForRestaurant)
const mockListCombinations = vi.mocked(listCombinationsForRestaurant)
const mockListWaitlist = vi.mocked(listWaitlistForRestaurant)
const mockListTables = vi.mocked(listTablesForRestaurant)
const mockListElements = vi.mocked(listLayoutElementsForRestaurant)
const mockListMenuItems = vi.mocked(listMenuItemsForRestaurant)

const RESTAURANT_ID = 'restaurant-1'
const OWNER_ID = 'user-1'

// A minimal RestaurantRecord as returned by getRestaurantById (includes
// partnerAccountId and workingHour ids — both stripped by getRestaurant()).
const RESTAURANT_RECORD = {
  id: RESTAURANT_ID,
  slug: 'test-restaurant',
  name: 'Test Restaurant',
  tagline: 'Taste the sea',
  description: 'A lovely seaside restaurant',
  cuisineType: 'seafood',
  priceRange: 2,
  averageMealDuration: 90,
  reservationWindow: 30,
  timeZone: 'Europe/Madrid',
  noShowPolicy: 'charge',
  depositPerGuest: 10,
  cancellationDeadlineHours: 24,
  layoutWidth: 20,
  layoutHeight: 15,
  publicOnStandaloneApp: true,
  guestSelectionEnabled: true,
  partnerAccountId: OWNER_ID,
  siteId: 'site-1',
  workingHours: [
    { id: 'wh-1', day: 1, openTime: '10:00', closeTime: '22:00' },
    { id: 'wh-2', day: 2, openTime: '11:00', closeTime: '23:00' },
  ],
}

// ─────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────

/** Arrange mocks so requireRestaurantOwner passes for OWNER_ID. */
function authorizeOwner() {
  mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ sudo: false } as any)
  vi.mocked(prisma.restaurant.findUnique).mockResolvedValueOnce({
    partnerAccountId: OWNER_ID,
  } as any)
}

/** Arrange mocks for an authenticated non-owner (wrong partnerAccountId). */
function authenticateNonOwner() {
  mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ sudo: false } as any)
  vi.mocked(prisma.restaurant.findUnique).mockResolvedValueOnce({
    partnerAccountId: 'someone-else',
  } as any)
}

beforeEach(() => {
  vi.clearAllMocks()
  // Must reset after clearAllMocks — clearAllMocks clears call history but NOT
  // implementations; auth would leak the previous test's session otherwise.
  mockAuth.mockResolvedValue(null as any)
})

// ─────────────────────────────────────────────────────
// getRestaurant
// ─────────────────────────────────────────────────────

describe('getRestaurant', () => {
  it('returns null without calling core when unauthenticated', async () => {
    const result = await getRestaurant(RESTAURANT_ID)
    expect(result).toBeNull()
    expect(mockGetRestaurantById).not.toHaveBeenCalled()
  })

  it('returns null without calling core when authenticated as non-owner', async () => {
    authenticateNonOwner()
    const result = await getRestaurant(RESTAURANT_ID)
    expect(result).toBeNull()
    expect(mockGetRestaurantById).not.toHaveBeenCalled()
  })

  it('returns null when restaurant record does not exist', async () => {
    authorizeOwner()
    mockGetRestaurantById.mockResolvedValue(null)
    const result = await getRestaurant(RESTAURANT_ID)
    expect(result).toBeNull()
  })

  it('returns a RestaurantDetail with correct mapped shape for an owner', async () => {
    authorizeOwner()
    mockGetRestaurantById.mockResolvedValue(RESTAURANT_RECORD as any)

    const result = await getRestaurant(RESTAURANT_ID)

    expect(result).not.toBeNull()
    expect(result!.id).toBe(RESTAURANT_ID)
    expect(result!.slug).toBe('test-restaurant')
    expect(result!.name).toBe('Test Restaurant')
    expect(result!.cuisineType).toBe('seafood')
    expect(result!.timeZone).toBe('Europe/Madrid')
    expect(result!.siteId).toBe('site-1')
    // partnerAccountId must NOT be exposed in the RestaurantDetail
    expect(result).not.toHaveProperty('partnerAccountId')
    // workingHour 'id' field must be stripped from the mapped output
    expect(result!.workingHours).toHaveLength(2)
    expect(result!.workingHours[0]).toEqual({ day: 1, openTime: '10:00', closeTime: '22:00' })
    expect(result!.workingHours[0]).not.toHaveProperty('id')
  })

  it('maps siteId as null when the restaurant has no siteId', async () => {
    authorizeOwner()
    mockGetRestaurantById.mockResolvedValue({
      ...RESTAURANT_RECORD,
      siteId: null,
    } as any)

    const result = await getRestaurant(RESTAURANT_ID)
    expect(result!.siteId).toBeNull()
  })
})

// ─────────────────────────────────────────────────────
// getRestaurantShifts
// ─────────────────────────────────────────────────────

describe('getRestaurantShifts', () => {
  const SHIFTS = [
    {
      id: 'shift-1',
      restaurantId: RESTAURANT_ID,
      name: 'Lunch',
      day: 1,
      startTime: '12:00',
      endTime: '15:00',
      pacingCovers: 20,
      pacingWindowMinutes: 30,
      lastSeatingOffsetMinutes: 30,
      requiresDeposit: false,
      depositMinPartySize: null,
    },
  ]

  it('returns null when unauthenticated', async () => {
    const result = await getRestaurantShifts(RESTAURANT_ID)
    expect(result).toBeNull()
    expect(mockListShifts).not.toHaveBeenCalled()
  })

  it('returns null when authenticated as non-owner', async () => {
    authenticateNonOwner()
    const result = await getRestaurantShifts(RESTAURANT_ID)
    expect(result).toBeNull()
    expect(mockListShifts).not.toHaveBeenCalled()
  })

  it('calls listShiftsForRestaurant with the restaurantId and returns the result', async () => {
    authorizeOwner()
    mockListShifts.mockResolvedValue(SHIFTS as any)

    const result = await getRestaurantShifts(RESTAURANT_ID)

    expect(mockListShifts).toHaveBeenCalledOnce()
    expect(mockListShifts).toHaveBeenCalledWith(RESTAURANT_ID)
    expect(result).toEqual(SHIFTS)
  })
})

// ─────────────────────────────────────────────────────
// getRestaurantCombinations
// ─────────────────────────────────────────────────────

describe('getRestaurantCombinations', () => {
  const COMBOS = [
    { id: 'combo-1', restaurantId: RESTAURANT_ID, name: 'Terrace', capacity: 8, tableIds: ['t1', 't2'] },
  ]

  it('returns null when unauthenticated', async () => {
    const result = await getRestaurantCombinations(RESTAURANT_ID)
    expect(result).toBeNull()
    expect(mockListCombinations).not.toHaveBeenCalled()
  })

  it('returns null when authenticated as non-owner', async () => {
    authenticateNonOwner()
    const result = await getRestaurantCombinations(RESTAURANT_ID)
    expect(result).toBeNull()
    expect(mockListCombinations).not.toHaveBeenCalled()
  })

  it('calls listCombinationsForRestaurant with the restaurantId and returns the result', async () => {
    authorizeOwner()
    mockListCombinations.mockResolvedValue(COMBOS as any)

    const result = await getRestaurantCombinations(RESTAURANT_ID)

    expect(mockListCombinations).toHaveBeenCalledOnce()
    expect(mockListCombinations).toHaveBeenCalledWith(RESTAURANT_ID)
    expect(result).toEqual(COMBOS)
  })
})

// ─────────────────────────────────────────────────────
// getRestaurantWaitlist
// ─────────────────────────────────────────────────────

describe('getRestaurantWaitlist', () => {
  const ENTRIES = [
    {
      id: 'wl-1',
      restaurantId: RESTAURANT_ID,
      dateISO: '2025-07-01',
      requestedTime: '19:00',
      partySize: 4,
      guestName: 'Alice',
      guestEmail: 'alice@example.com',
      guestPhone: null,
      status: 'waiting',
      notifiedAt: null,
      userId: null,
      anonId: null,
      createdAt: new Date('2025-06-30T12:00:00Z'),
    },
  ]

  it('returns null when unauthenticated', async () => {
    const result = await getRestaurantWaitlist(RESTAURANT_ID)
    expect(result).toBeNull()
    expect(mockListWaitlist).not.toHaveBeenCalled()
  })

  it('returns null when authenticated as non-owner', async () => {
    authenticateNonOwner()
    const result = await getRestaurantWaitlist(RESTAURANT_ID)
    expect(result).toBeNull()
    expect(mockListWaitlist).not.toHaveBeenCalled()
  })

  it('calls listWaitlistForRestaurant with restaurantId and no dateISO when omitted', async () => {
    authorizeOwner()
    mockListWaitlist.mockResolvedValue(ENTRIES as any)

    const result = await getRestaurantWaitlist(RESTAURANT_ID)

    expect(mockListWaitlist).toHaveBeenCalledOnce()
    expect(mockListWaitlist).toHaveBeenCalledWith(RESTAURANT_ID, undefined)
    expect(result).toEqual(ENTRIES)
  })

  it('forwards dateISO to listWaitlistForRestaurant when provided', async () => {
    authorizeOwner()
    mockListWaitlist.mockResolvedValue(ENTRIES as any)

    const result = await getRestaurantWaitlist(RESTAURANT_ID, '2025-07-01')

    expect(mockListWaitlist).toHaveBeenCalledOnce()
    expect(mockListWaitlist).toHaveBeenCalledWith(RESTAURANT_ID, '2025-07-01')
    expect(result).toEqual(ENTRIES)
  })
})

// ─────────────────────────────────────────────────────
// getRestaurantLayout
// ─────────────────────────────────────────────────────

describe('getRestaurantLayout', () => {
  const TABLES = [
    { id: 't1', restaurantId: RESTAURANT_ID, number: 1, capacity: 4 },
  ]
  const ELEMENTS = [
    { id: 'el-1', restaurantId: RESTAURANT_ID, type: 'wall', x: 0, y: 0, width: 10, height: 1 },
  ]

  it('returns null when unauthenticated', async () => {
    const result = await getRestaurantLayout(RESTAURANT_ID)
    expect(result).toBeNull()
    expect(mockGetRestaurantById).not.toHaveBeenCalled()
    expect(mockListTables).not.toHaveBeenCalled()
    expect(mockListElements).not.toHaveBeenCalled()
  })

  it('returns null when authenticated as non-owner', async () => {
    authenticateNonOwner()
    const result = await getRestaurantLayout(RESTAURANT_ID)
    expect(result).toBeNull()
    expect(mockGetRestaurantById).not.toHaveBeenCalled()
  })

  it('returns null when restaurant record does not exist', async () => {
    authorizeOwner()
    mockGetRestaurantById.mockResolvedValue(null)

    const result = await getRestaurantLayout(RESTAURANT_ID)
    expect(result).toBeNull()
    // Tables/elements must not be fetched if the restaurant itself is missing
    expect(mockListTables).not.toHaveBeenCalled()
    expect(mockListElements).not.toHaveBeenCalled()
  })

  it('returns the full layout with correct restaurantId, tables, and elements', async () => {
    authorizeOwner()
    mockGetRestaurantById.mockResolvedValue(RESTAURANT_RECORD as any)
    mockListTables.mockResolvedValue(TABLES as any)
    mockListElements.mockResolvedValue(ELEMENTS as any)

    const result = await getRestaurantLayout(RESTAURANT_ID)

    expect(result).not.toBeNull()
    expect(result!.restaurantId).toBe(RESTAURANT_ID)
    expect(result!.layoutWidth).toBe(20)   // from RESTAURANT_RECORD
    expect(result!.layoutHeight).toBe(15)  // from RESTAURANT_RECORD
    expect(result!.tables).toEqual(TABLES)
    expect(result!.elements).toEqual(ELEMENTS)
    expect(mockListTables).toHaveBeenCalledWith(RESTAURANT_ID)
    expect(mockListElements).toHaveBeenCalledWith(RESTAURANT_ID)
  })

  it('falls back to default dimensions (15×10) when layoutWidth/Height are null', async () => {
    authorizeOwner()
    mockGetRestaurantById.mockResolvedValue({
      ...RESTAURANT_RECORD,
      layoutWidth: null,
      layoutHeight: null,
    } as any)
    mockListTables.mockResolvedValue([])
    mockListElements.mockResolvedValue([])

    const result = await getRestaurantLayout(RESTAURANT_ID)

    expect(result!.layoutWidth).toBe(15)
    expect(result!.layoutHeight).toBe(10)
  })
})

// ─────────────────────────────────────────────────────
// getRestaurantMenu
// ─────────────────────────────────────────────────────

describe('getRestaurantMenu', () => {
  const MENU_ITEMS = [
    {
      id: 'item-1',
      restaurantId: RESTAURANT_ID,
      name: 'Grilled Fish',
      description: null,
      price: 18.5,
      imageUrl: null,
      category: 'main',
      soldOut: false,
      active: true,
      displayOrder: 1,
    },
    {
      id: 'item-2',
      restaurantId: RESTAURANT_ID,
      name: 'Archived Dish',
      description: null,
      price: 12,
      imageUrl: null,
      category: 'starter',
      soldOut: false,
      active: false,
      displayOrder: 5,
    },
  ]

  it('returns null when unauthenticated', async () => {
    const result = await getRestaurantMenu(RESTAURANT_ID)
    expect(result).toBeNull()
    expect(mockListMenuItems).not.toHaveBeenCalled()
  })

  it('returns null when authenticated as non-owner', async () => {
    authenticateNonOwner()
    const result = await getRestaurantMenu(RESTAURANT_ID)
    expect(result).toBeNull()
    expect(mockListMenuItems).not.toHaveBeenCalled()
  })

  it('calls listMenuItemsForRestaurant with includeInactive:true by default (partner shows all)', async () => {
    authorizeOwner()
    mockListMenuItems.mockResolvedValue(MENU_ITEMS as any)

    const result = await getRestaurantMenu(RESTAURANT_ID)

    expect(mockListMenuItems).toHaveBeenCalledOnce()
    expect(mockListMenuItems).toHaveBeenCalledWith(RESTAURANT_ID, { includeInactive: true })
    expect(result).toEqual(MENU_ITEMS)
  })

  it('calls listMenuItemsForRestaurant with includeInactive:false when activeOnly is true', async () => {
    authorizeOwner()
    mockListMenuItems.mockResolvedValue(MENU_ITEMS.filter((i) => i.active) as any)

    const result = await getRestaurantMenu(RESTAURANT_ID, { activeOnly: true })

    expect(mockListMenuItems).toHaveBeenCalledOnce()
    expect(mockListMenuItems).toHaveBeenCalledWith(RESTAURANT_ID, { includeInactive: false })
    expect(result).toHaveLength(1)
    expect(result![0].name).toBe('Grilled Fish')
  })
})
