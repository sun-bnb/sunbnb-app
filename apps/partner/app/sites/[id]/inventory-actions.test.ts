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
const OTHER_SITE_ID = 'site-other'

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
    expect(res.errors).toBeDefined()
  })

  it('auto-increments item number from last existing item', async () => {
    authorizeOwner()
    vi.mocked(prisma.inventoryItem.findFirst).mockResolvedValue({ number: 5 } as any)
    vi.mocked(prisma.inventoryItem.create).mockResolvedValue({ id: 'item-new', number: 6 } as any)

    const res = await createInventoryItem({ siteId: SITE_ID })
    expect(res.status).toBe('ok')

    const createCall = vi.mocked(prisma.inventoryItem.create).mock.calls[0][0]
    expect(createCall.data.number).toBe(6)
    expect(createCall.data.status).toBe('new')
    expect(createCall.data.locationLat).toBe('0')
    expect(createCall.data.locationLng).toBe('0')
  })

  it('starts at 1 when no existing items', async () => {
    authorizeOwner()
    vi.mocked(prisma.inventoryItem.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.inventoryItem.create).mockResolvedValue({ id: 'item-1' } as any)

    await createInventoryItem({ siteId: SITE_ID })
    const createCall = vi.mocked(prisma.inventoryItem.create).mock.calls[0][0]
    expect(createCall.data.number).toBe(1)
  })

  it('sets userId from session on created item', async () => {
    authorizeOwner()
    vi.mocked(prisma.inventoryItem.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.inventoryItem.create).mockResolvedValue({ id: 'item-1' } as any)

    await createInventoryItem({ siteId: SITE_ID })
    const createCall = vi.mocked(prisma.inventoryItem.create).mock.calls[0][0]
    expect(createCall.data.userId).toBe(OWNER_ID)
    expect(createCall.data.siteId).toBe(SITE_ID)
  })
})

// ─── deleteInventoryItem ────────────────────────────────────────────────────

