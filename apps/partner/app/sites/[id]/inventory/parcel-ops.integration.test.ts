/**
 * Track 030 S1b — parcel compositions against real Postgres.
 *
 * Parity contract: the server compositions (rotateParcel / applyParcelConfig /
 * rotateUnit) must produce EXACTLY what the editors' former in-browser
 * compositions produced. `legacyRotateParcel` below is a verbatim replica of the
 * removed client code (read ItemGroup via getItemGroup, rebuild a ChairConfig,
 * syncChairsWithLayout 'rearrange'); the new action must match it seat for seat.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import { cleanDatabase, disconnectDatabase, prisma } from '@/app/test/setup'
import { createTestUser, createTestSite, createTestPairedUnit, createTestInventoryItem } from '@/app/test/fixtures'
import { generateChairs } from './chair-util'

let mockUserId: string | null = null
vi.mock('@/app/auth', () => ({
  auth: vi.fn(async () => (mockUserId ? { user: { id: mockUserId } } : null)),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { syncChairsWithLayout, getItemGroup } from './actions'
import { rotateParcel, applyParcelConfig, rotateUnit } from './parcel-ops'
import type { ChairConfig } from './chair-util'

beforeAll(async () => { await cleanDatabase() })
beforeEach(async () => { await cleanDatabase(); mockUserId = null })
afterAll(async () => { await cleanDatabase(); await disconnectDatabase() })

const BASE = { lat: 36.7213, lng: -4.4214 }

const config = (over: Partial<ChairConfig> = {}): ChairConfig => ({
  group: 1, rows: 2, seatsPerRow: 4,
  baseLat: BASE.lat, baseLng: BASE.lng,
  horizontalGap: 1, verticalGap: 1.5, intraPairGap: 0.3,
  rotation: 0, pairSeats: true, category: 'PRICE1', price: 9,
  ...over,
})

async function seed(layoutMode: 'geo' | 'schematic', over: Partial<ChairConfig> = {}) {
  const user = await createTestUser()
  mockUserId = user.id
  const site = await createTestSite(user.id, { layoutMode })
  await syncChairsWithLayout(
    site.id,
    layoutMode === 'schematic' ? config({ baseLat: 80, baseLng: 120, ...over }) : config(over),
    'create',
  )
  return { user, site }
}

/** Verbatim replica of the removed client compositions (inventory/view.tsx, schematic/view.tsx). */
async function legacyRotateParcel(siteId: string, group: number, delta: number, layoutMode: 'geo' | 'schematic') {
  const groupItems = await prisma.inventoryItem.findMany({ where: { siteId, group, status: { not: 'pool' } } })
  const firstWithGroup = groupItems.find((i) => i.itemGroupId)!
  const ig = (await getItemGroup(firstWithGroup.itemGroupId!))!
  const newConfig: ChairConfig = {
    rows: Math.ceil(groupItems.length / ig.seatsPerRow),
    seatsPerRow: ig.seatsPerRow,
    horizontalGap: ig.horizontalGap,
    verticalGap: ig.verticalGap,
    rotation: ig.rotation + delta,
    group: ig.number,
    category: ig.category || undefined,
    price: ig.price || undefined,
    pairSeats: ig.pairGap > 0,
    intraPairGap: ig.pairGap,
    baseLat: layoutMode === 'schematic' ? ig.schematicY ?? 0 : parseFloat(ig.locationLat),
    baseLng: layoutMode === 'schematic' ? ig.schematicX ?? 0 : parseFloat(ig.locationLng),
  }
  await syncChairsWithLayout(siteId, newConfig, 'rearrange')
}

const seats = (siteId: string) =>
  prisma.inventoryItem.findMany({
    where: { siteId },
    orderBy: { number: 'asc' },
    select: {
      id: true, number: true, group: true, rotation: true, seatLabel: true,
      locationLat: true, locationLng: true, schematicX: true, schematicY: true,
      sunbedGroupId: true, category: true, price: true,
    },
  })

/** Everything geometric/identifying, minus ids that legitimately differ between two sites. */
const shape = (rows: Awaited<ReturnType<typeof seats>>) =>
  rows.map(({ id: _id, sunbedGroupId: _u, ...r }) => r)

