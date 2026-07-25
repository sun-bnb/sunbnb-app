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
  createMenuItemForRestaurant,
  updateMenuItemForRestaurant,
  archiveMenuItemForRestaurant,
  setMenuItemSoldOutForRestaurant,
  reorderMenuItemsForRestaurant,
} from './actions'

const mockAuth = vi.mocked(auth)
const RESTAURANT_ID = 'restaurant-1'
const OWNER_ID = 'user-1'

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue(null as any)
})

// ─────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────

function authorizeOwner() {
  mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ sudo: false } as any)
  // requireRestaurantOwnerWithFlag → requireRestaurantOwner → ownership check
  vi.mocked(prisma.restaurant.findUnique).mockResolvedValueOnce({
    partnerAccountId: OWNER_ID,
  } as any)
}

/** Core functions perform their own ownership check before each mutation. */
function coreOwnershipOk() {
  vi.mocked(prisma.restaurant.findUnique).mockResolvedValueOnce({
    id: RESTAURANT_ID,
    partnerAccountId: OWNER_ID,
  } as any)
}

// ─────────────────────────────────────────────────────
// createMenuItemForRestaurant
// ─────────────────────────────────────────────────────

describe('createMenuItemForRestaurant', () => {
  it('rejects unauthenticated', async () => {
    const fd = new FormData()
    fd.set('name', 'Pizza')
    fd.set('price', '10')
    const res = await createMenuItemForRestaurant(RESTAURANT_ID, fd)
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authenticated')
  })

  it('rejects when restaurant is not owned', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ sudo: false } as any)
    vi.mocked(prisma.restaurant.findUnique).mockResolvedValueOnce({
      partnerAccountId: 'someone-else',
    } as any)

    const fd = new FormData()
    fd.set('name', 'Pizza')
    fd.set('price', '10')
    const res = await createMenuItemForRestaurant(RESTAURANT_ID, fd)
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authorized')
  })

  it('creates a menu item with the next displayOrder', async () => {
    authorizeOwner()
    coreOwnershipOk()
    vi.mocked(prisma.menuItem.findFirst).mockResolvedValue({ displayOrder: 4 } as any)
    vi.mocked(prisma.menuItem.create).mockResolvedValue({ id: 'mi-1' } as any)
    vi.mocked(prisma.menuItem.findUnique).mockResolvedValue({
      id: 'mi-1',
      restaurantId: RESTAURANT_ID,
      name: 'Pizza',
      description: null,
      price: 10,
      imageUrl: null,
      category: 'mains',
      soldOut: false,
      active: true,
      displayOrder: 5,
    } as any)

    const fd = new FormData()
    fd.set('name', 'Pizza')
    fd.set('totalPrice', '10')
    fd.set('tax', '21')
    fd.set('category', 'mains')
    const res = await createMenuItemForRestaurant(RESTAURANT_ID, fd)
    expect(res.status).toBe('ok')
    expect(prisma.menuItem.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          restaurantId: RESTAURANT_ID,
          name: 'Pizza',
          // VAT triple: partner enters gross 10 @ 21% → net price derived
          totalPrice: 10,
          tax: 21,
          price: 8.26,
          category: 'mains',
          displayOrder: 5,
        }),
      }),
    )
  })
})

// ─────────────────────────────────────────────────────
// updateMenuItemForRestaurant
// ─────────────────────────────────────────────────────

