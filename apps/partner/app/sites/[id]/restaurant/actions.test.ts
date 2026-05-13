import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/app/auth', () => ({ auth: vi.fn() }))
vi.mock('@/app/flags', () => ({ isFlagEnabled: vi.fn().mockResolvedValue(true) }))

import prisma from '@repo/data/PrismaCient'
import { auth } from '@/app/auth'
import { isFlagEnabled } from '@/app/flags'
import {
  enableTableReservations,
  updateLinkedRestaurant,
  setLinkedRestaurantHours,
} from './actions'

const mockAuth = vi.mocked(auth)
const mockIsFlagEnabled = vi.mocked(isFlagEnabled)

const SITE_ID = 'site-1'
const OWNER_ID = 'user-1'
const RESTAURANT_ID = 'restaurant-1'

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue(null as any)
  mockIsFlagEnabled.mockResolvedValue(true)
})

describe('feature flag gate', () => {
  it('returns feature_disabled when the restaurants flag is off', async () => {
    mockIsFlagEnabled.mockResolvedValue(false)
    const res = await enableTableReservations(SITE_ID)
    expect(res.status).toBe('error')
    expect(res.errors).toContain('feature_disabled')
  })
})

function authorizeOwner() {
  mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ sudo: false } as any)
}

describe('enableTableReservations', () => {
  it('rejects unauthenticated', async () => {
    const res = await enableTableReservations(SITE_ID)
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authenticated')
  })

  it('rejects when site is not owned', async () => {
    authorizeOwner()
    vi.mocked(prisma.site.findUnique).mockResolvedValueOnce({ userId: 'someone-else' } as any)

    const res = await enableTableReservations(SITE_ID)
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authorized')
  })

  it('rejects when site already has a linked restaurant', async () => {
    authorizeOwner()
    vi.mocked(prisma.site.findUnique)
      // First call: auth helper's ownership check.
      .mockResolvedValueOnce({ userId: OWNER_ID } as any)
      // Second call: action reads the site.
      .mockResolvedValueOnce({
        name: 'Chiringuito El Sol',
        restaurantId: 'existing-restaurant',
        userId: OWNER_ID,
        layoutWidth: null,
        layoutHeight: null,
      } as any)

    const res = await enableTableReservations(SITE_ID)
    expect(res.status).toBe('error')
    expect(res.errors).toEqual(['Site already has a restaurant'])
  })

  it('creates a restaurant, copies working hours, and links it to the site', async () => {
    authorizeOwner()
    vi.mocked(prisma.site.findUnique)
      .mockResolvedValueOnce({ userId: OWNER_ID } as any)
      .mockResolvedValueOnce({
        name: 'Chiringuito El Sol',
        restaurantId: null,
        userId: OWNER_ID,
        layoutWidth: 50,
        layoutHeight: 35,
      } as any)
    // Slug uniqueness: first lookup, then creation uniqueness re-check.
    vi.mocked(prisma.restaurant.findUnique)
      .mockResolvedValueOnce(null as any) // uniqueRestaurantSlug candidate check
      .mockResolvedValueOnce(null as any) // createRestaurant slug double-check
      .mockResolvedValueOnce(null as any) // createRestaurant siteId link check
      .mockResolvedValueOnce({
        id: RESTAURANT_ID,
        slug: 'chiringuito-el-sol',
        name: 'Chiringuito El Sol',
        tagline: null,
        description: null,
        partnerAccountId: OWNER_ID,
        siteId: SITE_ID,
        cuisineType: null,
        priceRange: null,
        averageMealDuration: 120,
        reservationWindow: 60,
        layoutWidth: 50,
        layoutHeight: 35,
        publicOnStandaloneApp: true,
        workingHours: [],
      } as any)
    vi.mocked(prisma.restaurant.create).mockResolvedValue({ id: RESTAURANT_ID } as any)
    vi.mocked(prisma.siteWorkingHours.findMany).mockResolvedValue([
      {
        day: 1,
        openTime: new Date(Date.UTC(2026, 0, 1, 10, 0)),
        closeTime: new Date(Date.UTC(2026, 0, 1, 22, 30)),
      },
    ] as any)
    // setRestaurantHours path — ownership resolves via the already-created restaurant.
    vi.mocked(prisma.restaurant.findUnique).mockResolvedValue({
      id: RESTAURANT_ID,
      partnerAccountId: OWNER_ID,
      siteId: SITE_ID,
    } as any)

    const res = await enableTableReservations(SITE_ID)

    expect(res.status).toBe('ok')
    expect(res.restaurantId).toBe(RESTAURANT_ID)

    // Restaurant record created with expected defaults.
    expect(prisma.restaurant.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          slug: 'chiringuito-el-sol',
          name: 'Chiringuito El Sol',
          partnerAccountId: OWNER_ID,
          siteId: SITE_ID,
          layoutWidth: 50,
          layoutHeight: 35,
        }),
      }),
    )

    // Hours were translated from SiteWorkingHours to "HH:mm" strings.
    expect(prisma.restaurantHours.createMany).toHaveBeenCalledWith({
      data: [
        {
          restaurantId: RESTAURANT_ID,
          day: 1,
          openTime: '10:00',
          closeTime: '22:30',
        },
      ],
    })

    // Soft link set on Site side.
    expect(prisma.site.update).toHaveBeenCalledWith({
      where: { id: SITE_ID },
      data: { restaurantId: RESTAURANT_ID },
    })
  })
})

