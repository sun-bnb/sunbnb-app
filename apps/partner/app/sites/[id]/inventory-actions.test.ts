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
  deleteInventoryItems,
  createInventoryItem,
  deleteInventoryItem,
  saveInventoryItemLocation,
  saveInventoryItemProperties,
  deleteItemsByGroup,
  pairInventoryItems,
  depairInventoryItem,
} from './inventory-actions'
import { auth } from '@/app/auth'
import { requireSiteOwner } from '@/lib/auth-helpers'
import prisma from '@repo/data/PrismaCient'
import { recomputeSeatLabels } from '@repo/data/seat-label-db'

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
    vi.mocked(prisma.sunbedGroup.create).mockResolvedValue({ id: 'unit-1' } as any)
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
    vi.mocked(prisma.sunbedGroup.create).mockResolvedValue({ id: 'unit-1' } as any)
    vi.mocked(prisma.inventoryItem.create).mockResolvedValue({ id: 'item-1' } as any)

    await createInventoryItem({ siteId: SITE_ID })
    const createCall = vi.mocked(prisma.inventoryItem.create).mock.calls[0][0]
    expect(createCall.data.number).toBe(1)
  })

  // Track 021 P2 (I1): a placed seat is never unitless. The unit is what a
  // device mounts to and what will carry the persisted label number, so it has
  // to exist from the moment the seat does — and in the SAME transaction, or a
  // seat could commit without one and nothing would repair it.
  it('mints a unit for the new seat and assigns it', async () => {
    authorizeOwner()
    vi.mocked(prisma.inventoryItem.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.sunbedGroup.create).mockResolvedValue({ id: 'unit-1' } as any)
    vi.mocked(prisma.inventoryItem.create).mockResolvedValue({ id: 'item-1' } as any)

    await createInventoryItem({ siteId: SITE_ID })

    expect(vi.mocked(prisma.sunbedGroup.create)).toHaveBeenCalledWith({
      data: { siteId: SITE_ID },
    })
    const createCall = vi.mocked(prisma.inventoryItem.create).mock.calls[0][0]
    expect(createCall.data.sunbedGroupId).toBe('unit-1')
  })

  it('sets userId from session on created item', async () => {
    authorizeOwner()
    vi.mocked(prisma.inventoryItem.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.sunbedGroup.create).mockResolvedValue({ id: 'unit-1' } as any)
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

  it('deletes item when owner and clears any partner pairId first', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    // First call: ownership check; second call: sunbedGroupId pre-fetch
    vi.mocked(prisma.inventoryItem.findUnique)
      .mockResolvedValueOnce({ site: { userId: OWNER_ID } } as any)
      .mockResolvedValueOnce({ sunbedGroupId: null } as any)
    vi.mocked(prisma.inventoryItem.updateMany).mockResolvedValue({ count: 0 } as any)
    vi.mocked(prisma.inventoryItem.delete).mockResolvedValue({} as any)

    const res = await deleteInventoryItem('item-1')
    expect(res.status).toBe('ok')
    // Delete runs inside a transaction that also clears any partner's pairId
    // pointing at this item — otherwise the FK constraint fails when a paired
    // sunbed is deleted.
    expect(vi.mocked(prisma.inventoryItem.updateMany)).toHaveBeenCalledWith({
      where: { pairId: 'item-1' },
      data: { pairId: null },
    })
    expect(vi.mocked(prisma.inventoryItem.delete)).toHaveBeenCalledWith({ where: { id: 'item-1' } })
  })

  it('detaches item from its SunbedGroup and deletes empty group on delete', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    const GROUP_ID = 'group-1'
    vi.mocked(prisma.inventoryItem.findUnique)
      .mockResolvedValueOnce({ site: { userId: OWNER_ID } } as any) // ownership
      .mockResolvedValueOnce({ sunbedGroupId: GROUP_ID } as any) // pre-fetch sunbedGroupId
    vi.mocked(prisma.inventoryItem.updateMany).mockResolvedValue({ count: 1 } as any)
    vi.mocked(prisma.inventoryItem.delete).mockResolvedValue({} as any)
    vi.mocked(prisma.inventoryItem.count).mockResolvedValue(0) // group is now empty
    vi.mocked(prisma.sunbedGroup.delete).mockResolvedValue({} as any)

    const res = await deleteInventoryItem('item-1')
    expect(res.status).toBe('ok')

    // Should clear sunbedGroupId on all siblings
    expect(vi.mocked(prisma.inventoryItem.updateMany)).toHaveBeenCalledWith(
      expect.objectContaining({ where: { sunbedGroupId: GROUP_ID } })
    )
    // Should delete the empty group
    expect(vi.mocked(prisma.sunbedGroup.delete)).toHaveBeenCalledWith({ where: { id: GROUP_ID } })
  })
})


