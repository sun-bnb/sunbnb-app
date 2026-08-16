/**
 * Track 021 P4 — parcel RESIZE against real Postgres.
 *
 * Before this, a rearrange only repositioned seats: growing left the new
 * positions empty and shrinking stranded the surplus where it stood, so the
 * only way to change dimensions was delete-and-recreate — which destroys every
 * unit identity on the parcel, and with it every device location that would
 * have been assigned there.
 *
 * The contract under test: overlapping spots keep their seat ids, unit ids and
 * persisted ordinals; only the difference is created or removed.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import { cleanDatabase, disconnectDatabase, prisma } from '@/app/test/setup'
import { createTestUser, createTestSite, createTestReservation } from '@/app/test/fixtures'
import { findUnitlessPlacedSeats } from '@repo/data/unit'

let mockUserId: string | null = null
vi.mock('@/app/auth', () => ({
  auth: vi.fn(async () => (mockUserId ? { user: { id: mockUserId } } : null)),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { syncChairsWithLayout } from './actions'

beforeAll(async () => { await cleanDatabase() })
beforeEach(async () => { await cleanDatabase(); mockUserId = null })
afterAll(async () => { await cleanDatabase(); await disconnectDatabase() })

const config = (rows: number, seatsPerRow: number, pairSeats = false) => ({
  group: 1, rows, seatsPerRow,
  baseLat: 36.7213, baseLng: -4.4214,
  horizontalGap: 1, verticalGap: 1.5, intraPairGap: 0.3,
  rotation: 0, pairSeats,
}) as never

async function seedParcel(rows: number, seatsPerRow: number, pairSeats = false) {
  const user = await createTestUser()
  mockUserId = user.id
  const site = await createTestSite(user.id, { layoutMode: 'geo' })
  await syncChairsWithLayout(site.id, config(rows, seatsPerRow, pairSeats), 'create')
  return { user, site }
}

const snapshot = async (siteId: string) => {
  const rows = await prisma.inventoryItem.findMany({
    where: { siteId },
    select: { id: true, number: true, seatLabel: true, sunbedGroupId: true },
    orderBy: { number: 'asc' },
  })
  const units = await prisma.sunbedGroup.findMany({
    where: { siteId }, select: { id: true, seq: true }, orderBy: { id: 'asc' },
  })
  return { rows, units }
}

describe('parcel resize', () => {
  it('a NO-OP resize changes absolutely nothing (no id churn, no label change)', async () => {
    const { site } = await seedParcel(2, 4)
    const before = await snapshot(site.id)

    await syncChairsWithLayout(site.id, config(2, 4), 'rearrange')

    expect(await snapshot(site.id)).toEqual(before)
  })

  it('GROWING adds seats for the new positions and leaves existing spots untouched', async () => {
    const { site } = await seedParcel(2, 4)
    const before = await snapshot(site.id)
    expect(before.rows).toHaveLength(8)

    await syncChairsWithLayout(site.id, config(2, 6), 'rearrange')

    const after = await snapshot(site.id)
    expect(after.rows).toHaveLength(12)
    // Every pre-existing seat keeps its id AND its unit — this is the property
    // that makes an assigned device survive a resize.
    for (const seat of before.rows) {
      const still = after.rows.find((r) => r.id === seat.id)
      expect(still, `seat ${seat.number} disappeared`).toBeDefined()
      expect(still!.sunbedGroupId).toBe(seat.sunbedGroupId)
    }
    // Pre-existing units keep their persisted ordinals.
    for (const unit of before.units) {
      const still = after.units.find((u) => u.id === unit.id)
      expect(still, 'unit disappeared').toBeDefined()
      expect(still!.seq).toBe(unit.seq)
    }
    expect(await findUnitlessPlacedSeats(site.id)).toEqual([])
  })

  it('SHRINKING removes the surplus seats instead of stranding them', async () => {
    const { site } = await seedParcel(2, 6)
    const before = await snapshot(site.id)
    expect(before.rows).toHaveLength(12)

    await syncChairsWithLayout(site.id, config(2, 4), 'rearrange')

    const after = await snapshot(site.id)
    expect(after.rows).toHaveLength(8)
    // Nothing is left sitting at an old position outside the new grid.
    expect(await findUnitlessPlacedSeats(site.id)).toEqual([])
    // Units emptied by the shrink are pruned, not orphaned.
    const empty = await prisma.sunbedGroup.count({
      where: { siteId: site.id, items: { none: {} } },
    })
    expect(empty).toBe(0)
  })

  it('refuses to shrink away a seat with a current or future reservation', async () => {
    const { user, site } = await seedParcel(2, 6)
    const seats = await prisma.inventoryItem.findMany({
      where: { siteId: site.id }, orderBy: { number: 'asc' },
    })
    const doomed = seats[seats.length - 1]!
    await createTestReservation(user.id, site.id, [doomed.id], {
      from: new Date(), to: new Date(Date.now() + 3 * 24 * 3600 * 1000), status: 'complete',
    })

    const res = await syncChairsWithLayout(site.id, config(2, 4), 'rearrange')

    expect(res).toMatchObject({ status: 'error' })
    // Nothing was removed — a booked bed must not vanish under a guest.
    expect(await prisma.inventoryItem.count({ where: { siteId: site.id } })).toBe(12)
  })

  it('grow then shrink round-trips back to the original seat count', async () => {
    const { site } = await seedParcel(1, 4, true)
    const before = await snapshot(site.id)

    await syncChairsWithLayout(site.id, config(1, 8, true), 'rearrange')
    expect((await snapshot(site.id)).rows).toHaveLength(8)

    await syncChairsWithLayout(site.id, config(1, 4, true), 'rearrange')
    const after = await snapshot(site.id)
    expect(after.rows).toHaveLength(4)
    // The original four seats are the survivors, still in their original units.
    for (const seat of before.rows) {
      const still = after.rows.find((r) => r.id === seat.id)
      expect(still, `original seat ${seat.number} did not survive`).toBeDefined()
      expect(still!.sunbedGroupId).toBe(seat.sunbedGroupId)
    }
  })
})

describe('re-pairing preserves unit identity (P4 A2)', () => {
  it('reshaping a paired parcel REUSES unit rows instead of re-minting them', async () => {
    // 1×4 paired → units {1,2} and {3,4}. Reshape to 2×2 paired → the pairs
    // become {1,2} and {3,4} again in a different geometry, so both units must
    // survive untouched.
    const { site } = await seedParcel(1, 4, true)
    const before = await snapshot(site.id)
    expect(new Set(before.rows.map((r) => r.sunbedGroupId)).size).toBe(2)

    await syncChairsWithLayout(site.id, config(2, 2, true), 'rearrange')

    const after = await snapshot(site.id)
    expect(after.rows).toHaveLength(4)
    // Unit ROWS survive — same ids, same persisted ordinals. Before A2 these
    // were dissolved and re-minted, losing both.
    expect(new Set(after.units.map((u) => u.id))).toEqual(new Set(before.units.map((u) => u.id)))
    for (const unit of before.units) {
      expect(after.units.find((u) => u.id === unit.id)!.seq).toBe(unit.seq)
    }
    expect(await findUnitlessPlacedSeats(site.id)).toEqual([])
  })

  it('a re-pair that regroups members keeps a unit per pair and prunes none too many', async () => {
    const { user, site } = await seedParcel(1, 4, true)
    const seats = await prisma.inventoryItem.findMany({
      where: { siteId: site.id }, orderBy: { number: 'asc' },
    })
    // Force a CROSSED prior grouping: (1,3) and (2,4). Re-pairing to adjacent
    // pairs must reuse rather than dissolve, and must not leave orphans.
    const [u1, u2] = await Promise.all([
      prisma.sunbedGroup.create({ data: { siteId: site.id } }),
      prisma.sunbedGroup.create({ data: { siteId: site.id } }),
    ])
    await prisma.inventoryItem.updateMany({
      where: { id: { in: [seats[0]!.id, seats[2]!.id] } }, data: { sunbedGroupId: u1.id },
    })
    await prisma.inventoryItem.updateMany({
      where: { id: { in: [seats[1]!.id, seats[3]!.id] } }, data: { sunbedGroupId: u2.id },
    })
    // Moving every seat out of the units seedParcel created leaves those empty;
    // clear them so the STARTING state is consistent and the assertion below
    // measures what the rearrange did, not what the fixture left behind.
    await prisma.sunbedGroup.deleteMany({ where: { siteId: site.id, items: { none: {} } } })
    void user

    await syncChairsWithLayout(site.id, config(1, 4, true), 'rearrange')

    const after = await snapshot(site.id)
    // Two pairs, two units, every seat placed, nothing orphaned.
    expect(new Set(after.rows.map((r) => r.sunbedGroupId)).size).toBe(2)
    expect(await findUnitlessPlacedSeats(site.id)).toEqual([])
    expect(await prisma.sunbedGroup.count({
      where: { siteId: site.id, items: { none: {} } },
    })).toBe(0)
    // Both surviving units are REUSED rows, not fresh ones.
    const survivingIds = new Set(after.rows.map((r) => r.sunbedGroupId))
    expect([...survivingIds].every((id) => id === u1.id || id === u2.id)).toBe(true)
  })

  it('a reused unit evicts a member that is NOT part of the new pair', async () => {
    // The sharp case: prior unit U = {seat1, seat3}; seat2 sits alone. The new
    // pairing is (1,2), so the pair claims U — and seat3, which pairs with
    // nobody, must not be left inside it. A unit is one physical spot; three
    // beds in it would light three segments on a two-bed parasol.
    const { site } = await seedParcel(1, 3, true)
    const seats = await prisma.inventoryItem.findMany({
      where: { siteId: site.id }, orderBy: { number: 'asc' },
    })
    const u = await prisma.sunbedGroup.create({ data: { siteId: site.id } })
    const solo = await prisma.sunbedGroup.create({ data: { siteId: site.id } })
    await prisma.inventoryItem.updateMany({
      where: { id: { in: [seats[0]!.id, seats[2]!.id] } }, data: { sunbedGroupId: u.id },
    })
    await prisma.inventoryItem.update({
      where: { id: seats[1]!.id }, data: { sunbedGroupId: solo.id },
    })
    await prisma.sunbedGroup.deleteMany({ where: { siteId: site.id, items: { none: {} } } })

    await syncChairsWithLayout(site.id, config(1, 3, true), 'rearrange')

    const members = await prisma.inventoryItem.groupBy({
      by: ['sunbedGroupId'],
      where: { siteId: site.id },
      _count: { _all: true },
    })
    // Two units: one of two beds, one of one. Never a unit of three.
    expect(members.map((m) => m._count._all).sort()).toEqual([1, 2])
    expect(await findUnitlessPlacedSeats(site.id)).toEqual([])
  })

  it('an ODD leftover seat does not get stranded inside a reused pair unit', async () => {
    // 3 seats with pairing on: (1,2) pair up, 3 is left over. Reusing a unit for
    // the pair must not leave the odd seat sharing it — a unit is a physical
    // spot, and a stray bed is its own spot.
    const { site } = await seedParcel(1, 3, true)

    await syncChairsWithLayout(site.id, config(1, 3, true), 'rearrange')

    const rows = await prisma.inventoryItem.findMany({
      where: { siteId: site.id }, select: { number: true, sunbedGroupId: true },
      orderBy: { number: 'asc' },
    })
    expect(rows).toHaveLength(3)
    const bySeat = rows.map((r) => r.sunbedGroupId)
    // The pair shares a unit; the leftover has its own.
    expect(bySeat[0]).toBe(bySeat[1])
    expect(bySeat[2]).not.toBe(bySeat[0])
    expect(await findUnitlessPlacedSeats(site.id)).toEqual([])
  })
})
