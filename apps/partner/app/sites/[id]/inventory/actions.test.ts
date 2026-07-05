import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/auth', () => ({
  auth: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/auth-helpers', () => ({
  requireSiteOwner: vi.fn().mockResolvedValue({ session: null, error: 'Not authenticated' }),
}))

vi.mock('@repo/data/seat-label-db', () => ({
  recomputeSeatLabels: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

import {
  moveItems,
  moveParcel,
  rotateSelection,
  reverseParcelNumbering,
  reverseParcelOrientation,
  adjustItemSpacing,
  syncChairsWithLayout,
  setItemStatusByGroup,
  getItemGroup,
  assignItemsToGroup,
  removeItemsFromGroup,
} from './actions'
import { requireSiteOwner } from '@/lib/auth-helpers'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import { revalidatePath } from 'next/cache'
import { recomputeSeatLabels } from '@repo/data/seat-label-db'

const mockRequireSiteOwner = vi.mocked(requireSiteOwner)
const mockAuth = vi.mocked(auth)
const SITE_ID = 'site-1'
const OWNER_ID = 'owner-1'
const OTHER_ID = 'other-2'

beforeEach(() => {
  vi.clearAllMocks()
  // IMPORTANT: clearAllMocks clears call history but NOT implementations —
  // reset both auth and requireSiteOwner explicitly to prevent leaks.
  mockAuth.mockResolvedValue(null)
  mockRequireSiteOwner.mockResolvedValue({
    session: { user: { id: 'owner-1' } },
    error: null,
  })
})

function setLayoutMode(mode: 'geo' | 'schematic') {
  vi.mocked(prisma.site.findUnique).mockResolvedValue({ layoutMode: mode } as any)
}

// ─── moveItems schematic branch ────────────────────────────────────────────

describe('moveItems (schematic mode)', () => {
  it('updates schematicX/Y instead of locationLat/Lng', async () => {
    setLayoutMode('schematic')
    vi.mocked(prisma.inventoryItem.findMany)
      .mockResolvedValueOnce([
        { id: 'i1', locationLat: '0', locationLng: '0', schematicX: 10, schematicY: 5 },
        { id: 'i2', locationLat: '0', locationLng: '0', schematicX: 12, schematicY: 5 },
      ] as any)
      .mockResolvedValueOnce([{ group: 1, itemGroupId: null }, { group: 1, itemGroupId: null }] as any)
    vi.mocked(prisma.inventoryItem.update).mockResolvedValue({} as any)

    // deltaLat=2 (north meters), deltaLng=3 (east meters) for schematic
    const res = await moveItems(SITE_ID, ['i1', 'i2'], 2, 3)
    expect(res.status).toBe('ok')

    const calls = vi.mocked(prisma.inventoryItem.update).mock.calls
    expect(calls).toHaveLength(2)
    expect(calls[0][0].data).toEqual({ schematicX: 13, schematicY: 7 })
    expect(calls[1][0].data).toEqual({ schematicX: 15, schematicY: 7 })
  })

  it('returns ok with empty itemIds', async () => {
    const res = await moveItems(SITE_ID, [], 1, 1)
    expect(res.status).toBe('ok')
  })
})

// ─── moveParcel schematic branch ───────────────────────────────────────────

describe('moveParcel (schematic mode)', () => {
  it('shifts every item in the group by delta meters', async () => {
    setLayoutMode('schematic')
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValueOnce([
      { id: 'i1', locationLat: '0', locationLng: '0', schematicX: 5, schematicY: 5, itemGroupId: 'g-1' },
      { id: 'i2', locationLat: '0', locationLng: '0', schematicX: 6, schematicY: 5, itemGroupId: 'g-1' },
    ] as any)
    vi.mocked(prisma.inventoryItem.update).mockResolvedValue({} as any)
    vi.mocked(prisma.itemGroup.findUnique).mockResolvedValue({
      schematicX: 5,
      schematicY: 5,
      locationLat: '0',
      locationLng: '0',
    } as any)
    vi.mocked(prisma.itemGroup.update).mockResolvedValue({} as any)

    const res = await moveParcel(SITE_ID, 1, 4, -2)
    expect(res.status).toBe('ok')

    const calls = vi.mocked(prisma.inventoryItem.update).mock.calls
    expect(calls[0][0].data).toEqual({ schematicX: 3, schematicY: 9 })
    expect(calls[1][0].data).toEqual({ schematicX: 4, schematicY: 9 })

    const groupUpdate = vi.mocked(prisma.itemGroup.update).mock.calls[0][0]
    expect(groupUpdate.data).toEqual({ schematicX: 3, schematicY: 9 })
  })
})

// ─── moveItems geo branch (regression) ────────────────────────────────────

describe('moveItems (geo mode)', () => {
  it('updates locationLat/Lng strings', async () => {
    setLayoutMode('geo')
    vi.mocked(prisma.inventoryItem.findMany)
      .mockResolvedValueOnce([
        { id: 'i1', locationLat: '40.0', locationLng: '-3.0', schematicX: null, schematicY: null },
      ] as any)
      .mockResolvedValueOnce([{ group: 1, itemGroupId: null }] as any)
    vi.mocked(prisma.inventoryItem.update).mockResolvedValue({} as any)

    const res = await moveItems(SITE_ID, ['i1'], 0.001, 0.002)
    expect(res.status).toBe('ok')
    const data = vi.mocked(prisma.inventoryItem.update).mock.calls[0][0].data as any
    expect(data.locationLat).toBe('40.001')
    expect(data.locationLng).toBe('-2.998')
  })
})

// ─── rotateSelection schematic branch ─────────────────────────────────────

describe('rotateSelection (schematic mode)', () => {
  it('rotates two items 90° around their centroid in meters', async () => {
    setLayoutMode('schematic')
    vi.mocked(prisma.inventoryItem.findMany)
      .mockResolvedValueOnce([
        { id: 'i1', locationLat: '0', locationLng: '0', schematicX: 0, schematicY: 0, rotation: 0 },
        { id: 'i2', locationLat: '0', locationLng: '0', schematicX: 2, schematicY: 0, rotation: 0 },
      ] as any)
      .mockResolvedValueOnce([{ itemGroupId: null }, { itemGroupId: null }] as any)
    vi.mocked(prisma.inventoryItem.update).mockResolvedValue({} as any)

    const res = await rotateSelection(SITE_ID, ['i1', 'i2'], 90)
    expect(res.status).toBe('ok')

    const calls = vi.mocked(prisma.inventoryItem.update).mock.calls
    expect(calls).toHaveLength(2)

    const d1 = calls[0][0].data as any
    const d2 = calls[1][0].data as any
    // Centroid: (1, 0). After 90° rotation around (1,0):
    //   (0,0) -> (1, -1),  (2,0) -> (1, 1)  — using the function's convention.
    expect(d1.rotation).toBe(90)
    expect(d2.rotation).toBe(90)
    expect(Math.round(d1.schematicX)).toBe(1)
    expect(Math.round(d2.schematicX)).toBe(1)
    // Y values must differ (items orbited)
    expect(Math.round(d1.schematicY)).not.toBe(Math.round(d2.schematicY))
  })
})

// ─── reverseParcelNumbering ────────────────────────────────────────────────

describe('reverseParcelNumbering', () => {
  it('rejects unauthenticated callers', async () => {
    mockRequireSiteOwner.mockResolvedValueOnce({ session: null, error: 'Not authenticated' } as any)
    const res = await reverseParcelNumbering(SITE_ID, 1)
    expect(res).toEqual({ status: 'error', errors: ['Not authenticated'] })
    expect(vi.mocked(prisma.inventoryItem.findMany)).not.toHaveBeenCalled()
  })

  it('returns ok with no items (empty parcel)', async () => {
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValueOnce([] as any)
    const res = await reverseParcelNumbering(SITE_ID, 1)
    expect(res.status).toBe('ok')
    expect(vi.mocked(prisma.$transaction)).not.toHaveBeenCalled()
  })

  it('reverses seat numbers in a single-row parcel without moving beds', async () => {
    // Group 1, row 1 has 3 seats: numbers 10101, 10102, 10103
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValueOnce([
      { id: 'a', number: 10101 },
      { id: 'b', number: 10102 },
      { id: 'c', number: 10103 },
    ] as any)
    vi.mocked(prisma.inventoryItem.update).mockResolvedValue({} as any)

    const res = await reverseParcelNumbering(SITE_ID, 1)
    expect(res.status).toBe('ok')

    const updateCalls = vi.mocked(prisma.inventoryItem.update).mock.calls
    expect(updateCalls).toHaveLength(3)

    // Build a map of id -> new number from the update calls
    const result = new Map(updateCalls.map(c => [c[0].where.id, (c[0].data as any).number]))
    // Reversal: seat 1→3, 2→2, 3→1 (suffix swapped)
    expect(result.get('a')).toBe(10103)
    expect(result.get('b')).toBe(10102)
    expect(result.get('c')).toBe(10101)
  })

  it('reverses each row independently in a multi-row parcel', async () => {
    // Group 1, row 1: seats 10101, 10102; row 2: seats 10201, 10202
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValueOnce([
      { id: 'r1s1', number: 10101 },
      { id: 'r1s2', number: 10102 },
      { id: 'r2s1', number: 10201 },
      { id: 'r2s2', number: 10202 },
    ] as any)
    vi.mocked(prisma.inventoryItem.update).mockResolvedValue({} as any)

    const res = await reverseParcelNumbering(SITE_ID, 1)
    expect(res.status).toBe('ok')

    const updateCalls = vi.mocked(prisma.inventoryItem.update).mock.calls
    expect(updateCalls).toHaveLength(4)

    const result = new Map(updateCalls.map(c => [c[0].where.id, (c[0].data as any).number]))
    // Row 1 reversed: r1s1 gets seat 02, r1s2 gets seat 01
    expect(result.get('r1s1')).toBe(10102)
    expect(result.get('r1s2')).toBe(10101)
    // Row 2 reversed independently: r2s1 gets seat 02, r2s2 gets seat 01
    expect(result.get('r2s1')).toBe(10202)
    expect(result.get('r2s2')).toBe(10201)
  })

  it('preserves coordinates and rotation — only number changes', async () => {
    // Confirm the update data only contains `number` — no lat/lng, schematic
    // coords, or rotation are written.
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValueOnce([
      { id: 'x', number: 10101 },
      { id: 'y', number: 10102 },
    ] as any)
    vi.mocked(prisma.inventoryItem.update).mockResolvedValue({} as any)

    await reverseParcelNumbering(SITE_ID, 1)

    const updateCalls = vi.mocked(prisma.inventoryItem.update).mock.calls
    for (const call of updateCalls) {
      const data = call[0].data as Record<string, unknown>
      // Only `number` should be written — no lat/lng, schematic coords, or rotation
      expect(Object.keys(data)).toEqual(['number'])
    }
  })
})

// ─── reverseParcelOrientation ──────────────────────────────────────────────

describe('reverseParcelOrientation', () => {
  it('rejects unauthenticated callers', async () => {
    mockRequireSiteOwner.mockResolvedValueOnce({ session: null, error: 'Not authenticated' } as any)
    const res = await reverseParcelOrientation(SITE_ID, 1)
    expect(res).toEqual({ status: 'error', errors: ['Not authenticated'] })
    expect(vi.mocked(prisma.inventoryItem.findMany)).not.toHaveBeenCalled()
  })

  it('returns ok with no items (empty parcel)', async () => {
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValueOnce([] as any)
    const res = await reverseParcelOrientation(SITE_ID, 1)
    expect(res.status).toBe('ok')
    expect(vi.mocked(prisma.$transaction)).not.toHaveBeenCalled()
  })

  it('adds 180° to each seat, normalised into [0, 360)', async () => {
    // 0 → 180, 90 → 270, 270 → 90 (wraps), 180 → 0 (wraps)
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValueOnce([
      { id: 'a', rotation: 0 },
      { id: 'b', rotation: 90 },
      { id: 'c', rotation: 270 },
      { id: 'd', rotation: 180 },
    ] as any)
    vi.mocked(prisma.inventoryItem.update).mockResolvedValue({} as any)

    const res = await reverseParcelOrientation(SITE_ID, 1)
    expect(res.status).toBe('ok')

    const updateCalls = vi.mocked(prisma.inventoryItem.update).mock.calls
    const result = new Map(updateCalls.map(c => [c[0].where.id, (c[0].data as any).rotation]))
    expect(result.get('a')).toBe(180)
    expect(result.get('b')).toBe(270)
    expect(result.get('c')).toBe(90)
    expect(result.get('d')).toBe(0)
  })

  it('treats a null rotation as 0 → 180', async () => {
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValueOnce([
      { id: 'a', rotation: null },
    ] as any)
    vi.mocked(prisma.inventoryItem.update).mockResolvedValue({} as any)

    await reverseParcelOrientation(SITE_ID, 1)

    const updateCalls = vi.mocked(prisma.inventoryItem.update).mock.calls
    expect((updateCalls[0]![0].data as any).rotation).toBe(180)
  })

  it('writes only rotation — coordinates and number untouched', async () => {
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValueOnce([
      { id: 'x', rotation: 45 },
    ] as any)
    vi.mocked(prisma.inventoryItem.update).mockResolvedValue({} as any)

    await reverseParcelOrientation(SITE_ID, 1)

    const updateCalls = vi.mocked(prisma.inventoryItem.update).mock.calls
    for (const call of updateCalls) {
      expect(Object.keys(call[0].data as Record<string, unknown>)).toEqual(['rotation'])
    }
  })
})

// ─── adjustItemSpacing ─────────────────────────────────────────────────────────
//
// BUG REPORT: adjustItemSpacing has no guard against factor <= 0.
// - factor=0 collapses ALL items onto the centroid (all offsets multiplied by 0).
// - factor<0 mirrors items across the centroid axis (inverts layout).
// Neither is a meaningful spacing operation; both corrupt item coordinates in
// ways that are not reversible by the user (they cannot "undo" to pre-collapse).
// The tests below are RED because the source does not reject these inputs.

describe('adjustItemSpacing — factor guard (non-positive factor rejected before any DB read)', () => {
  it('factor=0 is rejected with an error containing "factor"', async () => {
    // factor=0 would collapse all items onto the centroid — coordinates
    // cannot be recovered. Guard fires before requireSiteOwner / DB reads,
    // so no DB mocks are needed here.
    const result = await adjustItemSpacing(SITE_ID, ['i1', 'i2'], 'horizontal', 0)
    expect(result).toEqual({ status: 'error', errors: [expect.stringContaining('factor')] })
    expect(vi.mocked(prisma.inventoryItem.findMany)).not.toHaveBeenCalled()
  })

  it('factor < 0 (negative) is rejected with an error containing "factor"', async () => {
    // factor<0 mirrors items across the centroid axis — same irreversible corruption.
    const result = await adjustItemSpacing(SITE_ID, ['i1', 'i2'], 'horizontal', -1)
    expect(result).toEqual({ status: 'error', errors: [expect.stringContaining('factor')] })
    expect(vi.mocked(prisma.inventoryItem.findMany)).not.toHaveBeenCalled()
  })
})

describe('adjustItemSpacing — auth rejection', () => {
  it('returns error when not authenticated', async () => {
    mockRequireSiteOwner.mockResolvedValueOnce({ session: null, error: 'Not authenticated' } as any)
    const result = await adjustItemSpacing(SITE_ID, ['i1', 'i2'], 'horizontal', 1.5)
    expect(result).toEqual({ status: 'error', errors: ['Not authenticated'] })
    expect(vi.mocked(prisma.inventoryItem.findMany)).not.toHaveBeenCalled()
  })

  it('returns error when not the site owner', async () => {
    mockRequireSiteOwner.mockResolvedValueOnce({ session: null, error: 'Not authorized' } as any)
    const result = await adjustItemSpacing(SITE_ID, ['i1', 'i2'], 'horizontal', 1.5)
    expect(result).toEqual({ status: 'error', errors: ['Not authorized'] })
  })
})

describe('adjustItemSpacing — happy path (schematic, factor > 0)', () => {
  it('returns ok with fewer than 2 itemIds without touching DB', async () => {
    const result = await adjustItemSpacing(SITE_ID, ['only-one'], 'horizontal', 2)
    expect(result).toEqual({ status: 'ok' })
    expect(vi.mocked(prisma.inventoryItem.findMany)).not.toHaveBeenCalled()
  })

  it('returns ok with empty itemIds without touching DB', async () => {
    const result = await adjustItemSpacing(SITE_ID, [], 'horizontal', 2)
    expect(result).toEqual({ status: 'ok' })
    expect(vi.mocked(prisma.inventoryItem.findMany)).not.toHaveBeenCalled()
  })

  it('spreads items horizontally when factor > 1 (schematic, zero rotation)', async () => {
    // Two items at x=0 and x=4, centroid at x=2, rotation=0.
    // axis=horizontal, factor=2:
    //   i1 offset from centroid: dX=-2, after factor: dX=-4 → newX = 2 + (-4) = -2
    //   i2 offset from centroid: dX=+2, after factor: dX=+4 → newX = 2 + 4 = 6
    vi.mocked(prisma.site.findUnique).mockResolvedValue({ layoutMode: 'schematic' } as any)
    vi.mocked(prisma.inventoryItem.findMany)
      .mockResolvedValueOnce([
        { id: 'i1', locationLat: '0', locationLng: '0', schematicX: 0, schematicY: 0, rotation: 0 },
        { id: 'i2', locationLat: '0', locationLng: '0', schematicX: 4, schematicY: 0, rotation: 0 },
      ] as any)
      .mockResolvedValueOnce([{ itemGroupId: null }, { itemGroupId: null }] as any)
    vi.mocked(prisma.inventoryItem.update).mockResolvedValue({} as any)

    const result = await adjustItemSpacing(SITE_ID, ['i1', 'i2'], 'horizontal', 2)
    expect(result).toEqual({ status: 'ok' })

    const calls = vi.mocked(prisma.inventoryItem.update).mock.calls
    expect(calls).toHaveLength(2)

    // i1: centroid x=2, offset x=-2, factor=2 → new offset=-4, newX=-2
    const d1 = calls[0][0].data as any
    expect(d1.schematicX).toBeCloseTo(-2, 5)
    // Y axis is untouched (vertical axis not scaled)
    expect(d1.schematicY).toBeCloseTo(0, 5)

    // i2: centroid x=2, offset x=+2, factor=2 → new offset=+4, newX=6
    const d2 = calls[1][0].data as any
    expect(d2.schematicX).toBeCloseTo(6, 5)
    expect(d2.schematicY).toBeCloseTo(0, 5)
  })

  it('squeezes items vertically when factor < 1 (schematic, zero rotation)', async () => {
    // Two items at y=0 and y=6, centroid at y=3, rotation=0.
    // axis=vertical, factor=0.5:
    //   i1 offset from centroid: dY=-3, after factor: dY=-1.5 → newY = 3 + (-1.5) = 1.5
    //   i2 offset from centroid: dY=+3, after factor: dY=+1.5 → newY = 3 + 1.5 = 4.5
    vi.mocked(prisma.site.findUnique).mockResolvedValue({ layoutMode: 'schematic' } as any)
    vi.mocked(prisma.inventoryItem.findMany)
      .mockResolvedValueOnce([
        { id: 'i1', locationLat: '0', locationLng: '0', schematicX: 0, schematicY: 0, rotation: 0 },
        { id: 'i2', locationLat: '0', locationLng: '0', schematicX: 0, schematicY: 6, rotation: 0 },
      ] as any)
      .mockResolvedValueOnce([{ itemGroupId: null }, { itemGroupId: null }] as any)
    vi.mocked(prisma.inventoryItem.update).mockResolvedValue({} as any)

    const result = await adjustItemSpacing(SITE_ID, ['i1', 'i2'], 'vertical', 0.5)
    expect(result).toEqual({ status: 'ok' })

    const calls = vi.mocked(prisma.inventoryItem.update).mock.calls
    const d1 = calls[0][0].data as any
    const d2 = calls[1][0].data as any
    expect(d1.schematicY).toBeCloseTo(1.5, 5)
    expect(d2.schematicY).toBeCloseTo(4.5, 5)
  })
})

// ─── syncChairsWithLayout ──────────────────────────────────────────────────────
//
// BUG REPORT 1: syncChairsWithLayout has no input validation for ChairConfig.
// - Negative price flows directly to the DB without rejection.
// - rows=0 or seatsPerRow=0 generates 0 items (silent no-op instead of error).
// - Negative gap values flow to generateChairGrid unchecked.
//
// BUG REPORT 2: syncChairsWithLayout does NOT call revalidatePath() after
// mutating the DB. The site context will not refresh in the UI after a create
// or rearrange. Other mutating actions (e.g. deleteItemsByGroup) do call
// revalidatePath; the omission here is inconsistent.

describe('syncChairsWithLayout — auth rejection', () => {
  it('returns error when not authenticated', async () => {
    mockRequireSiteOwner.mockResolvedValueOnce({ session: null, error: 'Not authenticated' } as any)
    const result = await syncChairsWithLayout(
      SITE_ID,
      { group: 1, rows: 1, seatsPerRow: 2, baseLat: 60.1, baseLng: 24.9,
        horizontalGap: 2.5, verticalGap: 2.5, intraPairGap: 0.3, rotation: 0,
        price: 25, category: 'sunbed', pairSeats: false },
      'create',
    )
    expect(result).toEqual({ status: 'error', errors: ['Not authenticated'] })
    expect(vi.mocked(prisma.itemGroup.create)).not.toHaveBeenCalled()
  })
})

describe('syncChairsWithLayout — ChairConfig validation (BUG: unvalidated inputs)', () => {
  it('negative price should be rejected but currently flows to the DB (BUG)', async () => {
    // Price is stored on the DB item without any validation in the action.
    // This test will be RED until a price >= 0 guard is added to syncChairsWithLayout.
    mockRequireSiteOwner.mockResolvedValue({ session: { user: { id: OWNER_ID } }, error: null } as any)
    vi.mocked(prisma.site.findUnique).mockResolvedValue({ layoutMode: 'geo' } as any)
    vi.mocked(prisma.itemGroup.create).mockResolvedValue({ id: 'g-1' } as any)
    vi.mocked(prisma.inventoryItem.create).mockResolvedValue({} as any)
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([] as any)

    const result = await syncChairsWithLayout(
      SITE_ID,
      { group: 1, rows: 1, seatsPerRow: 1, baseLat: 60.1, baseLng: 24.9,
        horizontalGap: 2.5, verticalGap: 2.5, intraPairGap: 0.3, rotation: 0,
        price: -10, category: 'sunbed', pairSeats: false },
      'create',
    )

    // BUG: source does not guard against negative price — it returns undefined
    // (no explicit return on the create branch) and writes price=-10 to the DB.
    // When the guard is added this should return an error instead.
    expect(result).toEqual({ status: 'error', errors: [expect.stringMatching(/price/i)] })
  })

  it('rows=0 should be rejected but currently silently creates an empty group (BUG)', async () => {
    mockRequireSiteOwner.mockResolvedValue({ session: { user: { id: OWNER_ID } }, error: null } as any)
    vi.mocked(prisma.site.findUnique).mockResolvedValue({ layoutMode: 'geo' } as any)
    vi.mocked(prisma.itemGroup.create).mockResolvedValue({ id: 'g-1' } as any)
    vi.mocked(prisma.inventoryItem.create).mockResolvedValue({} as any)
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([] as any)

    const result = await syncChairsWithLayout(
      SITE_ID,
      { group: 1, rows: 0, seatsPerRow: 2, baseLat: 60.1, baseLng: 24.9,
        horizontalGap: 2.5, verticalGap: 2.5, intraPairGap: 0.3, rotation: 0,
        price: 25, category: 'sunbed', pairSeats: false },
      'create',
    )

    // BUG: rows=0 generates 0 items; the action still calls itemGroup.create
    // and returns undefined without reporting an error.
    expect(result).toEqual({ status: 'error', errors: [expect.stringMatching(/rows/i)] })
  })

  it('seatsPerRow=0 should be rejected but currently silently creates an empty group (BUG)', async () => {
    mockRequireSiteOwner.mockResolvedValue({ session: { user: { id: OWNER_ID } }, error: null } as any)
    vi.mocked(prisma.site.findUnique).mockResolvedValue({ layoutMode: 'geo' } as any)
    vi.mocked(prisma.itemGroup.create).mockResolvedValue({ id: 'g-1' } as any)
    vi.mocked(prisma.inventoryItem.create).mockResolvedValue({} as any)
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([] as any)

    const result = await syncChairsWithLayout(
      SITE_ID,
      { group: 1, rows: 2, seatsPerRow: 0, baseLat: 60.1, baseLng: 24.9,
        horizontalGap: 2.5, verticalGap: 2.5, intraPairGap: 0.3, rotation: 0,
        price: 25, category: 'sunbed', pairSeats: false },
      'create',
    )

    // BUG: same as rows=0 — silently creates empty group.
    expect(result).toEqual({ status: 'error', errors: [expect.stringMatching(/seats/i)] })
  })
})

describe('syncChairsWithLayout — calls revalidatePath after mutation', () => {
  it('calls revalidatePath after create so the site context refreshes', async () => {
    vi.mocked(prisma.site.findUnique).mockResolvedValue({ layoutMode: 'geo' } as any)
    vi.mocked(prisma.itemGroup.create).mockResolvedValue({ id: 'g-1' } as any)
    vi.mocked(prisma.inventoryItem.create).mockResolvedValue({} as any)
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([] as any)

    await syncChairsWithLayout(
      SITE_ID,
      { group: 1, rows: 1, seatsPerRow: 1, baseLat: 60.1, baseLng: 24.9,
        horizontalGap: 2.5, verticalGap: 2.5, intraPairGap: 0.3, rotation: 0,
        price: 25, category: 'sunbed', pairSeats: false },
      'create',
    )

    expect(vi.mocked(revalidatePath)).toHaveBeenCalled()
  })
})

describe('syncChairsWithLayout — happy path (geo mode, create)', () => {
  it('creates an itemGroup and inventory items for each generated chair', async () => {
    vi.mocked(prisma.site.findUnique).mockResolvedValue({ layoutMode: 'geo' } as any)
    vi.mocked(prisma.itemGroup.create).mockResolvedValue({ id: 'g-1' } as any)
    vi.mocked(prisma.inventoryItem.create).mockResolvedValue({} as any)
    // assignChairPairings calls findMany for the group items
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([] as any)

    const result = await syncChairsWithLayout(
      SITE_ID,
      { group: 1, rows: 1, seatsPerRow: 2, baseLat: 60.1, baseLng: 24.9,
        horizontalGap: 2.5, verticalGap: 2.5, intraPairGap: 0.3, rotation: 0,
        price: 25, category: 'sunbed', pairSeats: false },
      'create',
    )

    // syncChairsWithLayout does not have an explicit return on the create branch;
    // it returns undefined (void). The important check is that the DB writes ran.
    expect(vi.mocked(prisma.itemGroup.create)).toHaveBeenCalledOnce()
    // rows=1, seatsPerRow=2 → 2 chairs created
    expect(vi.mocked(prisma.inventoryItem.create)).toHaveBeenCalledTimes(2)
    // Each item is created with the correct siteId and price
    const createCalls = vi.mocked(prisma.inventoryItem.create).mock.calls
    for (const call of createCalls) {
      expect(call[0].data.siteId).toBe(SITE_ID)
      expect(call[0].data.price).toBe(25)
    }
    // The action returns undefined on the happy path (no explicit return)
    expect(result).toBeUndefined()
  })
})

// ─── rotateSelection — additional coverage beyond existing tests ───────────────

describe('rotateSelection — auth rejection', () => {
  it('returns error when not authenticated', async () => {
    mockRequireSiteOwner.mockResolvedValueOnce({ session: null, error: 'Not authenticated' } as any)
    const result = await rotateSelection(SITE_ID, ['i1'], 90)
    expect(result).toEqual({ status: 'error', errors: ['Not authenticated'] })
    expect(vi.mocked(prisma.inventoryItem.findMany)).not.toHaveBeenCalled()
  })
})

describe('rotateSelection — early-return paths', () => {
  it('returns ok immediately when itemIds is empty (no DB access)', async () => {
    const result = await rotateSelection(SITE_ID, [], 90)
    expect(result).toEqual({ status: 'ok' })
    expect(vi.mocked(prisma.site.findUnique)).not.toHaveBeenCalled()
    expect(vi.mocked(prisma.inventoryItem.findMany)).not.toHaveBeenCalled()
  })

  it('returns ok when DB finds no items matching the provided ids (empty result)', async () => {
    vi.mocked(prisma.site.findUnique).mockResolvedValue({ layoutMode: 'schematic' } as any)
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValueOnce([] as any)

    const result = await rotateSelection(SITE_ID, ['nonexistent'], 45)
    expect(result).toEqual({ status: 'ok' })
    expect(vi.mocked(prisma.$transaction)).not.toHaveBeenCalled()
  })
})

describe('rotateSelection — geometry correctness (schematic, 90°)', () => {
  it('rotates a single item in place: only rotation angle changes, position unchanged', async () => {
    // Single-item selection: no orbit (position invariant), only rotation angle updated.
    vi.mocked(prisma.site.findUnique).mockResolvedValue({ layoutMode: 'schematic' } as any)
    vi.mocked(prisma.inventoryItem.findMany)
      .mockResolvedValueOnce([
        { id: 'solo', locationLat: '0', locationLng: '0', schematicX: 5, schematicY: 3, rotation: 30 },
      ] as any)
      .mockResolvedValueOnce([{ itemGroupId: null }] as any)
    vi.mocked(prisma.inventoryItem.update).mockResolvedValue({} as any)

    const result = await rotateSelection(SITE_ID, ['solo'], 45)
    expect(result).toEqual({ status: 'ok' })

    const calls = vi.mocked(prisma.inventoryItem.update).mock.calls
    expect(calls).toHaveLength(1)
    const data = calls[0][0].data as any
    // Position is unchanged for a single-item selection (no orbit)
    expect(data.schematicX).toBeCloseTo(5, 5)
    expect(data.schematicY).toBeCloseTo(3, 5)
    // Rotation angle accumulates: 30 + 45 = 75
    expect(data.rotation).toBe(75)
  })

  it('two items at (0,0) and (2,0) rotate 90° around centroid (1,0) — exact coordinates', async () => {
    // In schematic mode (Y-down SVG) the action negates deltaDegrees for the
    // orbit matrix so that CW visual rotation matches each seat's own CW tilt.
    // With deltaDegrees=90 in schematic → rad = -90° = -π/2:
    //   cos(-π/2)=0, sin(-π/2)=-1
    //
    // Centroid: cx=1, cy=0.
    // i1 at (0,0): dX=-1, dY=0 → dx=-1, dy=0 (metersPerLng/Lat=1 schematic)
    //   newLatM = dy*cos - dx*sin = 0*(0) - (-1)*(-1) = -1
    //   newLngM = dy*sin + dx*cos = 0*(-1) + (-1)*(0) = 0
    //   newY = cy + newLatM/1 = 0 + (-1) = -1   → schematicY=-1
    //   newX = cx + newLngM/1 = 1 + 0    = 1    → schematicX=1
    // i2 at (2,0): dX=+1, dY=0 → dx=+1, dy=0
    //   newLatM = 0*0 - 1*(-1) = 1
    //   newLngM = 0*(-1) + 1*0 = 0
    //   newY = 0 + 1 = 1   → schematicY=1
    //   newX = 1 + 0 = 1   → schematicX=1
    vi.mocked(prisma.site.findUnique).mockResolvedValue({ layoutMode: 'schematic' } as any)
    vi.mocked(prisma.inventoryItem.findMany)
      .mockResolvedValueOnce([
        { id: 'i1', locationLat: '0', locationLng: '0', schematicX: 0, schematicY: 0, rotation: 0 },
        { id: 'i2', locationLat: '0', locationLng: '0', schematicX: 2, schematicY: 0, rotation: 0 },
      ] as any)
      .mockResolvedValueOnce([{ itemGroupId: null }, { itemGroupId: null }] as any)
    vi.mocked(prisma.inventoryItem.update).mockResolvedValue({} as any)

    const result = await rotateSelection(SITE_ID, ['i1', 'i2'], 90)
    expect(result).toEqual({ status: 'ok' })

    const calls = vi.mocked(prisma.inventoryItem.update).mock.calls
    expect(calls).toHaveLength(2)

    const d1 = calls[0][0].data as any  // item at (0,0) → should go to (1,-1)
    const d2 = calls[1][0].data as any  // item at (2,0) → should go to (1,1)

    expect(d1.schematicX).toBeCloseTo(1, 5)
    expect(d1.schematicY).toBeCloseTo(-1, 5)
    expect(d1.rotation).toBe(90)

    expect(d2.schematicX).toBeCloseTo(1, 5)
    expect(d2.schematicY).toBeCloseTo(1, 5)
    expect(d2.rotation).toBe(90)
  })
})

// ─── setItemStatusByGroup ──────────────────────────────────────────────────────
//
// CONTRACT INCONSISTENCY: setItemStatusByGroup throws Error() on auth failure
// instead of returning { status: 'error', errors: [...] }.
// A caller that destructures `const { status } = await setItemStatusByGroup(...)`
// will crash with "Cannot destructure property 'status' of undefined" when the
// error is thrown. The other requireSiteOwner-based actions all return
// { status: 'error' }. This inconsistency is documented and tested below.

describe('setItemStatusByGroup — throws on auth failure (INCONSISTENT CONTRACT)', () => {
  it('throws "Not authenticated" instead of returning {status:error} when no session', async () => {
    // BUG: caller that does `const { status } = await setItemStatusByGroup(...)`
    // will crash here because a thrown Error is not destructurable.
    mockAuth.mockResolvedValue(null)
    await expect(setItemStatusByGroup('grp-1', 'active')).rejects.toThrow('Not authenticated')
  })

  it('throws "Not authorized" instead of returning {status:error} when wrong owner', async () => {
    mockAuth.mockResolvedValue({ user: { id: OTHER_ID } } as any)
    vi.mocked(prisma.inventoryItem.findFirst).mockResolvedValue({
      site: { userId: OWNER_ID },
    } as any)
    await expect(setItemStatusByGroup('grp-1', 'active')).rejects.toThrow('Not authorized')
  })

  it('throws "Invalid item status" instead of returning {status:error} for bad status', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    await expect(setItemStatusByGroup('grp-1', 'bogus-status')).rejects.toThrow('Invalid item status')
  })
})

describe('setItemStatusByGroup — happy path', () => {
  it('updates all items in the group to the given valid status', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    vi.mocked(prisma.inventoryItem.findFirst).mockResolvedValue({
      site: { userId: OWNER_ID },
    } as any)
    vi.mocked(prisma.inventoryItem.updateMany).mockResolvedValue({ count: 3 } as any)

    const result = await setItemStatusByGroup('grp-1', 'active')
    expect(result).toEqual({ status: 'ok' })

    expect(vi.mocked(prisma.inventoryItem.updateMany)).toHaveBeenCalledWith({
      where: { itemGroupId: 'grp-1' },
      data: { status: 'active' },
    })
  })

  it('accepts all valid statuses: active, disabled, pool', async () => {
    for (const status of ['active', 'disabled', 'pool']) {
      vi.clearAllMocks()
      mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
      // Re-reset requireSiteOwner after clearAllMocks
      mockRequireSiteOwner.mockResolvedValue({ session: { user: { id: OWNER_ID } }, error: null } as any)
      vi.mocked(prisma.inventoryItem.findFirst).mockResolvedValue({
        site: { userId: OWNER_ID },
      } as any)
      vi.mocked(prisma.inventoryItem.updateMany).mockResolvedValue({ count: 1 } as any)

      const result = await setItemStatusByGroup('grp-1', status)
      expect(result).toEqual({ status: 'ok' })
    }
  })
})

// ─── getItemGroup ──────────────────────────────────────────────────────────────
//
// CONTRACT INCONSISTENCY: getItemGroup throws Error() on auth failure instead
// of returning { status: 'error', errors: [...] }. Same pattern as
// setItemStatusByGroup above.

describe('getItemGroup — throws on auth failure (INCONSISTENT CONTRACT)', () => {
  it('throws "Not authenticated" when no session', async () => {
    mockAuth.mockResolvedValue(null)
    await expect(getItemGroup('grp-1')).rejects.toThrow('Not authenticated')
  })

  it('throws "Not authorized" when group not found', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    vi.mocked(prisma.itemGroup.findUnique).mockResolvedValue(null)
    await expect(getItemGroup('grp-1')).rejects.toThrow('Not authorized')
  })

  it('throws "Not authorized" when group has no items (empty items array)', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    vi.mocked(prisma.itemGroup.findUnique).mockResolvedValue({
      id: 'grp-1',
      items: [],
    } as any)
    await expect(getItemGroup('grp-1')).rejects.toThrow('Not authorized')
  })

  it('throws "Not authorized" when group belongs to a different owner', async () => {
    mockAuth.mockResolvedValue({ user: { id: OTHER_ID } } as any)
    vi.mocked(prisma.itemGroup.findUnique).mockResolvedValue({
      id: 'grp-1',
      items: [{ site: { userId: OWNER_ID } }],
    } as any)
    await expect(getItemGroup('grp-1')).rejects.toThrow('Not authorized')
  })
})

