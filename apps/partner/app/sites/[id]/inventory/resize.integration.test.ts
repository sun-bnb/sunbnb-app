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
