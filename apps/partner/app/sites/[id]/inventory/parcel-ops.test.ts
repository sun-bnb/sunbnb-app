/**
 * Track 030 S1b — server-side parcel compositions (unit level, Prisma mocked).
 * Geometry itself is proven against real Postgres in parcel-ops.integration.test.ts;
 * here: authz, id/site scoping, and the exact arguments handed to the delegates.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth-helpers', () => ({
  requireSiteOwner: vi.fn(),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('./actions', () => ({
  syncChairsWithLayout: vi.fn().mockResolvedValue(undefined),
  rotateSelection: vi.fn().mockResolvedValue({ status: 'ok' }),
}))

import { rotateParcel, applyParcelConfig, rotateUnit, setSeatsStatus } from './parcel-ops'
import { requireSiteOwner } from '@/lib/auth-helpers'
import { syncChairsWithLayout, rotateSelection } from './actions'
import prisma from '@repo/data/PrismaCient'

const SITE = 'site-1'
const mockOwner = vi.mocked(requireSiteOwner)
const mockSync = vi.mocked(syncChairsWithLayout)
const mockRotateSel = vi.mocked(rotateSelection)

const seat = (id: string, number: number, extra: Record<string, unknown> = {}) => ({
  id, number, rotation: 0, itemGroupId: 'ig-1',
  locationLat: '36.7', locationLng: '-4.4', schematicX: null, schematicY: null, ...extra,
})

const itemGroup = (extra: Record<string, unknown> = {}) => ({
  id: 'ig-1', number: 3, seatsPerRow: 4, horizontalGap: 1, verticalGap: 1.5,
  rotation: 30, pairGap: 0.4, category: 'PRICE1', price: 9,
  locationLat: '36.7213', locationLng: '-4.4214', schematicX: null, schematicY: null,
  ...extra,
})

function seedParcel(opts: { ig?: ReturnType<typeof itemGroup> | null; layout?: 'geo' | 'schematic'; seats?: number } = {}) {
  const n = opts.seats ?? 8
  const seats = Array.from({ length: n }, (_, i) =>
    seat(`s${i + 1}`, i + 1, opts.ig === null ? { itemGroupId: null } : {}))
  vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue(seats as never)
  vi.mocked(prisma.itemGroup.findUnique).mockResolvedValue((opts.ig === undefined ? itemGroup() : opts.ig) as never)
  vi.mocked(prisma.site.findUnique).mockResolvedValue({ layoutMode: opts.layout ?? 'geo' } as never)
}

beforeEach(() => {
  vi.clearAllMocks()
  mockOwner.mockResolvedValue({ session: { user: { id: 'owner-1' } }, error: null })
  mockSync.mockResolvedValue(undefined)
  mockRotateSel.mockResolvedValue({ status: 'ok' })
})

describe.each([
  ['rotateParcel', () => rotateParcel(SITE, 3, 90)],
  ['applyParcelConfig', () => applyParcelConfig(SITE, 3, { horizontalGap: 2 })],
  ['rotateUnit', () => rotateUnit(SITE, 'item-1', 90)],
])('%s authz', (_name, call) => {
  it('rejects when the caller does not own the site and does nothing', async () => {
    mockOwner.mockResolvedValue({ session: null, error: 'Not authorized' })
    const res = await call()
    expect(res).toEqual({ status: 'error', errors: ['Not authorized'] })
    expect(mockOwner).toHaveBeenCalledWith(SITE)
    expect(prisma.inventoryItem.findMany).not.toHaveBeenCalled()
    expect(mockSync).not.toHaveBeenCalled()
    expect(mockRotateSel).not.toHaveBeenCalled()
    expect(prisma.inventoryItem.update).not.toHaveBeenCalled()
  })
})

describe('rotateParcel', () => {
  it('rebuilds the config SERVER-side from the ItemGroup and rotates by delta', async () => {
    seedParcel()
    const res = await rotateParcel(SITE, 3, 15)
    expect(res.status).toBe('ok')
    expect(mockSync).toHaveBeenCalledTimes(1)
    const [siteId, config, mode] = mockSync.mock.calls[0]!
    expect(siteId).toBe(SITE)
    expect(mode).toBe('rearrange')
    expect(config).toMatchObject({
      rows: 2, seatsPerRow: 4, horizontalGap: 1, verticalGap: 1.5,
      rotation: 45, group: 3, category: 'PRICE1', price: 9,
      pairSeats: true, intraPairGap: 0.4, baseLat: 36.7213, baseLng: -4.4214,
    })
  })

  it('scopes the parcel lookup to the site and excludes pool seats', async () => {
    seedParcel()
    await rotateParcel(SITE, 3, 15)
    expect(vi.mocked(prisma.inventoryItem.findMany).mock.calls[0]![0]!.where).toEqual({
      siteId: SITE, status: { not: 'pool' }, group: 3,
    })
  })

  it('accepts an ItemGroup id and still scopes by siteId', async () => {
    seedParcel()
    await rotateParcel(SITE, 'ig-1', 15)
    expect(vi.mocked(prisma.inventoryItem.findMany).mock.calls[0]![0]!.where).toEqual({
      siteId: SITE, status: { not: 'pool' }, itemGroupId: 'ig-1',
    })
    expect(mockSync).toHaveBeenCalled()
  })

  it('rejects a parcel/ItemGroup that has no seats in THIS site (foreign id)', async () => {
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([])
    const res = await rotateParcel(SITE, 'foreign-ig', 15)
    expect(res.status).toBe('error')
    expect(mockSync).not.toHaveBeenCalled()
    expect(mockRotateSel).not.toHaveBeenCalled()
  })

  it('uses the schematic anchor (schematicX/Y) for schematic sites', async () => {
    seedParcel({ layout: 'schematic', ig: itemGroup({ locationLat: '0', locationLng: '0', schematicX: 120, schematicY: 80 }) })
    await rotateParcel(SITE, 3, 15)
    expect(mockSync.mock.calls[0]![1]).toMatchObject({ baseLat: 80, baseLng: 120 })
  })

  it('falls back to rotating the seats as a selection when there is no ItemGroup', async () => {
    seedParcel({ ig: null, seats: 3 })
    const res = await rotateParcel(SITE, 3, -15)
    expect(mockSync).not.toHaveBeenCalled()
    expect(mockRotateSel).toHaveBeenCalledWith(SITE, ['s1', 's2', 's3'], -15)
    expect(res.status).toBe('ok')
  })

  it('refuses a non-finite delta', async () => {
    seedParcel()
    expect((await rotateParcel(SITE, 3, Number.NaN)).status).toBe('error')
    expect(mockSync).not.toHaveBeenCalled()
  })

  it('propagates a delegate error instead of reporting ok', async () => {
    seedParcel()
    mockSync.mockResolvedValue({ status: 'error', errors: ['boom'] } as never)
    expect(await rotateParcel(SITE, 3, 15)).toEqual({ status: 'error', errors: ['boom'] })
  })
})

describe('pairing is derived from the real units, not pairGap (track 030 S1 bug)', () => {
  // An UNPAIRED parcel still carries the form's default pairGap (0.4): `pairGap > 0` re-paired it on
  // every rotate / reorder. The stored fact is the units: no unit with 2+ members = unpaired.
  const withUnits = (units: Array<string | null>) =>
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue(
      units.map((u, i) => seat(`s${i + 1}`, i + 1, { sunbedGroupId: u })) as never,
    )

  it('rotateParcel keeps an unpaired parcel unpaired (every seat its own unit, pairGap 0.4)', async () => {
    seedParcel({ seats: 4 })
    withUnits(['u1', 'u2', 'u3', 'u4'])
    await rotateParcel(SITE, 3, 15)
    expect(mockSync.mock.calls[0]![1]).toMatchObject({ pairSeats: false, intraPairGap: 0.4 })
  })

  it('rotateParcel keeps a paired parcel paired (2-member units)', async () => {
    seedParcel({ seats: 4 })
    withUnits(['u1', 'u1', 'u2', 'u2'])
    await rotateParcel(SITE, 3, 15)
    expect(mockSync.mock.calls[0]![1]).toMatchObject({ pairSeats: true })
  })

  it('applyParcelConfig (reorder = empty patch) keeps an unpaired parcel unpaired', async () => {
    seedParcel({ seats: 4 })
    withUnits(['u1', 'u2', 'u3', 'u4'])
    await applyParcelConfig(SITE, 3, {})
    expect(mockSync.mock.calls[0]![1]).toMatchObject({ pairSeats: false })
  })

  it('an explicit pairSeats patch still wins', async () => {
    seedParcel({ seats: 4 })
    withUnits(['u1', 'u2', 'u3', 'u4'])
    await applyParcelConfig(SITE, 3, { pairSeats: true })
    expect(mockSync.mock.calls[0]![1]).toMatchObject({ pairSeats: true })
  })

  it('legacy parcels with no units at all fall back to pairGap > 0', async () => {
    seedParcel({ seats: 4 })
    await rotateParcel(SITE, 3, 15)
    expect(mockSync.mock.calls[0]![1]).toMatchObject({ pairSeats: true })
  })
})

describe('setSeatsStatus', () => {
  it('rejects non-owners, writes nothing', async () => {
    mockOwner.mockResolvedValue({ session: null, error: 'Not authorized' })
    expect(await setSeatsStatus(SITE, ['a'], 'disabled')).toEqual({ status: 'error', errors: ['Not authorized'] })
    expect(prisma.inventoryItem.updateMany).not.toHaveBeenCalled()
  })

  it('scopes the write to the site, never writes pool, and refuses statuses other than active/disabled', async () => {
    expect((await setSeatsStatus(SITE, ['a', 'foreign'], 'disabled')).status).toBe('ok')
    expect(vi.mocked(prisma.inventoryItem.updateMany).mock.calls[0]![0]).toEqual({
      where: { id: { in: ['a', 'foreign'] }, siteId: SITE, status: { not: 'pool' } },
      data: { status: 'disabled' },
    })
    vi.mocked(prisma.inventoryItem.updateMany).mockClear()
    for (const bad of ['pool', 'new', '', 'DISABLED']) {
      expect((await setSeatsStatus(SITE, ['a'], bad)).status).toBe('error')
    }
    expect(prisma.inventoryItem.updateMany).not.toHaveBeenCalled()
  })
})

describe('applyParcelConfig', () => {
  it('overlays only the patched fields on the stored config', async () => {
    seedParcel()
    await applyParcelConfig(SITE, 3, { horizontalGap: 2.5, pairSeats: false })
    expect(mockSync.mock.calls[0]![1]).toMatchObject({
      horizontalGap: 2.5, pairSeats: false,
      verticalGap: 1.5, seatsPerRow: 4, rotation: 30, group: 3, baseLat: 36.7213,
    })
  })

  it('an empty patch is a restore-order: stored config unchanged', async () => {
    seedParcel()
    await applyParcelConfig(SITE, 3, {})
    expect(mockSync.mock.calls[0]![1]).toMatchObject({
      rows: 2, seatsPerRow: 4, rotation: 30, group: 3, pairSeats: true,
    })
  })

  it('ignores smuggled anchor / group fields — they are server-owned', async () => {
    seedParcel()
    await applyParcelConfig(SITE, 3, { baseLat: 1, baseLng: 2, group: 99 } as never)
    expect(mockSync.mock.calls[0]![1]).toMatchObject({ baseLat: 36.7213, baseLng: -4.4214, group: 3 })
  })

  it.each([
    [{ rows: 0 }], [{ seatsPerRow: 1.5 }], [{ horizontalGap: -1 }],
    [{ price: -5 }], [{ rotation: Number.NaN }], [{ rows: 100000 }],
  ])('rejects invalid patch %j before touching the DB', async (patch) => {
    const res = await applyParcelConfig(SITE, 3, patch as never)
    expect(res.status).toBe('error')
    expect(prisma.inventoryItem.findMany).not.toHaveBeenCalled()
    expect(mockSync).not.toHaveBeenCalled()
  })

  it('rejects an unknown / foreign parcel', async () => {
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([])
    expect((await applyParcelConfig(SITE, 77, {})).status).toBe('error')
    expect(mockSync).not.toHaveBeenCalled()
  })

  it('builds a centroid-anchored config for a parcel without an ItemGroup', async () => {
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([
      seat('a', 1, { itemGroupId: null, locationLat: '10', locationLng: '20', rotation: 45 }),
      seat('b', 2, { itemGroupId: null, locationLat: '12', locationLng: '24' }),
    ] as never)
    vi.mocked(prisma.site.findUnique).mockResolvedValue({ layoutMode: 'geo' } as never)
    await applyParcelConfig(SITE, 5, { seatsPerRow: 2 })
    expect(mockSync.mock.calls[0]![1]).toMatchObject({
      group: 5, rows: 1, seatsPerRow: 2, rotation: 45, baseLat: 11, baseLng: 22, pairSeats: true,
    })
  })
})

describe('rotateUnit', () => {
  it('rotates ALL unit members together, resolved from sunbedGroupId server-side', async () => {
    vi.mocked(prisma.inventoryItem.findFirst).mockResolvedValue({ id: 'a', rotation: 10, sunbedGroupId: 'u1' } as never)
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([{ id: 'a' }, { id: 'b' }] as never)
    const res = await rotateUnit(SITE, 'a', 15)
    expect(vi.mocked(prisma.inventoryItem.findFirst).mock.calls[0]![0]!.where).toEqual({ id: 'a', siteId: SITE })
    expect(vi.mocked(prisma.inventoryItem.findMany).mock.calls[0]![0]!.where).toMatchObject({ sunbedGroupId: 'u1', siteId: SITE })
    expect(mockRotateSel).toHaveBeenCalledWith(SITE, ['a', 'b'], 15)
    expect(res).toMatchObject({ status: 'ok', changedItemIds: ['a', 'b'] })
  })

  it('turns a loose seat in place, normalised into [0,360)', async () => {
    vi.mocked(prisma.inventoryItem.findFirst).mockResolvedValue({ id: 'a', rotation: 350, sunbedGroupId: null } as never)
    await rotateUnit(SITE, 'a', 20)
    expect(prisma.inventoryItem.update).toHaveBeenCalledWith({ where: { id: 'a' }, data: { rotation: 10 } })
    await rotateUnit(SITE, 'a', -400)
    expect(vi.mocked(prisma.inventoryItem.update).mock.calls[1]![0]!.data).toEqual({ rotation: 310 })
    expect(mockRotateSel).not.toHaveBeenCalled()
  })

  it('rejects an item that is not in this site (foreign id) without writing', async () => {
    vi.mocked(prisma.inventoryItem.findFirst).mockResolvedValue(null)
    const res = await rotateUnit(SITE, 'foreign', 15)
    expect(res.status).toBe('error')
    expect(prisma.inventoryItem.update).not.toHaveBeenCalled()
    expect(mockRotateSel).not.toHaveBeenCalled()
  })

  it('delegates sudo to requireSiteOwner (a sudo owner result proceeds)', async () => {
    mockOwner.mockResolvedValue({ session: { user: { id: 'admin' } }, error: null })
    vi.mocked(prisma.inventoryItem.findFirst).mockResolvedValue({ id: 'a', rotation: 0, sunbedGroupId: null } as never)
    expect((await rotateUnit(SITE, 'a', 15)).status).toBe('ok')
    expect(prisma.inventoryItem.update).toHaveBeenCalled()
  })
})