// ─── deleteInventoryItems (bulk, track 020) ─────────────────────────────────

describe('deleteInventoryItems', () => {
  const setOwner = () =>
    mockRequireSiteOwner.mockResolvedValue({ session: { user: { id: OWNER_ID } }, error: null } as any)

  it('rejects when requireSiteOwner fails', async () => {
    mockRequireSiteOwner.mockResolvedValue({ session: null, error: 'Not authenticated' } as any)
    const res = await deleteInventoryItems(SITE_ID, ['i1'])
    expect(res.status).toBe('error')
    expect(vi.mocked(prisma.inventoryItem.findMany)).not.toHaveBeenCalled()
  })

  it('empty selection is an ok no-op — no queries, no label recompute', async () => {
    setOwner()
    const res = await deleteInventoryItems(SITE_ID, [])
    expect(res.status).toBe('ok')
    expect(vi.mocked(prisma.inventoryItem.findMany)).not.toHaveBeenCalled()
    expect(vi.mocked(recomputeSeatLabels)).not.toHaveBeenCalled()
  })

  it('scopes the row lookup to the site — foreign ids cannot be deleted', async () => {
    setOwner()
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([])
    const res = await deleteInventoryItems(SITE_ID, ['foreign-1'])
    expect(res.status).toBe('ok')
    expect(vi.mocked(prisma.inventoryItem.findMany)).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ['foreign-1'] }, siteId: SITE_ID } })
    )
    expect(vi.mocked(prisma.inventoryItem.deleteMany)).not.toHaveBeenCalled()
    expect(vi.mocked(recomputeSeatLabels)).not.toHaveBeenCalled()
  })

  it('deletes the whole selection in ONE transaction with ONE label recompute (the per-seat regression)', async () => {
    setOwner()
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([
      { id: 'i1', sunbedGroupId: 'g1' },
      { id: 'i2', sunbedGroupId: 'g1' },
      { id: 'i3', sunbedGroupId: null },
    ] as any)
    vi.mocked(prisma.$transaction).mockResolvedValueOnce([] as any)

    const res = await deleteInventoryItems(SITE_ID, ['i1', 'i2', 'i3'])
    expect(res).toEqual({ status: 'ok', deleted: 3 })

    expect(vi.mocked(prisma.$transaction)).toHaveBeenCalledTimes(1)
    // Group members detached, survivors' pairId cleared, one deleteMany, groups dissolved.
    expect(vi.mocked(prisma.inventoryItem.updateMany)).toHaveBeenCalledWith({
      where: { sunbedGroupId: { in: ['g1'] } },
      data: { sunbedGroupId: null },
    })
    expect(vi.mocked(prisma.inventoryItem.updateMany)).toHaveBeenCalledWith({
      where: { pairId: { in: ['i1', 'i2', 'i3'] } },
      data: { pairId: null },
    })
    expect(vi.mocked(prisma.inventoryItem.deleteMany)).toHaveBeenCalledWith({
      where: { id: { in: ['i1', 'i2', 'i3'] }, siteId: SITE_ID },
    })
    expect(vi.mocked(prisma.sunbedGroup.deleteMany)).toHaveBeenCalledWith({
      where: { id: { in: ['g1'] } },
    })
    // The founder-reported slowness: N seats must NOT mean N site-wide recomputes.
    expect(vi.mocked(recomputeSeatLabels)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(recomputeSeatLabels)).toHaveBeenCalledWith(SITE_ID)
  })

  it('skips group statements entirely for ungrouped seats', async () => {
    setOwner()
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([
      { id: 'i1', sunbedGroupId: null },
    ] as any)
    vi.mocked(prisma.$transaction).mockResolvedValueOnce([] as any)

    const res = await deleteInventoryItems(SITE_ID, ['i1'])
    expect(res).toEqual({ status: 'ok', deleted: 1 })
    expect(vi.mocked(prisma.inventoryItem.updateMany)).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: { sunbedGroupId: null } })
    )
    expect(vi.mocked(prisma.sunbedGroup.deleteMany)).not.toHaveBeenCalled()
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

  it('creates the SunbedGroup for a pairing request and connects NO pair relation', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    vi.mocked(prisma.inventoryItem.findUnique)
      .mockResolvedValueOnce({ siteId: SITE_ID, site: { userId: OWNER_ID } } as any) // ownership lookup (now selects siteId)
      .mockResolvedValueOnce({ id: 'pair-1', siteId: SITE_ID } as any) // pair item lookup
      // Dual-write: fetch sunbedGroupId for current item and pair (siteId reused, no re-fetch)
      .mockResolvedValueOnce({ sunbedGroupId: null } as any) // currentItem group check
      .mockResolvedValueOnce({ sunbedGroupId: null } as any) // currentPair group check
    vi.mocked(prisma.inventoryItem.update).mockResolvedValue({} as any)
    vi.mocked(prisma.inventoryItem.updateMany).mockResolvedValue({ count: 2 } as any)
    vi.mocked(prisma.sunbedGroup.create).mockResolvedValue({ id: 'group-new' } as any)

    const res = await saveInventoryItemProperties('item-1', { pairId: 'pair-1' })
    expect(res.status).toBe('ok')

    // Track 021 P1: connecting the `pair` relation writes pair_id just as surely
    // as assigning the column — the group below is the only representation.
    const updateCall = vi.mocked(prisma.inventoryItem.update).mock.calls[0][0]
    expect(updateCall.data.pair).toBeUndefined()

    // SunbedGroup should still be created — the pairing itself is preserved
    expect(vi.mocked(prisma.sunbedGroup.create)).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ siteId: SITE_ID }),
      })
    )
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

  // saveInventoryItemProperties validates that the pair item belongs to the same site —
  // pairItem.siteId !== item.siteId triggers a 'Pair item must belong to the same site' error.
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