describe('rotateParcel — parity with the former client composition', () => {
  it.each(['geo', 'schematic'] as const)('%s: matches the legacy composition seat for seat', async (mode) => {
    const a = await seed(mode)
    const b = await seed(mode)

    mockUserId = a.user.id
    await rotateParcel(a.site.id, 1, 90).then((r) => expect(r.status).toBe('ok'))
    mockUserId = b.user.id
    await legacyRotateParcel(b.site.id, 1, 90, mode)
    mockUserId = a.user.id

    const got = shape(await seats(a.site.id))
    expect(got).toEqual(shape(await seats(b.site.id)))
    expect(got.every((s) => s.rotation === 90)).toBe(true)
    // Numbering/labels are recomputed exactly as the editor path did.
    expect(got.every((s) => s.seatLabel)).toBe(true)

    const ig = await prisma.itemGroup.findFirstOrThrow({ where: { items: { some: { siteId: a.site.id } } } })
    expect(ig.rotation).toBe(90)
  })

  it('accumulates: 90 then -45 equals a stored rotation of 45, keeps every seat id and unit', async () => {
    const { site } = await seed('geo')
    const before = await seats(site.id)

    await rotateParcel(site.id, 1, 90)
    const res = await rotateParcel(site.id, 1, -45)

    const after = await seats(site.id)
    expect(after.map((s) => s.id)).toEqual(before.map((s) => s.id))
    expect(after.map((s) => s.sunbedGroupId)).toEqual(before.map((s) => s.sunbedGroupId))
    expect(after.every((s) => s.rotation === 45)).toBe(true)
    expect([...(res.changedItemIds ?? [])].sort()).toEqual(before.map((s) => s.id).sort())
  })

  it('accepts the ItemGroup id as well as the parcel number', async () => {
    const { site } = await seed('geo')
    const ig = await prisma.itemGroup.findFirstOrThrow({ where: { items: { some: { siteId: site.id } } } })
    expect((await rotateParcel(site.id, ig.id, 30)).status).toBe('ok')
    expect((await seats(site.id)).every((s) => s.rotation === 30)).toBe(true)
  })
})

describe('applyParcelConfig', () => {
  it('changes the horizontal gap: relative seat positions match generateChairs for the new gap', async () => {
    const { site } = await seed('geo', { pairSeats: false, intraPairGap: 0 })
    expect((await applyParcelConfig(site.id, 1, { horizontalGap: 3 })).status).toBe('ok')

    const rows = await seats(site.id)
    const expected = generateChairs(config({ pairSeats: false, intraPairGap: 0, horizontalGap: 3 }))
    const centroid = (pts: { lat: number; lng: number }[]) => ({
      lat: pts.reduce((s, p) => s + p.lat, 0) / pts.length,
      lng: pts.reduce((s, p) => s + p.lng, 0) / pts.length,
    })
    const got = rows.map((r) => ({ lat: parseFloat(r.locationLat), lng: parseFloat(r.locationLng) }))
    const exp = expected.map((c) => ({ lat: parseFloat(c.locationLat), lng: parseFloat(c.locationLng) }))
    const gc = centroid(got)
    const ec = centroid(exp)
    // rearrange preserves the parcel centroid; compare layouts relative to it.
    for (let i = 0; i < got.length; i++) {
      expect(got[i]!.lat - gc.lat).toBeCloseTo(exp[i]!.lat - ec.lat, 8)
      expect(got[i]!.lng - gc.lng).toBeCloseTo(exp[i]!.lng - ec.lng, 8)
    }
    const ig = await prisma.itemGroup.findFirstOrThrow({ where: { items: { some: { siteId: site.id } } } })
    expect(ig.horizontalGap).toBe(3)
  })

  it('an empty patch (restore order) is a no-op on geometry and identity', async () => {
    const { site } = await seed('geo')
    const before = await seats(site.id)
    expect((await applyParcelConfig(site.id, 1, {})).status).toBe('ok')
    const after = await seats(site.id)
    expect(after.map((s) => s.id)).toEqual(before.map((s) => s.id))
    expect(after.map((s) => s.seatLabel)).toEqual(before.map((s) => s.seatLabel))
    for (let i = 0; i < before.length; i++) {
      expect(parseFloat(after[i]!.locationLat)).toBeCloseTo(parseFloat(before[i]!.locationLat), 8)
      expect(parseFloat(after[i]!.locationLng)).toBeCloseTo(parseFloat(before[i]!.locationLng), 8)
    }
  })

  it('resizes: rows 2 -> 3 adds a row of seats and keeps the existing seat ids', async () => {
    const { site } = await seed('geo')
    const before = await seats(site.id)
    const res = await applyParcelConfig(site.id, 1, { rows: 3, seatsPerRow: 4 })
    expect(res.status).toBe('ok')
    const after = await seats(site.id)
    expect(after).toHaveLength(12)
    expect(after.slice(0, 8).map((s) => s.id)).toEqual(before.map((s) => s.id))
    expect(res.changedItemIds).toHaveLength(12)
  })

  it('applies category and price to every seat in the parcel', async () => {
    const { site } = await seed('geo')
    await applyParcelConfig(site.id, 1, { category: 'PRICE2', price: 14 })
    const rows = await seats(site.id)
    expect(rows.every((s) => s.category === 'PRICE2' && s.price === 14)).toBe(true)
  })

  it('refuses an invalid patch and leaves the parcel untouched', async () => {
    const { site } = await seed('geo')
    const before = await seats(site.id)
    expect((await applyParcelConfig(site.id, 1, { rows: 0 })).status).toBe('error')
    expect(await seats(site.id)).toEqual(before)
  })
})

