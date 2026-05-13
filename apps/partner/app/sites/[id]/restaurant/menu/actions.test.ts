import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/app/auth', () => ({ auth: vi.fn() }))
vi.mock('@/app/flags', () => ({ isFlagEnabled: vi.fn().mockResolvedValue(true) }))
vi.mock('@vercel/blob', () => ({
  put: vi.fn(async (key: string) => ({ url: `https://blob.test/${key}` })),
}))

import prisma from '@repo/data/PrismaCient'
import { auth } from '@/app/auth'
import {
  createMenuItemForSite,
  updateMenuItemForSite,
  archiveMenuItemForSite,
  setMenuItemSoldOutForSite,
  reorderMenuItemsForSite,
} from './actions'

const mockAuth = vi.mocked(auth)
const SITE_ID = 'site-1'
const OWNER_ID = 'user-1'
const RESTAURANT_ID = 'restaurant-1'

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue(null as any)
})

function authorizeOwnerOfLinkedRestaurant() {
  mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ sudo: false } as any)
  vi.mocked(prisma.site.findUnique)
    .mockResolvedValueOnce({ userId: OWNER_ID } as any) // requireSiteOwner
    .mockResolvedValueOnce({ restaurantId: RESTAURANT_ID } as any) // requireLinkedRestaurant
}

function restaurantOwned() {
  vi.mocked(prisma.restaurant.findUnique).mockResolvedValue({
    id: RESTAURANT_ID,
    partnerAccountId: OWNER_ID,
    siteId: SITE_ID,
  } as any)
}

describe('createMenuItemForSite', () => {
  it('rejects when site has no linked restaurant', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ sudo: false } as any)
    vi.mocked(prisma.site.findUnique)
      .mockResolvedValueOnce({ userId: OWNER_ID } as any)
      .mockResolvedValueOnce({ restaurantId: null } as any)

    const fd = new FormData()
    fd.set('name', 'Pizza')
    fd.set('price', '10')
    const res = await createMenuItemForSite(SITE_ID, fd)
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Site has no linked restaurant')
  })

  it('creates a menu item with next displayOrder', async () => {
    authorizeOwnerOfLinkedRestaurant()
    restaurantOwned()
    vi.mocked(prisma.menuItem.findFirst).mockResolvedValue({ displayOrder: 4 } as any)
    vi.mocked(prisma.menuItem.create).mockResolvedValue({ id: 'mi-1' } as any)
    vi.mocked(prisma.menuItem.findUnique).mockResolvedValue({
      id: 'mi-1',
      restaurantId: RESTAURANT_ID,
      name: 'Pizza',
      description: null,
      price: 10,
      imageUrl: null,
      category: 'main',
      soldOut: false,
      active: true,
      displayOrder: 5,
    } as any)

    const fd = new FormData()
    fd.set('name', 'Pizza')
    fd.set('price', '10')
    fd.set('category', 'mains')
    const res = await createMenuItemForSite(SITE_ID, fd)
    expect(res.status).toBe('ok')
    expect(prisma.menuItem.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          restaurantId: RESTAURANT_ID,
          name: 'Pizza',
          price: 10,
          category: 'mains',
          displayOrder: 5,
        }),
      }),
    )
  })
})

describe('updateMenuItemForSite', () => {
  it('updates description and price', async () => {
    authorizeOwnerOfLinkedRestaurant()
    vi.mocked(prisma.menuItem.findUnique).mockResolvedValueOnce({
      id: 'mi-1',
      restaurantId: RESTAURANT_ID,
    } as any)
    restaurantOwned()
    vi.mocked(prisma.menuItem.update).mockResolvedValue({ id: 'mi-1' } as any)
    vi.mocked(prisma.menuItem.findUnique).mockResolvedValue({
      id: 'mi-1',
      restaurantId: RESTAURANT_ID,
      name: 'Pizza',
      description: 'With buffalo mozzarella',
      price: 12,
      imageUrl: null,
      category: 'main',
      soldOut: false,
      active: true,
      displayOrder: 0,
    } as any)

    const fd = new FormData()
    fd.set('description', 'With buffalo mozzarella')
    fd.set('price', '12')
    const res = await updateMenuItemForSite(SITE_ID, 'mi-1', fd)
    expect(res.status).toBe('ok')
    expect(prisma.menuItem.update).toHaveBeenCalledWith({
      where: { id: 'mi-1' },
      data: {
        description: 'With buffalo mozzarella',
        price: 12,
      },
    })
  })

  it('removes the image when removeImage flag is set', async () => {
    authorizeOwnerOfLinkedRestaurant()
    vi.mocked(prisma.menuItem.findUnique).mockResolvedValueOnce({
      id: 'mi-1',
      restaurantId: RESTAURANT_ID,
    } as any)
    restaurantOwned()
    vi.mocked(prisma.menuItem.update).mockResolvedValue({ id: 'mi-1' } as any)
    vi.mocked(prisma.menuItem.findUnique).mockResolvedValue({
      id: 'mi-1',
      restaurantId: RESTAURANT_ID,
      name: 'Pizza',
      description: null,
      price: 10,
      imageUrl: null,
      category: 'main',
      soldOut: false,
      active: true,
      displayOrder: 0,
    } as any)

    const fd = new FormData()
    fd.set('removeImage', '1')
    const res = await updateMenuItemForSite(SITE_ID, 'mi-1', fd)
    expect(res.status).toBe('ok')
    expect(prisma.menuItem.update).toHaveBeenCalledWith({
      where: { id: 'mi-1' },
      data: { imageUrl: null },
    })
  })
})