describe('getItemGroup — happy path', () => {
  it('returns the full item group with items ordered by number when authorized', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)

    const ownershipCheckResult = {
      id: 'grp-1',
      items: [{ site: { userId: OWNER_ID } }],
    }
    const fullGroupResult = {
      id: 'grp-1',
      rows: 2,
      seatsPerRow: 3,
      items: [
        { id: 'item-1', number: 10101 },
        { id: 'item-2', number: 10102 },
      ],
    }
    // getItemGroup calls findUnique twice: first with select for ownership check,
    // then with full include for the return value.
    vi.mocked(prisma.itemGroup.findUnique)
      .mockResolvedValueOnce(ownershipCheckResult as any)
      .mockResolvedValueOnce(fullGroupResult as any)

    const result = await getItemGroup('grp-1')

    expect(result).toEqual(fullGroupResult)
    expect(vi.mocked(prisma.itemGroup.findUnique)).toHaveBeenCalledTimes(2)
    // First call: ownership check with select
    expect(vi.mocked(prisma.itemGroup.findUnique).mock.calls[0][0]).toMatchObject({
      where: { id: 'grp-1' },
    })
    // Second call: full include for return value
    expect(vi.mocked(prisma.itemGroup.findUnique).mock.calls[1][0]).toMatchObject({
      where: { id: 'grp-1' },
    })
  })
})

