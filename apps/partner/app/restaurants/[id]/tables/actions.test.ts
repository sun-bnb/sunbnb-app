import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/app/auth', () => ({ auth: vi.fn() }))
vi.mock('@/app/flags', () => ({ isFlagEnabled: vi.fn().mockResolvedValue(true) }))

import prisma from '@repo/data/PrismaCient'
import { auth } from '@/app/auth'
import {
  createTableForRestaurant,
  updateTableForRestaurant,
  deleteTableForRestaurant,
  createTableGridForRestaurant,
  createElementForRestaurant,
  updateElementForRestaurant,
  deleteElementForRestaurant,
  saveRestaurantCanvasDimensions,
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

/** Set up auth + restaurant ownership via requireRestaurantOwnerWithFlag. */
function authorizeOwner() {
  mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ sudo: false } as any)
  vi.mocked(prisma.restaurant.findUnique).mockResolvedValueOnce({
    partnerAccountId: OWNER_ID,
  } as any)
}

/** Provide the ownership check that core functions perform. */
function coreOwnershipOk() {
  vi.mocked(prisma.restaurant.findUnique).mockResolvedValueOnce({
    id: RESTAURANT_ID,
    partnerAccountId: OWNER_ID,
  } as any)
}

// ─────────────────────────────────────────────────────
// createTableForRestaurant
// ─────────────────────────────────────────────────────

describe('createTableForRestaurant', () => {
  it('rejects unauthenticated', async () => {
    const res = await createTableForRestaurant(RESTAURANT_ID, { x: 3, y: 4 })
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authenticated')
  })

  it('rejects when restaurant is not owned', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ sudo: false } as any)
    vi.mocked(prisma.restaurant.findUnique).mockResolvedValueOnce({
      partnerAccountId: 'someone-else',
    } as any)

    const res = await createTableForRestaurant(RESTAURANT_ID, { x: 3, y: 4 })
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authorized')
  })

  it('creates a table at the given position with default capacity', async () => {
    authorizeOwner()
    coreOwnershipOk()
    vi.mocked(prisma.table.findFirst).mockResolvedValue(null as any) // next number = 1
    vi.mocked(prisma.table.findUnique).mockResolvedValue(null as any) // no number clash
    vi.mocked(prisma.table.create).mockResolvedValue({ id: 'table-1' } as any)

    const res = await createTableForRestaurant(RESTAURANT_ID, { x: 3, y: 4 })
    expect(res.status).toBe('ok')
    expect(prisma.table.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          restaurantId: RESTAURANT_ID,
          number: 1,
          capacity: 4,
          shape: 'square',
          schematicX: 3,
          schematicY: 4,
        }),
      }),
    )
  })
})

// ─────────────────────────────────────────────────────
// updateTableForRestaurant
// ─────────────────────────────────────────────────────

describe('updateTableForRestaurant', () => {
  it('rejects invalid capacity', async () => {
    authorizeOwner()
    vi.mocked(prisma.table.findUnique).mockResolvedValueOnce({
      id: 'table-1',
      restaurantId: RESTAURANT_ID,
    } as any)
    coreOwnershipOk()

    const res = await updateTableForRestaurant(RESTAURANT_ID, 'table-1', { capacity: 999 })
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toMatch(/Capacity/)
  })

  it('applies a valid patch', async () => {
    authorizeOwner()
    vi.mocked(prisma.table.findUnique)
      .mockResolvedValueOnce({ id: 'table-1', restaurantId: RESTAURANT_ID } as any)
    coreOwnershipOk()
    vi.mocked(prisma.table.update).mockResolvedValue({ id: 'table-1' } as any)
    vi.mocked(prisma.table.findUnique).mockResolvedValueOnce({
      id: 'table-1',
      restaurantId: RESTAURANT_ID,
      number: 1,
      label: null,
      capacity: 6,
      minPartySize: 1,
      shape: 'square',
      schematicX: 3,
      schematicY: 4,
      rotation: 0,
      status: 'active',
    } as any)

    const res = await updateTableForRestaurant(RESTAURANT_ID, 'table-1', { capacity: 6 })
    expect(res.status).toBe('ok')
    expect(prisma.table.update).toHaveBeenCalledWith({
      where: { id: 'table-1' },
      data: { capacity: 6 },
    })
  })
})

// ─────────────────────────────────────────────────────
// deleteTableForRestaurant
// ─────────────────────────────────────────────────────

describe('deleteTableForRestaurant', () => {
  it('deletes the table when authorized', async () => {
    authorizeOwner()
    vi.mocked(prisma.table.findUnique).mockResolvedValueOnce({
      restaurantId: RESTAURANT_ID,
    } as any)
    coreOwnershipOk()
    vi.mocked(prisma.table.delete).mockResolvedValue({} as any)

    const res = await deleteTableForRestaurant(RESTAURANT_ID, 'table-1')
    expect(res.status).toBe('ok')
    expect(prisma.table.delete).toHaveBeenCalledWith({ where: { id: 'table-1' } })
  })
})