describe('rotateUnit', () => {
  it('rotates every member of the unit and orbits them about the unit centroid', async () => {
    const user = await createTestUser()
    mockUserId = user.id
    const site = await createTestSite(user.id, { layoutMode: 'geo' })
    const { itemA, itemB } = await createTestPairedUnit(user.id, site.id, [1, 2], {})
    await prisma.inventoryItem.update({ where: { id: itemA.id }, data: { locationLat: '36.7000', locationLng: '-4.4000' } })
    await prisma.inventoryItem.update({ where: { id: itemB.id }, data: { locationLat: '36.7000', locationLng: '-4.3999' } })
    const loose = await createTestInventoryItem(user.id, site.id, { number: 3, rotation: 10 })

    const res = await rotateUnit(site.id, itemA.id, 90)

    expect(res.status).toBe('ok')
    expect([...(res.changedItemIds ?? [])].sort()).toEqual([itemA.id, itemB.id].sort())
    const [a, b, l] = await Promise.all([itemA.id, itemB.id, loose.id].map((id) =>
      prisma.inventoryItem.findUniqueOrThrow({ where: { id } })))
    expect(a.rotation).toBe(90)
    expect(b.rotation).toBe(90)
    // Orbit about the centroid: the pair was side-by-side (same lat); after 90deg
    // they are stacked (same lng), centroid unchanged.
    expect(parseFloat(a.locationLng)).toBeCloseTo(parseFloat(b.locationLng), 7)
    expect((parseFloat(a.locationLat) + parseFloat(b.locationLat)) / 2).toBeCloseTo(36.7, 7)
    expect((parseFloat(a.locationLng) + parseFloat(b.locationLng)) / 2).toBeCloseTo(-4.39995, 7)
    // A neighbour outside the unit is untouched.
    expect(l.rotation).toBe(10)
  })

  it('turns a loose seat in place and wraps into [0, 360)', async () => {
    const user = await createTestUser()
    mockUserId = user.id
    const site = await createTestSite(user.id, { layoutMode: 'geo' })
    const item = await createTestInventoryItem(user.id, site.id, { number: 1, rotation: 350 })
    await rotateUnit(site.id, item.id, 20)
    const row = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: item.id } })
    expect(row.rotation).toBe(10)
    expect(row.locationLat).toBe(item.locationLat)
  })
})

describe('ownership and site scoping', () => {
  it('a non-owner is rejected by every action and nothing changes', async () => {
    const { site } = await seed('geo')
    const before = await seats(site.id)
    const item = before[0]!
    const intruder = await createTestUser()
    mockUserId = intruder.id

    for (const res of [
      await rotateParcel(site.id, 1, 90),
      await applyParcelConfig(site.id, 1, { horizontalGap: 5 }),
      await rotateUnit(site.id, item.id, 90),
    ]) {
      expect(res.status).toBe('error')
    }
    expect(await seats(site.id)).toEqual(before)
  })

  it('an owner cannot reach ANOTHER site\'s parcel number, ItemGroup id or seat via their own siteId', async () => {
    const mine = await seed('geo')                         // parcel 1 on my site
    const user2 = await createTestUser()
    mockUserId = user2.id
    const theirSite = await createTestSite(user2.id, { layoutMode: 'geo' })
    await syncChairsWithLayout(theirSite.id, config({ group: 7 }), 'create')
    const theirs = await seats(theirSite.id)
    const theirIg = await prisma.itemGroup.findFirstOrThrow({ where: { items: { some: { siteId: theirSite.id } } } })

    mockUserId = mine.user.id
    const mineBefore = await seats(mine.site.id)

    expect((await rotateParcel(mine.site.id, 7, 90)).status).toBe('error')        // their parcel number
    expect((await rotateParcel(mine.site.id, theirIg.id, 90)).status).toBe('error') // their ItemGroup id
    expect((await applyParcelConfig(mine.site.id, theirIg.id, { horizontalGap: 9 })).status).toBe('error')
    expect((await rotateUnit(mine.site.id, theirs[0]!.id, 90)).status).toBe('error') // their seat id

    expect(await seats(theirSite.id)).toEqual(theirs)
    expect(await seats(mine.site.id)).toEqual(mineBefore)
  })

  it('a sudo user may operate on a site they do not own', async () => {
    const { site } = await seed('geo')
    const admin = await createTestUser({ sudo: true })
    mockUserId = admin.id
    expect((await rotateParcel(site.id, 1, 90)).status).toBe('ok')
    const first = (await seats(site.id))[0]!
    expect((await rotateUnit(site.id, first.id, 15)).status).toBe('ok')
  })

  it('an unauthenticated caller is rejected', async () => {
    const { site } = await seed('geo')
    mockUserId = null
    expect((await rotateParcel(site.id, 1, 90)).status).toBe('error')
  })
})