// ─── assignItemsToGroup ────────────────────────────────────────────────────────

describe('assignItemsToGroup — auth rejection', () => {
  it('returns error when not authenticated', async () => {
    mockRequireSiteOwner.mockResolvedValueOnce({ session: null, error: 'Not authenticated' } as any)
    const result = await assignItemsToGroup(SITE_ID, ['i1'], 2)
    expect(result).toEqual({ status: 'error', errors: ['Not authenticated'] })
    expect(vi.mocked(prisma.inventoryItem.updateMany)).not.toHaveBeenCalled()
  })

  it('returns error when not the site owner', async () => {
    mockRequireSiteOwner.mockResolvedValueOnce({ session: null, error: 'Not authorized' } as any)
    const result = await assignItemsToGroup(SITE_ID, ['i1'], 2)
    expect(result).toEqual({ status: 'error', errors: ['Not authorized'] })
    expect(vi.mocked(prisma.inventoryItem.updateMany)).not.toHaveBeenCalled()
  })
})

describe('assignItemsToGroup — empty itemIds early-return', () => {
  it('returns ok without hitting the DB when itemIds is empty', async () => {
    const result = await assignItemsToGroup(SITE_ID, [], 2)
    expect(result).toEqual({ status: 'ok' })
    expect(vi.mocked(prisma.inventoryItem.updateMany)).not.toHaveBeenCalled()
  })
})

