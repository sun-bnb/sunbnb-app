import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/app/auth', () => ({ auth: vi.fn() }))
vi.mock('@/app/flags', () => ({ isFlagEnabled: vi.fn().mockResolvedValue(true) }))

import prisma from '@repo/data/PrismaCient'
import { auth } from '@/app/auth'
import {
  createTableForSite,
  updateTableForSite,
  deleteTableForSite,
  createTableGridForSite,
  createElementForSite,
  updateElementForSite,
  deleteElementForSite,
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
  // Three site.findUnique calls: ownership guard, action's restaurantId lookup,
  // and (for create/update/delete core actions) they don't hit Site again.
  vi.mocked(prisma.site.findUnique)
    .mockResolvedValueOnce({ userId: OWNER_ID } as any) // requireSiteOwner
    .mockResolvedValueOnce({ restaurantId: RESTAURANT_ID } as any) // requireLinkedRestaurant
}

function authorizeTableOwnership() {
  vi.mocked(prisma.restaurant.findUnique).mockResolvedValue({
    id: RESTAURANT_ID,
    partnerAccountId: OWNER_ID,
    siteId: SITE_ID,
  } as any)
}

describe('createTableForSite', () => {
  it('rejects when site has no linked restaurant', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ sudo: false } as any)
    vi.mocked(prisma.site.findUnique)
      .mockResolvedValueOnce({ userId: OWNER_ID } as any)
      .mockResolvedValueOnce({ restaurantId: null } as any)

    const res = await createTableForSite(SITE_ID, { x: 5, y: 5 })
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Site has no linked restaurant')
  })

  it('creates a table at the clicked position with a default capacity', async () => {
    authorizeOwnerOfLinkedRestaurant()
    authorizeTableOwnership()
    vi.mocked(prisma.table.findFirst).mockResolvedValue(null as any) // next number = 1
    vi.mocked(prisma.table.findUnique).mockResolvedValue(null as any)  // no number clash
    vi.mocked(prisma.table.create).mockResolvedValue({ id: 'table-1' } as any)

    const res = await createTableForSite(SITE_ID, { x: 3, y: 4 })
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

describe('updateTableForSite', () => {
  it('rejects invalid capacity', async () => {
    authorizeOwnerOfLinkedRestaurant()
    vi.mocked(prisma.table.findUnique)
      .mockResolvedValueOnce({ id: 'table-1', restaurantId: RESTAURANT_ID } as any)
    authorizeTableOwnership()

    const res = await updateTableForSite(SITE_ID, 'table-1', { capacity: 999 })
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toMatch(/Capacity/)
  })

  it('applies a valid patch', async () => {
    authorizeOwnerOfLinkedRestaurant()
    vi.mocked(prisma.table.findUnique)
      .mockResolvedValueOnce({ id: 'table-1', restaurantId: RESTAURANT_ID } as any)
    authorizeTableOwnership()
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

    const res = await updateTableForSite(SITE_ID, 'table-1', { capacity: 6 })
    expect(res.status).toBe('ok')
    expect(prisma.table.update).toHaveBeenCalledWith({
      where: { id: 'table-1' },
      data: { capacity: 6 },
    })
  })
})

describe('deleteTableForSite', () => {
  it('deletes the table when owner', async () => {
    authorizeOwnerOfLinkedRestaurant()
    vi.mocked(prisma.table.findUnique).mockResolvedValueOnce({
      restaurantId: RESTAURANT_ID,
    } as any)
    authorizeTableOwnership()
    vi.mocked(prisma.table.delete).mockResolvedValue({} as any)

    const res = await deleteTableForSite(SITE_ID, 'table-1')
    expect(res.status).toBe('ok')
    expect(prisma.table.delete).toHaveBeenCalledWith({ where: { id: 'table-1' } })
  })
})

describe('createTableGridForSite', () => {
  it('creates a grid of tables with row-major numbers', async () => {
    authorizeOwnerOfLinkedRestaurant()
    authorizeTableOwnership()
    vi.mocked(prisma.table.findFirst).mockResolvedValue(null as any) // start at 1
    vi.mocked(prisma.table.createMany).mockResolvedValue({ count: 6 } as any)

    const res = await createTableGridForSite(SITE_ID, {
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

describe('createElementForSite', () => {
  it('creates a layout element scoped to the restaurant', async () => {
    authorizeOwnerOfLinkedRestaurant()
    authorizeTableOwnership()
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

    const res = await createElementForSite(SITE_ID, {
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

describe('updateElementForSite', () => {
  it('updates coordinates after a drag', async () => {
    authorizeOwnerOfLinkedRestaurant()
    vi.mocked(prisma.layoutElement.findUnique).mockResolvedValueOnce({
      restaurantId: RESTAURANT_ID,
    } as any)
    authorizeTableOwnership()
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

    const res = await updateElementForSite(SITE_ID, 'el-1', { x: 5, y: 5 })
    expect(res.status).toBe('ok')
    expect(prisma.layoutElement.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'el-1' },
        data: { x: 5, y: 5 },
      }),
    )
  })
})

describe('deleteElementForSite', () => {
  it('deletes the element', async () => {
    authorizeOwnerOfLinkedRestaurant()
    vi.mocked(prisma.layoutElement.findUnique).mockResolvedValueOnce({
      restaurantId: RESTAURANT_ID,
    } as any)
    authorizeTableOwnership()
    vi.mocked(prisma.layoutElement.delete).mockResolvedValue({} as any)

    const res = await deleteElementForSite(SITE_ID, 'el-1')
    expect(res.status).toBe('ok')
    expect(prisma.layoutElement.delete).toHaveBeenCalledWith({ where: { id: 'el-1' } })
  })
})
