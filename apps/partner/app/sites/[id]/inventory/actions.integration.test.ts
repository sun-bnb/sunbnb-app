/**
 * Integration tests for the track-020 P4 write-path batching — REAL Postgres.
 *
 * These exist because the batched paths are raw SQL (the geo coordinates are
 * String columns, so set-based arithmetic needs casts) — a mocked-Prisma unit
 * test cannot execute that SQL, only inspect it. Everything here runs against
 * sunbnb_test:
 *
 *   - moveParcel: exact coordinate arithmetic for seats AND the ItemGroup
 *     anchor, pool sentinels untouched, atomicity (one statement can't
 *     half-move).
 *   - moveItems: subset scope — unselected seats untouched.
 *   - createInventoryItem: the max(number)+1 race, exercised with genuinely
 *     concurrent calls (the advisory lock is what makes this pass).
 *   - syncChairsWithLayout rearrange re-pairing: the historical P2025 crash —
 *     re-pairing seats across two dissolved SunbedGroups deleted the same
 *     group twice.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import { cleanDatabase, disconnectDatabase, prisma } from '@/app/test/setup'
import { createTestUser, createTestSite, createTestInventoryItem } from '@/app/test/fixtures'

let mockUserId: string | null = null

vi.mock('@/app/auth', () => ({
  auth: vi.fn(async () => (mockUserId ? { user: { id: mockUserId } } : null)),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

import { moveParcel, moveItems, syncChairsWithLayout } from './actions'
import { createInventoryItem, deleteInventoryItems } from '../inventory-actions'
import { findUnitlessPlacedSeats } from '@repo/data/unit'

beforeAll(async () => {
  await cleanDatabase()
})

beforeEach(async () => {
  await cleanDatabase()
  mockUserId = null
})

afterAll(async () => {
  await cleanDatabase()
  await disconnectDatabase()
})

async function seedGeoParcel() {
  const user = await createTestUser()
  mockUserId = user.id
  const site = await createTestSite(user.id, { layoutMode: 'geo' })
  const ig = await prisma.itemGroup.create({
    data: {
      number: 1, rows: 1, seatsPerRow: 3,
      locationLat: '36.7213', locationLng: '-4.4214',
      horizontalGap: 1, verticalGap: 1.5, pairGap: 0, rotation: 0,
    },
  })
  const seat = (number: number, lat: string, lng: string, extra: object = {}) =>
    createTestInventoryItem(user.id, site.id, {
      number, locationLat: lat, locationLng: lng, group: 1, itemGroupId: ig.id, ...extra,
    })
  const s1 = await seat(10101, '36.72130', '-4.42140')
  const s2 = await seat(10102, '36.72130', '-4.42128')
  const s3 = await seat(10103, '36.72130', '-4.42116')
  const pool = await createTestInventoryItem(user.id, site.id, {
    number: 19901, locationLat: '0', locationLng: '0', group: 1, status: 'pool',
  })
  return { user, site, ig, seats: [s1, s2, s3], pool }
}

const coordsOf = async (id: string) => {
  const row = await prisma.inventoryItem.findUniqueOrThrow({
    where: { id },
    select: { locationLat: true, locationLng: true },
  })
  return { lat: parseFloat(row.locationLat), lng: parseFloat(row.locationLng) }
}

describe('moveParcel (real DB)', () => {
  it('shifts every real seat and the ItemGroup anchor by exactly the drag delta; pool untouched', async () => {
    const { site, ig, seats, pool } = await seedGeoParcel()

    // Absolute-target contract: seat 1 (36.72130, -4.42140) dropped at
    // (36.72230, -4.42340) → server derives delta (+0.001, -0.002).
    const res = await moveParcel(site.id, 1, 36.7223, -4.4234, seats[0]!.id)
    expect(res.status).toBe('ok')

    for (const [i, expected] of [
      { lat: 36.72230, lng: -4.42340 },
      { lat: 36.72230, lng: -4.42328 },
      { lat: 36.72230, lng: -4.42316 },
    ].entries()) {
      const c = await coordsOf(seats[i]!.id)
      expect(c.lat).toBeCloseTo(expected.lat, 10)
      expect(c.lng).toBeCloseTo(expected.lng, 10)
    }

    const anchor = await prisma.itemGroup.findUniqueOrThrow({ where: { id: ig.id } })
    expect(parseFloat(anchor.locationLat)).toBeCloseTo(36.7223, 10)
    expect(parseFloat(anchor.locationLng)).toBeCloseTo(-4.4234, 10)

    // Pool sentinel byte-identical — not shifted.
    const poolRow = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: pool.id } })
    expect(poolRow.locationLat).toBe('0')
    expect(poolRow.locationLng).toBe('0')
  })

  // The 2026-08-15 drag-jump regression: a second drag issued before the
  // first drag's refresh landed used STALE client coordinates as its base, so
  // deltas compounded and the parcel visibly jumped on release (23px measured
  // in-browser). With absolute targets the base is the DB row, so the seat
  // lands EXACTLY on the last drop point no matter how stale the client was.
  it('consecutive stale-base drags land exactly on the LAST drop point (no compounding)', async () => {
    const { site, seats } = await seedGeoParcel()

    // Both targets computed from the ORIGINAL position — exactly what a
    // client whose refresh has not landed yet would send.
    await moveParcel(site.id, 1, 36.7213 + 0.001, -4.4214 + 0.001, seats[0]!.id)
    await moveParcel(site.id, 1, 36.7213 + 0.0015, -4.4214 + 0.0015, seats[0]!.id)

    const c = await coordsOf(seats[0]!.id)
    expect(c.lat).toBeCloseTo(36.7213 + 0.0015, 9) // NOT +0.0025
    expect(c.lng).toBeCloseTo(-4.4214 + 0.0015, 9)
  })

  it('anchors on the ItemGroup when no anchorItemId is given (reposition click)', async () => {
    const { site, ig, seats } = await seedGeoParcel()
    // Anchor starts at (36.7213, -4.4214); reposition to +0.002/+0.002.
    const res = await moveParcel(site.id, 1, 36.7233, -4.4194)
    expect(res.status).toBe('ok')
    const anchor = await prisma.itemGroup.findUniqueOrThrow({ where: { id: ig.id } })
    expect(parseFloat(anchor.locationLat)).toBeCloseTo(36.7233, 9)
    // Seats moved by the same delta, preserving formation.
    const c = await coordsOf(seats[0]!.id)
    expect(c.lat).toBeCloseTo(36.7213 + 0.002, 9)
  })

  it('rejects a NaN target without writing', async () => {
    const { site, seats } = await seedGeoParcel()
    const res = await moveParcel(site.id, 1, Number.NaN, 0.001)
    expect(res.status).toBe('error')
    const c = await coordsOf(seats[0]!.id)
    expect(c.lat).toBeCloseTo(36.7213, 10)
  })
})

describe('moveItems (real DB)', () => {
  it('moves only the selected seats; others and pool untouched', async () => {
    const { site, seats, pool } = await seedGeoParcel()

    const res = await moveItems(site.id, [seats[0]!.id, pool.id], 0.001, 0.001)
    expect(res.status).toBe('ok')

    const moved = await coordsOf(seats[0]!.id)
    expect(moved.lat).toBeCloseTo(36.7223, 10)

    const untouched = await coordsOf(seats[1]!.id)
    expect(untouched.lat).toBeCloseTo(36.7213, 10)

    // Pool seat was in the selection but keeps its sentinel.
    const poolRow = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: pool.id } })
    expect(poolRow.locationLat).toBe('0')
  })
})

describe('createInventoryItem — concurrent number minting (real DB)', () => {
  it('parallel creates mint distinct sequential numbers (the advisory-lock fix)', async () => {
    const user = await createTestUser()
    mockUserId = user.id
    const site = await createTestSite(user.id)
    await createTestInventoryItem(user.id, site.id, { number: 7 })

    // Genuinely concurrent server-action calls — the pre-P4 read-then-write
    // raced here and minted duplicate numbers silently.
    const results = await Promise.all(
      Array.from({ length: 5 }, () => createInventoryItem({ siteId: site.id }))
    )
    for (const r of results) expect(r.status).toBe('ok')

    const numbers = (
      await prisma.inventoryItem.findMany({
        where: { siteId: site.id },
        select: { number: true },
        orderBy: { number: 'asc' },
      })
    ).map((i) => i.number)

    // Track 021 P2: each create places a UNIT of two, so five concurrent
    // creates add TEN seats. The property under test is unchanged and is the
    // reason this test exists: numbers stay distinct and gapless under real
    // concurrency (the advisory lock), never silently duplicated.
    expect(numbers).toEqual([7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17])
    expect(new Set(numbers).size).toBe(numbers.length)
  })
})

describe('syncChairsWithLayout rearrange — re-pairing across dissolved groups (real DB)', () => {
  it('survives crossed legacy SunbedGroups (the historical double-delete P2025 crash)', async () => {
    const user = await createTestUser()
    mockUserId = user.id
    const site = await createTestSite(user.id, { layoutMode: 'geo' })
    const ig = await prisma.itemGroup.create({
      data: {
        number: 1, rows: 1, seatsPerRow: 4,
        locationLat: '36.7213', locationLng: '-4.4214',
        horizontalGap: 1, verticalGap: 1.5, pairGap: 0.3, rotation: 0,
      },
    })
    const mk = (number: number, lng: string) =>
      createTestInventoryItem(user.id, site.id, {
        number, locationLat: '36.7213', locationLng: lng, group: 1, itemGroupId: ig.id,
      })
    const s1 = await mk(10101, '-4.42140')
    const s2 = await mk(10102, '-4.42134')
    const s3 = await mk(10103, '-4.42128')
    const s4 = await mk(10104, '-4.42122')

    // Legacy CROSSED grouping: (s1,s3) and (s2,s4). The rearrange below pairs
    // adjacently → (s1,s2) + (s3,s4), so BOTH old groups are priors of BOTH
    // new pairs. The pre-P4 sequential loop deleted each prior group per pair
    // and threw P2025 on the second pair's duplicate delete.
    const gA = await prisma.sunbedGroup.create({ data: { siteId: site.id } })
    const gB = await prisma.sunbedGroup.create({ data: { siteId: site.id } })
    await prisma.inventoryItem.update({ where: { id: s1.id }, data: { sunbedGroupId: gA.id } })
    await prisma.inventoryItem.update({ where: { id: s3.id }, data: { sunbedGroupId: gA.id } })
    await prisma.inventoryItem.update({ where: { id: s2.id }, data: { sunbedGroupId: gB.id } })
    await prisma.inventoryItem.update({ where: { id: s4.id }, data: { sunbedGroupId: gB.id } })

    await expect(
      syncChairsWithLayout(
        site.id,
        {
          group: 1, rows: 1, seatsPerRow: 4,
          baseLat: 36.7213, baseLng: -4.4214,
          horizontalGap: 1, verticalGap: 1.5, intraPairGap: 0.3,
          rotation: 0, pairSeats: true,
        } as never,
        'rearrange'
      )
    ).resolves.not.toThrow()

    // Track 021 P4 (A2) CHANGED THE STRATEGY, not the guarantee. The crossed
    // groups are now REUSED rather than dissolved and re-minted, because a unit
    // is a physical spot and re-pairing only changes which beds share it —
    // losing the row would lose its label ordinal and its device location. The
    // crash this test exists for (deleting the same dissolved group twice,
    // P2025) cannot happen when nothing is deleted.
    const survivors = await prisma.sunbedGroup.findMany({
      where: { siteId: site.id }, select: { id: true },
    })
    expect(survivors.map((g) => g.id).sort()).toEqual([gA.id, gB.id].sort())

    // …and the seats are re-paired adjacently, two members per unit.
    const rows = await prisma.inventoryItem.findMany({
      where: { siteId: site.id },
      select: { number: true, sunbedGroupId: true },
      orderBy: { number: 'asc' },
    })
    const byNumber = new Map(rows.map((r) => [r.number, r.sunbedGroupId]))
    expect(byNumber.get(10101)).toBeTruthy()
    expect(byNumber.get(10101)).toBe(byNumber.get(10102))
    expect(byNumber.get(10103)).toBeTruthy()
    expect(byNumber.get(10103)).toBe(byNumber.get(10104))
    expect(byNumber.get(10101)).not.toBe(byNumber.get(10103))
    // No seat was left behind by the reshuffle.
    expect(await findUnitlessPlacedSeats(site.id)).toEqual([])
  })
})

describe('deleteInventoryItems — bulk parcel delete (real DB)', () => {
  it('one call removes the parcel, dissolves its SunbedGroups, clears survivor pairId', async () => {
    const { user, site, seats, pool } = await seedGeoParcel()

    // Pair seats 1+2 into a SunbedGroup and legacy-pair them (s1 holds s2).
    const g = await prisma.sunbedGroup.create({ data: { siteId: site.id } })
    await prisma.inventoryItem.update({
      where: { id: seats[0]!.id }, data: { sunbedGroupId: g.id, pairId: seats[1]!.id },
    })
    await prisma.inventoryItem.update({
      where: { id: seats[1]!.id }, data: { sunbedGroupId: g.id },
    })
    // A survivor OUTSIDE the selection whose legacy pairId points INTO it —
    // without the pairId sweep the deleteMany would hit the FK.
    const survivor = await createTestInventoryItem(user.id, site.id, {
      number: 20101, locationLat: '36.7300', locationLng: '-4.4300', group: 2,
    })
    await prisma.inventoryItem.update({
      where: { id: survivor.id }, data: { pairId: seats[2]!.id },
    })

    const res = await deleteInventoryItems(site.id, seats.map((x) => x.id))
    expect(res).toEqual(expect.objectContaining({ status: 'ok', deleted: 3 }))

    // Parcel gone; survivor + pool remain; survivor's dangling pairId cleared.
    const remaining = await prisma.inventoryItem.findMany({
      where: { siteId: site.id }, select: { id: true, pairId: true },
    })
    expect(remaining.map((r) => r.id).sort()).toEqual([survivor.id, pool.id].sort())
    expect(remaining.find((r) => r.id === survivor.id)!.pairId).toBeNull()
    expect(await prisma.sunbedGroup.findUnique({ where: { id: g.id } })).toBeNull()
  })

  it('ignores ids from another site (scope boundary of the single delete preserved)', async () => {
    const { site, seats } = await seedGeoParcel()
    const otherOwner = await createTestUser()
    const otherSite = await createTestSite(otherOwner.id)
    const foreign = await createTestInventoryItem(otherOwner.id, otherSite.id, { number: 1 })

    const res = await deleteInventoryItems(site.id, [foreign.id, seats[0]!.id])
    expect(res).toEqual(expect.objectContaining({ status: 'ok', deleted: 1 }))
    expect(await prisma.inventoryItem.findUnique({ where: { id: foreign.id } })).not.toBeNull()
    expect(await prisma.inventoryItem.findUnique({ where: { id: seats[0]!.id } })).toBeNull()
  })
})

describe('syncChairsWithLayout rearrange — pure rotation is set-based and pair-stable (real DB)', () => {
  it('rotating a large paired parcel keeps every SunbedGroup and pairId IDENTICAL (no dissolve/re-mint churn)', async () => {
    const user = await createTestUser()
    mockUserId = user.id
    const site = await createTestSite(user.id, { layoutMode: 'geo' })

    // Build a 200-seat paired parcel through the real create path.
    const config = {
      group: 1, rows: 10, seatsPerRow: 20,
      baseLat: 36.7213, baseLng: -4.4214,
      horizontalGap: 1, verticalGap: 1.5, intraPairGap: 0.3,
      rotation: 0, pairSeats: true,
    } as never
    await syncChairsWithLayout(site.id, config, 'create')

    const before = await prisma.inventoryItem.findMany({
      where: { siteId: site.id },
      select: { id: true, sunbedGroupId: true, pairId: true },
      orderBy: { number: 'asc' },
    })
    expect(before.length).toBe(200)
    expect(before.filter((r) => r.sunbedGroupId).length).toBe(200)

    // Pure rotation (the founder's rotate button): same shape, +5°.
    const t0 = Date.now()
    await syncChairsWithLayout(site.id, { ...(config as object), rotation: 5 } as never, 'rearrange')
    const elapsed = Date.now() - t0
    // eslint-disable-next-line no-console
    console.log(`rearrange(200 paired seats, +5°): ${elapsed}ms`)

    // Pairings must be byte-identical — the slow path re-wrote (and could
    // re-mint) every pair; the set-based path skips unchanged pairs entirely.
    const after = await prisma.inventoryItem.findMany({
      where: { siteId: site.id },
      select: { id: true, sunbedGroupId: true, pairId: true },
      orderBy: { number: 'asc' },
    })
    expect(after).toEqual(before)

    // And the rotation actually applied.
    const ig = await prisma.itemGroup.findFirst({ where: { number: 1 } })
    expect(ig!.rotation).toBe(5)
  })
})