describe('deleteInventoryItem', () => {
  it('rejects unauthenticated', async () => {
    const res = await deleteInventoryItem('item-1')
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authenticated')
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

  it('returns error when item does not exist', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    vi.mocked(prisma.inventoryItem.findUnique).mockResolvedValue(null)

    const res = await deleteInventoryItem('nonexistent')
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
  it('rejects unauthenticated', async () => {
    const res = await saveInventoryItemLocation('item-1', { locationLat: '10', locationLng: '20' })
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authenticated')
  })

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

// ─── saveInventoryItemProperties ────────────────────────────────────────────

describe('saveInventoryItemProperties', () => {
  it('rejects unauthenticated', async () => {
    const res = await saveInventoryItemProperties('item-1', { category: 'premium' })
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authenticated')
  })

  it('rejects non-owner', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'other' } } as any)
    vi.mocked(prisma.inventoryItem.findUnique).mockResolvedValue({
      site: { userId: OWNER_ID },
    } as any)

    const res = await saveInventoryItemProperties('item-1', { category: 'premium' })
    expect(res.status).toBe('error')
  })

  it('updates properties without pair', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    vi.mocked(prisma.inventoryItem.findUnique).mockResolvedValue({
      site: { userId: OWNER_ID },
    } as any)
    vi.mocked(prisma.inventoryItem.update).mockResolvedValue({} as any)

    const res = await saveInventoryItemProperties('item-1', {
      category: 'premium',
      price: 25,
      rotation: 45,
      number: 3,
      group: 1,
      label: 'A3',
      status: 'active',
    })
    expect(res.status).toBe('ok')

    const updateCall = vi.mocked(prisma.inventoryItem.update).mock.calls[0][0]
    expect(updateCall.data.category).toBe('premium')
    expect(updateCall.data.price).toBe(25)
    expect(updateCall.data.rotation).toBe(45)
    expect(updateCall.data.number).toBe(3)
    expect(updateCall.data.group).toBe(1)
    expect(updateCall.data.label).toBe('A3')
    expect(updateCall.data.status).toBe('active')
    expect(updateCall.data.pair).toBeUndefined()
  })

  it('connects pair item when pairId is provided and found', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    vi.mocked(prisma.inventoryItem.findUnique)
      .mockResolvedValueOnce({ site: { userId: OWNER_ID } } as any) // ownership lookup
      .mockResolvedValueOnce({ id: 'pair-1', siteId: SITE_ID } as any) // pair item lookup
      .mockResolvedValueOnce({ siteId: SITE_ID } as any) // current item siteId lookup for cross-site check
    vi.mocked(prisma.inventoryItem.update).mockResolvedValue({} as any)

    const res = await saveInventoryItemProperties('item-1', { pairId: 'pair-1' })
    expect(res.status).toBe('ok')

    const updateCall = vi.mocked(prisma.inventoryItem.update).mock.calls[0][0]
    expect(updateCall.data.pair).toEqual({ connect: { id: 'pair-1' } })
  })

  it('does not connect pair when pairId item is not found', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    vi.mocked(prisma.inventoryItem.findUnique)
      .mockResolvedValueOnce({ site: { userId: OWNER_ID } } as any) // ownership lookup
      .mockResolvedValueOnce(null) // pair item not found
    vi.mocked(prisma.inventoryItem.update).mockResolvedValue({} as any)

    const res = await saveInventoryItemProperties('item-1', { pairId: 'nonexistent' })
    expect(res.status).toBe('ok')

    const updateCall = vi.mocked(prisma.inventoryItem.update).mock.calls[0][0]
    expect(updateCall.data.pair).toBeUndefined()
  })

  // BUG: pairId from a different site should be rejected but isn't.
  // The code looks up the pair item but never checks pairItem.siteId === item.siteId.
  // This test documents the expected correct behavior and will FAIL against current code.
  it('should reject pairId belonging to a different site', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    vi.mocked(prisma.inventoryItem.findUnique)
      .mockResolvedValueOnce({ site: { userId: OWNER_ID }, siteId: SITE_ID } as any) // ownership lookup - item on SITE_ID
      .mockResolvedValueOnce({ id: 'cross-site-pair', siteId: OTHER_SITE_ID } as any) // pair item on OTHER_SITE_ID
    vi.mocked(prisma.inventoryItem.update).mockResolvedValue({} as any)

    const res = await saveInventoryItemProperties('item-1', { pairId: 'cross-site-pair' })

    // Correct behavior: should reject cross-site pairing
    expect(res.status).toBe('error')
    expect(res.errors).toBeDefined()
  })
})

// ─── deleteItemsByGroup ─────────────────────────────────────────────────────

describe('deleteItemsByGroup', () => {
  it('rejects non-owner', async () => {
    const res = await deleteItemsByGroup(SITE_ID, 3)
    expect(res.status).toBe('error')
    expect(res.errors).toBeDefined()
  })

  it('deletes all items in the group', async () => {
    authorizeOwner()
    vi.mocked(prisma.inventoryItem.deleteMany).mockResolvedValue({ count: 4 } as any)

    await deleteItemsByGroup(SITE_ID, 3)
    expect(vi.mocked(prisma.inventoryItem.deleteMany)).toHaveBeenCalledWith({
      where: { siteId: SITE_ID, group: 3 },
    })
  })

  // BUG: deleteItemsByGroup returns the raw Prisma deleteMany result ({ count: N })
  // instead of { status: 'ok' } like all other actions. This test documents the
  // expected correct behavior and will FAIL against current code.
  it('should return { status: "ok" } on success', async () => {
    authorizeOwner()
    vi.mocked(prisma.inventoryItem.deleteMany).mockResolvedValue({ count: 4 } as any)

    const res = await deleteItemsByGroup(SITE_ID, 3)
    expect(res.status).toBe('ok')
  })
})