// ─── pairInventoryItems ────────────────────────────────────────────────────

describe('pairInventoryItems', () => {
  it('rejects unauthenticated', async () => {
    const res = await pairInventoryItems('item-1', 'item-2')
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authenticated')
  })

  it('creates a SunbedGroup and writes NO pairId (track 021 P1)', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    vi.mocked(prisma.inventoryItem.findUnique)
      .mockResolvedValueOnce({ siteId: SITE_ID, site: { userId: OWNER_ID } } as any) // item1
      .mockResolvedValueOnce({ siteId: SITE_ID } as any) // item2
      // pre-fetch sunbedGroupId for both items
      .mockResolvedValueOnce({ sunbedGroupId: null } as any) // prior1
      .mockResolvedValueOnce({ sunbedGroupId: null } as any) // prior2
    vi.mocked(prisma.inventoryItem.updateMany).mockResolvedValue({ count: 2 } as any)
    vi.mocked(prisma.sunbedGroup.create).mockResolvedValue({ id: 'group-new' } as any)

    const res = await pairInventoryItems('item-1', 'item-2')
    expect(res.status).toBe('ok')

    // The SunbedGroup IS the pairing now — nothing writes the legacy column.
    // (Regression guard for the P1 retirement: a reintroduced dual-write here
    // would quietly resurrect the second representation this track removes.)
    expect(vi.mocked(prisma.inventoryItem.update)).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ pairId: expect.anything() }) })
    )

    // SunbedGroup created with siteId
    expect(vi.mocked(prisma.sunbedGroup.create)).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ siteId: SITE_ID }),
      })
    )
  })

  it('detaches both items from prior groups before creating new group', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    const OLD_GROUP = 'old-group-1'
    vi.mocked(prisma.inventoryItem.findUnique)
      .mockResolvedValueOnce({ siteId: SITE_ID, site: { userId: OWNER_ID } } as any)
      .mockResolvedValueOnce({ siteId: SITE_ID } as any)
      .mockResolvedValueOnce({ sunbedGroupId: OLD_GROUP } as any)
      .mockResolvedValueOnce({ sunbedGroupId: null } as any)
    vi.mocked(prisma.inventoryItem.count).mockResolvedValue(0) // old group empty after detach
    vi.mocked(prisma.inventoryItem.updateMany).mockResolvedValue({ count: 1 } as any)
    vi.mocked(prisma.sunbedGroup.create).mockResolvedValue({ id: 'group-new' } as any)
    vi.mocked(prisma.sunbedGroup.delete).mockResolvedValue({} as any)

    const res = await pairInventoryItems('item-1', 'item-2')
    expect(res.status).toBe('ok')

    // Old group should be deleted
    expect(vi.mocked(prisma.sunbedGroup.delete)).toHaveBeenCalledWith({ where: { id: OLD_GROUP } })
  })
})

