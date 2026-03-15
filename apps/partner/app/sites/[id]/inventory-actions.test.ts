import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/auth', () => ({
  auth: vi.fn().mockResolvedValue(null),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

vi.mock('@/lib/auth-helpers', () => ({
  requireSiteOwner: vi.fn().mockResolvedValue({ session: null, error: 'Not authenticated' }),
}))

import {
  createInventoryItem,
  deleteInventoryItem,
  saveInventoryItemLocation,
  saveInventoryItemProperties,
  deleteItemsByGroup,
} from './inventory-actions'
import { auth } from '@/app/auth'
import { requireSiteOwner } from '@/lib/auth-helpers'
import prisma from '@repo/data/PrismaCient'

const mockAuth = vi.mocked(auth)
const mockRequireSiteOwner = vi.mocked(requireSiteOwner)
const OWNER_ID = 'owner-1'
const SITE_ID = 'site-1'

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue(null)
  mockRequireSiteOwner.mockResolvedValue({ session: null, error: 'Not authenticated' })
})

function authorizeOwner() {
  const session = { user: { id: OWNER_ID } }
  mockAuth.mockResolvedValue(session as any)
  mockRequireSiteOwner.mockResolvedValue({ session, error: null })
}

// ─── createInventoryItem ────────────────────────────────────────────────────

describe('createInventoryItem', () => {
  it('rejects unauthenticated user', async () => {
    const res = await createInventoryItem({ siteId: SITE_ID })
    expect(res.status).toBe('error')
  })

  it('auto-increments item number', async () => {
    authorizeOwner()
    vi.mocked(prisma.inventoryItem.findFirst).mockResolvedValue({ number: 5 } as any)
    vi.mocked(prisma.inventoryItem.create).mockResolvedValue({ id: 'item-new', number: 6 } as any)

    const res = await createInventoryItem({ siteId: SITE_ID })
    expect(res.status).toBe('ok')

    const createCall = vi.mocked(prisma.inventoryItem.create).mock.calls[0][0]
    expect(createCall.data.number).toBe(6)
    expect(createCall.data.status).toBe('new')
    expect(createCall.data.locationLat).toBe('0')
  })

  it('starts at 1 when no existing items', async () => {
    authorizeOwner()
    vi.mocked(prisma.inventoryItem.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.inventoryItem.create).mockResolvedValue({ id: 'item-1' } as any)

    await createInventoryItem({ siteId: SITE_ID })
    const createCall = vi.mocked(prisma.inventoryItem.create).mock.calls[0][0]
    expect(createCall.data.number).toBe(1)
  })
})

// ─── deleteInventoryItem ────────────────────────────────────────────────────

describe('deleteInventoryItem', () => {
  it('rejects unauthenticated', async () => {
    const res = await deleteInventoryItem('item-1')
    expect(res.status).toBe('error')
  })

  it('rejects non-owner', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'other-user' } } as any)
    vi.mocked(prisma.inventoryItem.findUnique).mockResolvedValue({
      site: { userId: OWNER_ID },
    } as any)

    const res = await deleteInventoryItem('item-1')
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authorized')
  })

  it('deletes item when owner', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    vi.mocked(prisma.inventoryItem.findUnique).mockResolvedValue({
      site: { userId: OWNER_ID },
    } as any)
    vi.mocked(prisma.inventoryItem.delete).mockResolvedValue({} as any)

    const res = await deleteInventoryItem('item-1')
    expect(res.status).toBe('ok')
    expect(vi.mocked(prisma.inventoryItem.delete)).toHaveBeenCalledWith({ where: { id: 'item-1' } })
  })
})

// ─── saveInventoryItemLocation ──────────────────────────────────────────────

describe('saveInventoryItemLocation', () => {
  it('rejects non-owner', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'other' } } as any)
    vi.mocked(prisma.inventoryItem.findUnique).mockResolvedValue({
      site: { userId: OWNER_ID },
    } as any)

    const res = await saveInventoryItemLocation('item-1', { locationLat: '10', locationLng: '20' })
    expect(res.status).toBe('error')
  })

  it('updates location and sets status to active', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    vi.mocked(prisma.inventoryItem.findUnique).mockResolvedValue({
      site: { userId: OWNER_ID },
    } as any)
    vi.mocked(prisma.inventoryItem.update).mockResolvedValue({} as any)

    const res = await saveInventoryItemLocation('item-1', { locationLat: '10.5', locationLng: '20.3' })
    expect(res.status).toBe('ok')

    const updateCall = vi.mocked(prisma.inventoryItem.update).mock.calls[0][0]
    expect(updateCall.data.status).toBe('active')
    expect(updateCall.data.locationLat).toBe('10.5')
    expect(updateCall.data.locationLng).toBe('20.3')
  })
})

// ─── deleteItemsByGroup ─────────────────────────────────────────────────────

describe('deleteItemsByGroup', () => {
  it('rejects non-owner', async () => {
    const res = await deleteItemsByGroup(SITE_ID, 3)
    expect(res.status).toBe('error')
  })

  it('deletes all items in the group', async () => {
    authorizeOwner()
    vi.mocked(prisma.inventoryItem.deleteMany).mockResolvedValue({ count: 4 } as any)

    const res = await deleteItemsByGroup(SITE_ID, 3)
    expect(vi.mocked(prisma.inventoryItem.deleteMany)).toHaveBeenCalledWith({
      where: { siteId: SITE_ID, group: 3 },
    })
  })
})