describe('setMenuItemSoldOutForSite', () => {
  it('toggles soldOut', async () => {
    authorizeOwnerOfLinkedRestaurant()
    vi.mocked(prisma.menuItem.findUnique).mockResolvedValueOnce({
      restaurantId: RESTAURANT_ID,
    } as any)
    restaurantOwned()
    vi.mocked(prisma.menuItem.update).mockResolvedValue({ id: 'mi-1' } as any)

    const res = await setMenuItemSoldOutForSite(SITE_ID, 'mi-1', true)
    expect(res.status).toBe('ok')
    expect(prisma.menuItem.update).toHaveBeenCalledWith({
      where: { id: 'mi-1' },
      data: { soldOut: true },
    })
  })
})

describe('archiveMenuItemForSite', () => {
  it('soft-deletes via active: false', async () => {
    authorizeOwnerOfLinkedRestaurant()
    vi.mocked(prisma.menuItem.findUnique).mockResolvedValueOnce({
      restaurantId: RESTAURANT_ID,
    } as any)
    restaurantOwned()
    vi.mocked(prisma.menuItem.update).mockResolvedValue({ id: 'mi-1' } as any)

    const res = await archiveMenuItemForSite(SITE_ID, 'mi-1')
    expect(res.status).toBe('ok')
    expect(prisma.menuItem.update).toHaveBeenCalledWith({
      where: { id: 'mi-1' },
      data: { active: false },
    })
  })
})

describe('reorderMenuItemsForSite', () => {
  it('rejects items from a different restaurant', async () => {
    authorizeOwnerOfLinkedRestaurant()
    restaurantOwned()
    vi.mocked(prisma.menuItem.findMany).mockResolvedValue([
      { id: 'mi-1', restaurantId: RESTAURANT_ID },
      { id: 'foreign', restaurantId: 'other-restaurant' },
    ] as any)

    const res = await reorderMenuItemsForSite(SITE_ID, ['mi-1', 'foreign'])
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toMatch(/belong to this restaurant/)
  })

  it('updates displayOrder row by row', async () => {
    authorizeOwnerOfLinkedRestaurant()
    restaurantOwned()
    vi.mocked(prisma.menuItem.findMany).mockResolvedValue([
      { id: 'mi-1', restaurantId: RESTAURANT_ID },
      { id: 'mi-2', restaurantId: RESTAURANT_ID },
      { id: 'mi-3', restaurantId: RESTAURANT_ID },
    ] as any)
    vi.mocked(prisma.menuItem.update).mockResolvedValue({} as any)

    const res = await reorderMenuItemsForSite(SITE_ID, ['mi-3', 'mi-1', 'mi-2'])
    expect(res.status).toBe('ok')
    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    // Three updates queued with ordered displayOrder 0/1/2.
    expect(prisma.menuItem.update).toHaveBeenNthCalledWith(1, {
      where: { id: 'mi-3' },
      data: { displayOrder: 0 },
    })
    expect(prisma.menuItem.update).toHaveBeenNthCalledWith(2, {
      where: { id: 'mi-1' },
      data: { displayOrder: 1 },
    })
    expect(prisma.menuItem.update).toHaveBeenNthCalledWith(3, {
      where: { id: 'mi-2' },
      data: { displayOrder: 2 },
    })
  })
})