describe('updateMenuItemForRestaurant', () => {
  it('updates description and price', async () => {
    authorizeOwner()
    vi.mocked(prisma.menuItem.findUnique).mockResolvedValueOnce({
      id: 'mi-1',
      restaurantId: RESTAURANT_ID,
      tax: 21,
      totalPrice: 10,
      price: 8.26,
    } as any)
    coreOwnershipOk()
    vi.mocked(prisma.menuItem.update).mockResolvedValue({ id: 'mi-1' } as any)
    vi.mocked(prisma.menuItem.findUnique).mockResolvedValue({
      id: 'mi-1',
      restaurantId: RESTAURANT_ID,
      name: 'Pizza',
      description: 'With buffalo mozzarella',
      price: 12,
      imageUrl: null,
      category: 'mains',
      soldOut: false,
      active: true,
      displayOrder: 0,
    } as any)

    const fd = new FormData()
    fd.set('description', 'With buffalo mozzarella')
    fd.set('totalPrice', '12')
    const res = await updateMenuItemForRestaurant(RESTAURANT_ID, 'mi-1', fd)
    expect(res.status).toBe('ok')
    expect(prisma.menuItem.update).toHaveBeenCalledWith({
      where: { id: 'mi-1' },
      data: {
        description: 'With buffalo mozzarella',
        // gross patched without tax → existing tax (21) merged, net re-derived
        totalPrice: 12,
        tax: 21,
        price: 9.92,
      },
    })
  })

  it('removes the image when removeImage flag is set', async () => {
    authorizeOwner()
    vi.mocked(prisma.menuItem.findUnique).mockResolvedValueOnce({
      id: 'mi-1',
      restaurantId: RESTAURANT_ID,
    } as any)
    coreOwnershipOk()
    vi.mocked(prisma.menuItem.update).mockResolvedValue({ id: 'mi-1' } as any)
    vi.mocked(prisma.menuItem.findUnique).mockResolvedValue({
      id: 'mi-1',
      restaurantId: RESTAURANT_ID,
      name: 'Pizza',
      description: null,
      price: 10,
      imageUrl: null,
      category: 'mains',
      soldOut: false,
      active: true,
      displayOrder: 0,
    } as any)

    const fd = new FormData()
    fd.set('removeImage', '1')
    const res = await updateMenuItemForRestaurant(RESTAURANT_ID, 'mi-1', fd)
    expect(res.status).toBe('ok')
    expect(prisma.menuItem.update).toHaveBeenCalledWith({
      where: { id: 'mi-1' },
      data: { imageUrl: null },
    })
  })
})

// ─────────────────────────────────────────────────────
// setMenuItemSoldOutForRestaurant
// ─────────────────────────────────────────────────────

describe('setMenuItemSoldOutForRestaurant', () => {
  it('toggles soldOut', async () => {
    authorizeOwner()
    vi.mocked(prisma.menuItem.findUnique).mockResolvedValueOnce({
      restaurantId: RESTAURANT_ID,
    } as any)
    coreOwnershipOk()
    vi.mocked(prisma.menuItem.update).mockResolvedValue({ id: 'mi-1' } as any)

    const res = await setMenuItemSoldOutForRestaurant(RESTAURANT_ID, 'mi-1', true)
    expect(res.status).toBe('ok')
    expect(prisma.menuItem.update).toHaveBeenCalledWith({
      where: { id: 'mi-1' },
      data: { soldOut: true },
    })
  })
})

// ─────────────────────────────────────────────────────
// archiveMenuItemForRestaurant
// ─────────────────────────────────────────────────────

describe('archiveMenuItemForRestaurant', () => {
  it('soft-deletes via active: false', async () => {
    authorizeOwner()
    vi.mocked(prisma.menuItem.findUnique).mockResolvedValueOnce({
      restaurantId: RESTAURANT_ID,
    } as any)
    coreOwnershipOk()
    vi.mocked(prisma.menuItem.update).mockResolvedValue({ id: 'mi-1' } as any)

    const res = await archiveMenuItemForRestaurant(RESTAURANT_ID, 'mi-1')
    expect(res.status).toBe('ok')
    expect(prisma.menuItem.update).toHaveBeenCalledWith({
      where: { id: 'mi-1' },
      data: { active: false },
    })
  })
})

// ─────────────────────────────────────────────────────
// reorderMenuItemsForRestaurant
// ─────────────────────────────────────────────────────

describe('reorderMenuItemsForRestaurant', () => {
  it('rejects items from a different restaurant', async () => {
    authorizeOwner()
    coreOwnershipOk()
    vi.mocked(prisma.menuItem.findMany).mockResolvedValue([
      { id: 'mi-1', restaurantId: RESTAURANT_ID },
      { id: 'foreign', restaurantId: 'other-restaurant' },
    ] as any)

    const res = await reorderMenuItemsForRestaurant(RESTAURANT_ID, ['mi-1', 'foreign'])
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toMatch(/belong to this restaurant/)
  })

  it('updates displayOrder row by row', async () => {
    authorizeOwner()
    coreOwnershipOk()
    vi.mocked(prisma.menuItem.findMany).mockResolvedValue([
      { id: 'mi-1', restaurantId: RESTAURANT_ID },
      { id: 'mi-2', restaurantId: RESTAURANT_ID },
      { id: 'mi-3', restaurantId: RESTAURANT_ID },
    ] as any)
    vi.mocked(prisma.menuItem.update).mockResolvedValue({} as any)

    const res = await reorderMenuItemsForRestaurant(RESTAURANT_ID, ['mi-3', 'mi-1', 'mi-2'])
    expect(res.status).toBe('ok')
    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    // Three updates queued with displayOrder 0/1/2.
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