describe('assignItemsToGroup — ownership scoping', () => {
  it('scopes updateMany to siteId so foreign item ids are not reassigned', async () => {
    // The DB where clause { id: { in: itemIds }, siteId } ensures that items
    // belonging to a different site will not match and won't be updated.
    // This test verifies the siteId filter is always present in the query.
    vi.mocked(prisma.inventoryItem.updateMany).mockResolvedValue({ count: 1 } as any)

    await assignItemsToGroup(SITE_ID, ['owned-item', 'foreign-item'], 3)

    const call = vi.mocked(prisma.inventoryItem.updateMany).mock.calls[0][0]
    expect(call.where).toMatchObject({ siteId: SITE_ID })
  })
})

describe('assignItemsToGroup — happy path', () => {
  it('assigns the correct group and clears itemGroupId for the matching items', async () => {
    vi.mocked(prisma.inventoryItem.updateMany).mockResolvedValue({ count: 2 } as any)

    const result = await assignItemsToGroup(SITE_ID, ['i1', 'i2'], 5)
    expect(result).toEqual({ status: 'ok' })

    expect(vi.mocked(prisma.inventoryItem.updateMany)).toHaveBeenCalledWith({
      where: { id: { in: ['i1', 'i2'] }, siteId: SITE_ID },
      data: { group: 5, itemGroupId: null },
    })
  })

  it('calls recomputeSeatLabels with the siteId after the update', async () => {
    vi.mocked(prisma.inventoryItem.updateMany).mockResolvedValue({ count: 1 } as any)
    vi.mocked(recomputeSeatLabels).mockResolvedValue(undefined as any)

    await assignItemsToGroup(SITE_ID, ['i1'], 2)

    expect(vi.mocked(recomputeSeatLabels)).toHaveBeenCalledWith(SITE_ID)
  })
})