// ─── depairInventoryItem ──────────────────────────────────────────────────

describe('depairInventoryItem', () => {
  it('rejects unauthenticated', async () => {
    const res = await depairInventoryItem('item-1')
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authenticated')
  })

  it('clears pairId on both items and deletes the SunbedGroup', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    const GROUP_ID = 'group-1'
    vi.mocked(prisma.inventoryItem.findUnique).mockResolvedValue({
      pairId: 'item-2',
      sunbedGroupId: GROUP_ID,
      site: { userId: OWNER_ID },
    } as any)
    vi.mocked(prisma.inventoryItem.updateMany).mockResolvedValue({ count: 2 } as any)
    vi.mocked(prisma.inventoryItem.count).mockResolvedValue(0) // group empty after clearing
    vi.mocked(prisma.sunbedGroup.delete).mockResolvedValue({} as any)
    vi.mocked(prisma.inventoryItem.update).mockResolvedValue({} as any)

    const res = await depairInventoryItem('item-1')
    expect(res.status).toBe('ok')

    // Clears sunbedGroupId on all group members
    expect(vi.mocked(prisma.inventoryItem.updateMany)).toHaveBeenCalledWith({
      where: { sunbedGroupId: GROUP_ID },
      data: { sunbedGroupId: null },
    })
    // Deletes the empty group
    expect(vi.mocked(prisma.sunbedGroup.delete)).toHaveBeenCalledWith({ where: { id: GROUP_ID } })

    // Clears pairId in both directions (item, its forward target, and anything pointing at it)
    expect(vi.mocked(prisma.inventoryItem.updateMany)).toHaveBeenCalledWith({
      where: { OR: [{ id: 'item-1' }, { pairId: 'item-1' }, { id: 'item-2' }] },
      data: { pairId: null },
    })
  })

  it('clears the pair when depairing the SECONDARY bed (pairId null, linked via pairedBy)', async () => {
    // One-directional pairs (bulk-generated) hold pairId only on the primary.
    // Depairing the secondary must still clear the primary's pairId via the
    // reverse `{ pairId: <secondary> }` branch — otherwise the pair survives.
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    vi.mocked(prisma.inventoryItem.findUnique).mockResolvedValue({
      pairId: null,
      sunbedGroupId: 'group-9',
      site: { userId: OWNER_ID },
    } as any)
    vi.mocked(prisma.inventoryItem.updateMany).mockResolvedValue({ count: 1 } as any)
    vi.mocked(prisma.inventoryItem.count).mockResolvedValue(0)
    vi.mocked(prisma.sunbedGroup.delete).mockResolvedValue({} as any)

    const res = await depairInventoryItem('secondary-id')
    expect(res.status).toBe('ok')
    // No forward target (pairId null), but the reverse pointer is cleared
    expect(vi.mocked(prisma.inventoryItem.updateMany)).toHaveBeenCalledWith({
      where: { OR: [{ id: 'secondary-id' }, { pairId: 'secondary-id' }] },
      data: { pairId: null },
    })
  })

  it('does not crash when item has no SunbedGroup (legacy item)', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    vi.mocked(prisma.inventoryItem.findUnique).mockResolvedValue({
      pairId: 'item-2',
      sunbedGroupId: null,
      site: { userId: OWNER_ID },
    } as any)
    vi.mocked(prisma.inventoryItem.updateMany).mockResolvedValue({ count: 2 } as any)

    const res = await depairInventoryItem('item-1')
    expect(res.status).toBe('ok')
    expect(vi.mocked(prisma.sunbedGroup.delete)).not.toHaveBeenCalled()
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

  // deleteItemsByGroup returns the standard { status: 'ok' } shape on success,
  // consistent with all other partner server actions.
  it('should return { status: "ok" } on success', async () => {
    authorizeOwner()
    vi.mocked(prisma.inventoryItem.deleteMany).mockResolvedValue({ count: 4 } as any)

    const res = await deleteItemsByGroup(SITE_ID, 3)
    expect(res.status).toBe('ok')
  })
})
