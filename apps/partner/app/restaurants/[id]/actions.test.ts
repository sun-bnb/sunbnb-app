import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/app/auth', () => ({ auth: vi.fn() }))
vi.mock('@/app/flags', () => ({ isFlagEnabled: vi.fn().mockResolvedValue(true) }))

import prisma from '@repo/data/PrismaCient'
import { auth } from '@/app/auth'
import { isFlagEnabled } from '@/app/flags'
import {
  createRestaurant,
  updateRestaurantSettings,
  setRestaurantOpeningHours,
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

// ─────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────

/** Authorize a normal (non-sudo) user owning the site. */
function authorizeSiteOwner() {
  mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ sudo: false } as any)
  // requireSiteOwnerWithFlag → requireSiteOwner → site ownership check
  vi.mocked(prisma.site.findUnique).mockResolvedValueOnce({ userId: OWNER_ID } as any)
}

/** Authorize a normal (non-sudo) user owning the restaurant. */
function authorizeRestaurantOwner() {
  mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ sudo: false } as any)
  // requireRestaurantOwnerWithFlag → requireRestaurantOwner → restaurant ownership check
  vi.mocked(prisma.restaurant.findUnique).mockResolvedValueOnce({
    partnerAccountId: OWNER_ID,
  } as any)
}

// ─────────────────────────────────────────────────────
// Feature flag gate
// ─────────────────────────────────────────────────────

describe('feature flag gate', () => {
  it('createRestaurant (site-linked) returns feature_disabled when flag is off', async () => {
    mockIsFlagEnabled.mockResolvedValue(false)
    const res = await createRestaurant({ siteId: SITE_ID })
    expect(res.status).toBe('error')
    expect(res.errors).toContain('feature_disabled')
  })

  it('createRestaurant (standalone) returns feature_disabled when flag is off', async () => {
    mockIsFlagEnabled.mockResolvedValue(false)
    const res = await createRestaurant({ name: 'My Restaurant' })
    expect(res.status).toBe('error')
    expect(res.errors).toContain('feature_disabled')
  })
})

// ─────────────────────────────────────────────────────
// createRestaurant — site-linked branch
// ─────────────────────────────────────────────────────

describe('createRestaurant — site-linked branch', () => {
  it('rejects unauthenticated', async () => {
    const res = await createRestaurant({ siteId: SITE_ID })
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authenticated')
  })

  it('rejects when site is not owned', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ sudo: false } as any)
    vi.mocked(prisma.site.findUnique).mockResolvedValueOnce({ userId: 'someone-else' } as any)

    const res = await createRestaurant({ siteId: SITE_ID })
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authorized')
  })

  it('rejects when site already has a linked restaurant', async () => {
    authorizeSiteOwner()
    vi.mocked(prisma.site.findUnique).mockResolvedValueOnce({
      name: 'Chiringuito El Sol',
      restaurantId: 'existing-restaurant',
      userId: OWNER_ID,
      layoutWidth: null,
      layoutHeight: null,
    } as any)

    const res = await createRestaurant({ siteId: SITE_ID })
    expect(res.status).toBe('error')
    expect(res.errors).toEqual(['Site already has a restaurant'])
  })

  it('creates a restaurant, copies working hours, and sets the soft link', async () => {
    authorizeSiteOwner()
    vi.mocked(prisma.site.findUnique).mockResolvedValueOnce({
      name: 'Chiringuito El Sol',
      restaurantId: null,
      userId: OWNER_ID,
      layoutWidth: 50,
      layoutHeight: 35,
    } as any)

    // uniqueRestaurantSlug + createRestaurant core lookups
    vi.mocked(prisma.restaurant.findUnique)
      .mockResolvedValueOnce(null as any) // slug uniqueness check
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
    // setRestaurantHours ownership re-check inside core
    vi.mocked(prisma.restaurant.findUnique).mockResolvedValue({
      id: RESTAURANT_ID,
      partnerAccountId: OWNER_ID,
      siteId: SITE_ID,
    } as any)

    const res = await createRestaurant({ siteId: SITE_ID })

    expect(res.status).toBe('ok')
    expect(res.restaurantId).toBe(RESTAURANT_ID)

    expect(prisma.restaurant.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
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

// ─────────────────────────────────────────────────────
// createRestaurant — standalone branch
// ─────────────────────────────────────────────────────

describe('createRestaurant — standalone branch', () => {
  it('rejects unauthenticated', async () => {
    const res = await createRestaurant({ name: 'My Place' })
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authenticated')
  })

  it('rejects when name is missing', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)

    const res = await createRestaurant({})
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Name is required')
  })

  it('creates a standalone restaurant without site link', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)

    vi.mocked(prisma.restaurant.findUnique)
      .mockResolvedValueOnce(null as any) // uniqueRestaurantSlug: slug candidate is free
      .mockResolvedValueOnce(null as any) // core createRestaurant: confirm slug still free
      // no siteId link check for standalone
      .mockResolvedValueOnce({
        id: RESTAURANT_ID,
        slug: 'my-place',
        name: 'My Place',
        tagline: null,
        description: null,
        partnerAccountId: OWNER_ID,
        siteId: null,
        cuisineType: null,
        priceRange: null,
        averageMealDuration: 120,
        reservationWindow: 60,
        layoutWidth: null,
        layoutHeight: null,
        publicOnStandaloneApp: true,
        workingHours: [],
      } as any)
    vi.mocked(prisma.restaurant.create).mockResolvedValue({ id: RESTAURANT_ID } as any)

    const res = await createRestaurant({ name: 'My Place' })

    expect(res.status).toBe('ok')
    expect(res.restaurantId).toBe(RESTAURANT_ID)

    expect(prisma.restaurant.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: 'My Place',
          partnerAccountId: OWNER_ID,
        }),
      }),
    )
    // No site link → site.update must NOT have been called.
    expect(prisma.site.update).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────