// ─── removeItemsFromGroup ──────────────────────────────────────────────────────

describe('removeItemsFromGroup — auth rejection', () => {
  it('returns error when not authenticated', async () => {
    mockRequireSiteOwner.mockResolvedValueOnce({ session: null, error: 'Not authenticated' } as any)
    const result = await removeItemsFromGroup(SITE_ID, ['i1'])
    expect(result).toEqual({ status: 'error', errors: ['Not authenticated'] })
    expect(vi.mocked(prisma.inventoryItem.updateMany)).not.toHaveBeenCalled()
  })

  it('returns error when not the site owner', async () => {
    mockRequireSiteOwner.mockResolvedValueOnce({ session: null, error: 'Not authorized' } as any)
    const result = await removeItemsFromGroup(SITE_ID, ['i1'])
    expect(result).toEqual({ status: 'error', errors: ['Not authorized'] })
    expect(vi.mocked(prisma.inventoryItem.updateMany)).not.toHaveBeenCalled()
  })
})

describe('removeItemsFromGroup — empty itemIds early-return', () => {
  it('returns ok without hitting the DB when itemIds is empty', async () => {
    const result = await removeItemsFromGroup(SITE_ID, [])
    expect(result).toEqual({ status: 'ok' })
    expect(vi.mocked(prisma.inventoryItem.updateMany)).not.toHaveBeenCalled()
  })
})