describe('updateLinkedRestaurant', () => {
  it('rejects when site has no linked restaurant', async () => {
    authorizeOwner()
    vi.mocked(prisma.site.findUnique)
      .mockResolvedValueOnce({ userId: OWNER_ID } as any)
      .mockResolvedValueOnce({ restaurantId: null } as any)

    const res = await updateLinkedRestaurant(SITE_ID, { name: 'New name' })
    expect(res.status).toBe('error')
    expect(res.errors).toEqual(['Site has no linked restaurant'])
  })

  it('delegates to core updateRestaurant when linked', async () => {
    authorizeOwner()
    vi.mocked(prisma.site.findUnique)
      .mockResolvedValueOnce({ userId: OWNER_ID } as any)
      .mockResolvedValueOnce({ restaurantId: RESTAURANT_ID } as any)
    // Ownership check inside updateRestaurant + post-update fetch.
    vi.mocked(prisma.restaurant.findUnique)
      .mockResolvedValueOnce({
        id: RESTAURANT_ID,
        partnerAccountId: OWNER_ID,
        siteId: SITE_ID,
      } as any)
      .mockResolvedValueOnce({
        id: RESTAURANT_ID,
        slug: 'restaurant',
        name: 'Updated',
        tagline: null,
        description: null,
        partnerAccountId: OWNER_ID,
        siteId: SITE_ID,
        cuisineType: null,
        priceRange: null,
        averageMealDuration: 120,
        reservationWindow: 60,
        layoutWidth: null,
        layoutHeight: null,
        publicOnStandaloneApp: true,
        workingHours: [],
      } as any)
    vi.mocked(prisma.restaurant.update).mockResolvedValue({ id: RESTAURANT_ID } as any)

    const res = await updateLinkedRestaurant(SITE_ID, { name: 'Updated' })
    expect(res.status).toBe('ok')
    expect(prisma.restaurant.update).toHaveBeenCalledWith({
      where: { id: RESTAURANT_ID },
      data: expect.objectContaining({ name: 'Updated' }),
    })
  })
})

describe('setLinkedRestaurantHours', () => {
  it('rejects invalid times', async () => {
    authorizeOwner()
    vi.mocked(prisma.site.findUnique)
      .mockResolvedValueOnce({ userId: OWNER_ID } as any)
      .mockResolvedValueOnce({ restaurantId: RESTAURANT_ID } as any)
    vi.mocked(prisma.restaurant.findUnique).mockResolvedValueOnce({
      id: RESTAURANT_ID,
      partnerAccountId: OWNER_ID,
      siteId: SITE_ID,
    } as any)

    const res = await setLinkedRestaurantHours(SITE_ID, [
      { day: 1, openTime: '22:00', closeTime: '10:00' },
    ])
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toMatch(/openTime must be before closeTime/)
  })

  it('replaces hours in a transaction when valid', async () => {
    authorizeOwner()
    vi.mocked(prisma.site.findUnique)
      .mockResolvedValueOnce({ userId: OWNER_ID } as any)
      .mockResolvedValueOnce({ restaurantId: RESTAURANT_ID } as any)
    vi.mocked(prisma.restaurant.findUnique).mockResolvedValueOnce({
      id: RESTAURANT_ID,
      partnerAccountId: OWNER_ID,
      siteId: SITE_ID,
    } as any)

    const res = await setLinkedRestaurantHours(SITE_ID, [
      { day: 1, openTime: '10:00', closeTime: '22:00' },
      { day: 2, openTime: '11:00', closeTime: '23:00' },
    ])
    expect(res.status).toBe('ok')
    expect(prisma.restaurantHours.deleteMany).toHaveBeenCalledWith({
      where: { restaurantId: RESTAURANT_ID },
    })
    expect(prisma.restaurantHours.createMany).toHaveBeenCalledWith({
      data: [
        { restaurantId: RESTAURANT_ID, day: 1, openTime: '10:00', closeTime: '22:00' },
        { restaurantId: RESTAURANT_ID, day: 2, openTime: '11:00', closeTime: '23:00' },
      ],
    })
  })
})
