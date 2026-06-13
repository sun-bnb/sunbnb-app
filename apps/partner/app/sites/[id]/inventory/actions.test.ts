import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/auth', () => ({
  auth: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/auth-helpers', () => ({
  requireSiteOwner: vi.fn().mockResolvedValue({ session: null, error: 'Not authenticated' }),
}))

import { moveItems, moveParcel, rotateSelection, reverseParcelNumbering } from './actions'
import { requireSiteOwner } from '@/lib/auth-helpers'
import prisma from '@repo/data/PrismaCient'

const mockRequireSiteOwner = vi.mocked(requireSiteOwner)
const SITE_ID = 'site-1'

beforeEach(() => {
  vi.clearAllMocks()
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