describe('removeItemsFromGroup — ownership scoping', () => {
  it('scopes updateMany to siteId so foreign items are not removed from their group', async () => {
    // Same siteId scoping as assignItemsToGroup: foreign item ids silently
    // don't match because of the siteId filter in the where clause.
    vi.mocked(prisma.inventoryItem.updateMany).mockResolvedValue({ count: 1 } as any)

    await removeItemsFromGroup(SITE_ID, ['owned-item', 'foreign-item'])

    const call = vi.mocked(prisma.inventoryItem.updateMany).mock.calls[0][0]
    expect(call.where).toMatchObject({ siteId: SITE_ID })
  })
})

describe('removeItemsFromGroup — happy path', () => {
  it('resets group to 0 and clears itemGroupId for the matching items', async () => {
    vi.mocked(prisma.inventoryItem.updateMany).mockResolvedValue({ count: 2 } as any)

    const result = await removeItemsFromGroup(SITE_ID, ['i1', 'i2'])
    expect(result).toEqual({ status: 'ok' })

    expect(vi.mocked(prisma.inventoryItem.updateMany)).toHaveBeenCalledWith({
      where: { id: { in: ['i1', 'i2'] }, siteId: SITE_ID },
      data: { group: 0, itemGroupId: null },
    })
  })

  it('calls recomputeSeatLabels with the siteId after the update', async () => {
    vi.mocked(prisma.inventoryItem.updateMany).mockResolvedValue({ count: 1 } as any)
    vi.mocked(recomputeSeatLabels).mockResolvedValue(undefined as any)

    await removeItemsFromGroup(SITE_ID, ['i1'])

    expect(vi.mocked(recomputeSeatLabels)).toHaveBeenCalledWith(SITE_ID)
  })
})