// ─────────────────────────────────────────────────────
// createTableGridForRestaurant
// ─────────────────────────────────────────────────────

describe('createTableGridForRestaurant', () => {
  it('creates a grid of tables with row-major numbers', async () => {
    authorizeOwner()
    coreOwnershipOk()
    vi.mocked(prisma.table.findFirst).mockResolvedValue(null as any) // start at 1
    vi.mocked(prisma.table.createMany).mockResolvedValue({ count: 6 } as any)

    const res = await createTableGridForRestaurant(RESTAURANT_ID, {
      rows: 2,
      cols: 3,
      originX: 5,
      originY: 5,
      horizontalGap: 1,
      verticalGap: 1,
      tableWidth: 1,
      tableHeight: 1,
      capacity: 4,
      shape: 'square',
      rotation: 0,
    })

    expect(res.status).toBe('ok')
    expect(res.created).toBe(6)
    const call = vi.mocked(prisma.table.createMany).mock.calls[0]![0] as any
    expect(call.data).toHaveLength(6)
    expect(call.data[0].number).toBe(1)
    expect(call.data[5].number).toBe(6)
  })
})

// ─────────────────────────────────────────────────────
// createElementForRestaurant
// ─────────────────────────────────────────────────────

describe('createElementForRestaurant', () => {
  it('creates a layout element scoped to the restaurant', async () => {
    authorizeOwner()
    coreOwnershipOk()
    vi.mocked(prisma.layoutElement.create).mockResolvedValue({
      id: 'el-1',
      restaurantId: RESTAURANT_ID,
      siteId: null,
      type: 'dining',
      shape: 'rect',
      x: 0,
      y: 0,
      width: 10,
      height: 8,
      rotation: 0,
      z: 100,
      label: null,
      color: null,
      cornerRadius: 0,
    } as any)

    const res = await createElementForRestaurant(RESTAURANT_ID, {
      type: 'dining',
      shape: 'rect',
      x: 0,
      y: 0,
      width: 10,
      height: 8,
    })
    expect(res.status).toBe('ok')
    expect(prisma.layoutElement.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          restaurantId: RESTAURANT_ID,
          siteId: null,
          type: 'dining',
        }),
      }),
    )
  })
})

// ─────────────────────────────────────────────────────
// updateElementForRestaurant
// ─────────────────────────────────────────────────────

describe('updateElementForRestaurant', () => {
  it('updates coordinates after a drag', async () => {
    authorizeOwner()
    vi.mocked(prisma.layoutElement.findUnique).mockResolvedValueOnce({
      restaurantId: RESTAURANT_ID,
    } as any)
    coreOwnershipOk()
    vi.mocked(prisma.layoutElement.update).mockResolvedValue({
      id: 'el-1',
      restaurantId: RESTAURANT_ID,
      siteId: null,
      type: 'dining',
      shape: 'rect',
      x: 5,
      y: 5,
      width: 10,
      height: 8,
      rotation: 0,
      z: 100,
      label: null,
      color: null,
      cornerRadius: 0,
    } as any)

    const res = await updateElementForRestaurant(RESTAURANT_ID, 'el-1', { x: 5, y: 5 })
    expect(res.status).toBe('ok')
    expect(prisma.layoutElement.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'el-1' },
        data: { x: 5, y: 5 },
      }),
    )
  })
})

// ─────────────────────────────────────────────────────
// deleteElementForRestaurant
// ─────────────────────────────────────────────────────

describe('deleteElementForRestaurant', () => {
  it('deletes the element', async () => {
    authorizeOwner()
    vi.mocked(prisma.layoutElement.findUnique).mockResolvedValueOnce({
      restaurantId: RESTAURANT_ID,
    } as any)
    coreOwnershipOk()
    vi.mocked(prisma.layoutElement.delete).mockResolvedValue({} as any)

    const res = await deleteElementForRestaurant(RESTAURANT_ID, 'el-1')
    expect(res.status).toBe('ok')
    expect(prisma.layoutElement.delete).toHaveBeenCalledWith({ where: { id: 'el-1' } })
  })
})

// ─────────────────────────────────────────────────────
// saveRestaurantCanvasDimensions
// ─────────────────────────────────────────────────────

describe('saveRestaurantCanvasDimensions', () => {
  it('rejects out-of-range dimensions', async () => {
    authorizeOwner()
    const res = await saveRestaurantCanvasDimensions(RESTAURANT_ID, 2, 2)
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Dimensions out of range')
  })

  it('updates canvas dimensions when in range', async () => {
    authorizeOwner()
    vi.mocked(prisma.restaurant.update).mockResolvedValue({} as any)

    const res = await saveRestaurantCanvasDimensions(RESTAURANT_ID, 20, 15)
    expect(res.status).toBe('ok')
    expect(prisma.restaurant.update).toHaveBeenCalledWith({
      where: { id: RESTAURANT_ID },
      data: { layoutWidth: 20, layoutHeight: 15 },
    })
  })
})