// updateRestaurantSettings
// ─────────────────────────────────────────────────────

describe('updateRestaurantSettings', () => {
  it('rejects unauthenticated', async () => {
    const res = await updateRestaurantSettings(RESTAURANT_ID, { name: 'New name' })
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authenticated')
  })

  it('rejects when restaurant is not owned', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ sudo: false } as any)
    vi.mocked(prisma.restaurant.findUnique).mockResolvedValueOnce({
      partnerAccountId: 'someone-else',
    } as any)

    const res = await updateRestaurantSettings(RESTAURANT_ID, { name: 'New name' })
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authorized')
  })

  it('delegates to core updateRestaurant when authorized', async () => {
    authorizeRestaurantOwner()
    // core updateRestaurant: ownership check + post-update fetch
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

    const res = await updateRestaurantSettings(RESTAURANT_ID, { name: 'Updated' })
    expect(res.status).toBe('ok')
    expect(prisma.restaurant.update).toHaveBeenCalledWith({
      where: { id: RESTAURANT_ID },
      data: expect.objectContaining({ name: 'Updated' }),
    })
  })
})

// ─────────────────────────────────────────────────────
// setRestaurantOpeningHours
// ─────────────────────────────────────────────────────

describe('setRestaurantOpeningHours', () => {
  it('rejects invalid times (close before open)', async () => {
    authorizeRestaurantOwner()
    vi.mocked(prisma.restaurant.findUnique).mockResolvedValue({
      id: RESTAURANT_ID,
      partnerAccountId: OWNER_ID,
      siteId: SITE_ID,
    } as any)

    const res = await setRestaurantOpeningHours(RESTAURANT_ID, [
      { day: 1, openTime: '22:00', closeTime: '10:00' },
    ])
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toMatch(/openTime must be before closeTime/)
  })

  it('replaces hours in a transaction when valid', async () => {
    authorizeRestaurantOwner()
    vi.mocked(prisma.restaurant.findUnique).mockResolvedValue({
      id: RESTAURANT_ID,
      partnerAccountId: OWNER_ID,
      siteId: SITE_ID,
    } as any)

    const res = await setRestaurantOpeningHours(RESTAURANT_ID, [
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
