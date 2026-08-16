/**
 * Invariant I1 (track 021 P2) against REAL Postgres: every PLACED seat belongs
 * to exactly one unit; a null `sunbedGroupId` means "not placed — in the pool",
 * and nothing else.
 *
 * The gap this closes is specific: pairing only groups seats when `pairSeats`
 * is on, so a parcel created WITHOUT pairing used to produce a whole parcel of
 * unitless seats — and a unitless seat has nothing for a device to mount to and
 * nowhere to carry its persisted label number.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import { cleanDatabase, disconnectDatabase, prisma } from '@/app/test/setup'
import { createTestUser, createTestSite, createTestInventoryItem } from '@/app/test/fixtures'

let mockUserId: string | null = null
vi.mock('@/app/auth', () => ({
  auth: vi.fn(async () => (mockUserId ? { user: { id: mockUserId } } : null)),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { syncChairsWithLayout } from './actions'
import { createInventoryItem, deleteInventoryItem, deleteInventoryItems, deleteItemsByGroup } from '../inventory-actions'
import { createTestPairedUnit } from '@/app/test/fixtures'
import { ensurePlacedSeatsHaveUnits, findUnitlessPlacedSeats } from '@repo/data/unit'
import { recomputeSeatLabels } from '@repo/data/seat-label-db'

beforeAll(async () => { await cleanDatabase() })
beforeEach(async () => { await cleanDatabase(); mockUserId = null })
afterAll(async () => { await cleanDatabase(); await disconnectDatabase() })

const parcelConfig = (pairSeats: boolean) => ({
  group: 1, rows: 2, seatsPerRow: 4,
  baseLat: 36.7213, baseLng: -4.4214,
  horizontalGap: 1, verticalGap: 1.5, intraPairGap: 0.3,
  rotation: 0, pairSeats,
}) as never

describe('I1 — every placed seat has a unit', () => {
  it('a parcel created WITHOUT pairing still gives every seat a unit (the gap)', async () => {
    const user = await createTestUser()
    mockUserId = user.id
    const site = await createTestSite(user.id, { layoutMode: 'geo' })

    await syncChairsWithLayout(site.id, parcelConfig(false), 'create')

    const seats = await prisma.inventoryItem.findMany({
      where: { siteId: site.id }, select: { sunbedGroupId: true },
    })
    expect(seats).toHaveLength(8)
    expect(seats.every((s) => s.sunbedGroupId !== null)).toBe(true)
    // Unpaired seats are units of ONE — eight seats, eight units.
    expect(new Set(seats.map((s) => s.sunbedGroupId)).size).toBe(8)
    expect(await findUnitlessPlacedSeats(site.id)).toEqual([])
  })

  it('a paired parcel yields two-member units, not one per seat', async () => {
    const user = await createTestUser()
    mockUserId = user.id
    const site = await createTestSite(user.id, { layoutMode: 'geo' })

    await syncChairsWithLayout(site.id, parcelConfig(true), 'create')

    const seats = await prisma.inventoryItem.findMany({
      where: { siteId: site.id }, select: { sunbedGroupId: true },
    })
    expect(seats).toHaveLength(8)
    expect(new Set(seats.map((s) => s.sunbedGroupId)).size).toBe(4)
    expect(await findUnitlessPlacedSeats(site.id)).toEqual([])
  })

  it('a single added seat is a unit of one', async () => {
    const user = await createTestUser()
    mockUserId = user.id
    const site = await createTestSite(user.id)

    const res = await createInventoryItem({ siteId: site.id })
    expect(res.status).toBe('ok')

    const seat = await prisma.inventoryItem.findFirstOrThrow({ where: { siteId: site.id } })
    expect(seat.sunbedGroupId).not.toBeNull()
    expect(await findUnitlessPlacedSeats(site.id)).toEqual([])
  })

  it('the backfill is idempotent and leaves POOL seats unitless (they are unplaced)', async () => {
    const user = await createTestUser()
    mockUserId = user.id
    const site = await createTestSite(user.id)

    // Legacy shape: placed seats with no unit, plus a free pool seat.
    await createTestInventoryItem(user.id, site.id, { number: 1, status: 'active' })
    await createTestInventoryItem(user.id, site.id, { number: 2, status: 'inactive' })
    const pool = await createTestInventoryItem(user.id, site.id, { number: 9901, status: 'pool' })

    const first = await ensurePlacedSeatsHaveUnits(site.id)
    expect(first.created).toBe(2)

    // Re-running changes nothing — the property the backfill must have.
    const second = await ensurePlacedSeatsHaveUnits(site.id)
    expect(second.created).toBe(0)

    expect(await findUnitlessPlacedSeats(site.id)).toEqual([])
    const poolRow = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: pool.id } })
    expect(poolRow.sunbedGroupId).toBeNull()

    // Each placed seat got its OWN unit, not a shared one.
    const placed = await prisma.inventoryItem.findMany({
      where: { siteId: site.id, status: { not: 'pool' } }, select: { sunbedGroupId: true },
    })
    expect(new Set(placed.map((p) => p.sunbedGroupId)).size).toBe(2)
  })

  it('is scoped to the site — a neighbour venue is never touched', async () => {
    const user = await createTestUser()
    mockUserId = user.id
    const site = await createTestSite(user.id)
    const other = await createTestSite(user.id)
    await createTestInventoryItem(user.id, site.id, { number: 1 })
    const foreign = await createTestInventoryItem(user.id, other.id, { number: 1 })

    await ensurePlacedSeatsHaveUnits(site.id)

    const foreignRow = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: foreign.id } })
    expect(foreignRow.sunbedGroupId).toBeNull()
    expect(await findUnitlessPlacedSeats(other.id)).toHaveLength(1)
  })
})

describe('deleting a member must not destroy the unit or orphan its siblings', () => {
  it('deleting ONE seat of a pair leaves the survivor IN its unit (I1)', async () => {
    const user = await createTestUser()
    mockUserId = user.id
    const site = await createTestSite(user.id)
    const { group, itemA, itemB } = await createTestPairedUnit(user.id, site.id, [1, 2])

    await deleteInventoryItem(itemA.id)

    const survivor = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: itemB.id } })
    // The bed still stands, so it is still placed — and a placed seat always
    // belongs to a unit. Detaching it would violate I1 and, once devices bind
    // to units, would silently orphan the device mounted there.
    expect(survivor.sunbedGroupId).toBe(group.id)
    expect(await findUnitlessPlacedSeats(site.id)).toEqual([])
    // The unit itself survives — one of its two beds was removed, not the unit.
    expect(await prisma.sunbedGroup.findUnique({ where: { id: group.id } })).not.toBeNull()
  })

  it('bulk-deleting ONE seat of a pair leaves the survivor in its unit (I1)', async () => {
    const user = await createTestUser()
    mockUserId = user.id
    const site = await createTestSite(user.id)
    const { group, itemA, itemB } = await createTestPairedUnit(user.id, site.id, [1, 2])

    await deleteInventoryItems(site.id, [itemA.id])

    const survivor = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: itemB.id } })
    expect(survivor.sunbedGroupId).toBe(group.id)
    expect(await findUnitlessPlacedSeats(site.id)).toEqual([])
  })

  // Founder's rule (2026-08-16): a BROKEN bed is disabled/blocked, not deleted,
  // so the unit stands. Deleting every seat is what dismounts the parasol.
  it('a seat taken OUT OF SERVICE keeps its unit (out of service is not removal)', async () => {
    const user = await createTestUser()
    mockUserId = user.id
    const site = await createTestSite(user.id)
    const { group, itemA } = await createTestPairedUnit(user.id, site.id, [1, 2])

    await prisma.inventoryItem.update({ where: { id: itemA.id }, data: { status: 'disabled' } })

    const seat = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: itemA.id } })
    expect(seat.sunbedGroupId).toBe(group.id)
    expect(await prisma.sunbedGroup.findUnique({ where: { id: group.id } })).not.toBeNull()
    // Still PLACED — out of service is not the pool, so I1 still applies to it.
    expect(await findUnitlessPlacedSeats(site.id)).toEqual([])
  })

  it('deleting the LAST member removes the now-empty unit', async () => {
    const user = await createTestUser()
    mockUserId = user.id
    const site = await createTestSite(user.id)
    const { group, itemA, itemB } = await createTestPairedUnit(user.id, site.id, [1, 2])

    await deleteInventoryItems(site.id, [itemA.id, itemB.id])

    expect(await prisma.sunbedGroup.findUnique({ where: { id: group.id } })).toBeNull()
  })

  it('deleting a whole parcel leaves no orphaned empty units behind', async () => {
    const user = await createTestUser()
    mockUserId = user.id
    const site = await createTestSite(user.id, { layoutMode: 'geo' })
    await syncChairsWithLayout(site.id, parcelConfig(true), 'create')
    expect(await prisma.sunbedGroup.count({ where: { siteId: site.id } })).toBe(4)

    await deleteItemsByGroup(site.id, 1)

    expect(await prisma.inventoryItem.count({ where: { siteId: site.id } })).toBe(0)
    expect(await prisma.sunbedGroup.count({ where: { siteId: site.id } })).toBe(0)
  })
})

describe('I5 — hardware blocks dismounting a spot', () => {
  /** Assign a device to the unit holding `seatNumber`, the way the UI would. */
  async function mountDeviceOn(siteId: string, seatNumber: number, code = 'GUARD1') {
    await recomputeSeatLabels(siteId) // assigns unit ordinals
    const seat = await prisma.inventoryItem.findFirstOrThrow({
      where: { siteId, number: seatNumber },
      select: { group: true, number: true, sunbedGroup: { select: { seq: true } } },
    })
    return prisma.device.create({
      data: {
        code,
        status: 'active',
        assignedSiteId: siteId,
        assignedParcel: seat.group,
        assignedRow: Math.floor(seat.number / 100) % 100,
        assignedSeq: seat.sunbedGroup!.seq!,
      },
    })
  }

  it('REFUSES to delete the last seats of a unit that has a device on it', async () => {
    const user = await createTestUser()
    mockUserId = user.id
    const site = await createTestSite(user.id, { layoutMode: 'geo' })
    await syncChairsWithLayout(site.id, parcelConfig(true), 'create')
    const unitSeats = await prisma.inventoryItem.findMany({
      where: { siteId: site.id }, orderBy: { number: 'asc' }, take: 2,
    })
    await mountDeviceOn(site.id, unitSeats[0]!.number)

    const res = await deleteInventoryItems(site.id, unitSeats.map((s) => s.id))

    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toMatch(/GUARD1/)
    // Nothing was removed — the refusal is all-or-nothing.
    expect(await prisma.inventoryItem.count({ where: { siteId: site.id } })).toBe(8)
  })

  it('ALLOWS removing one bed of a unit that has a device — the spot still stands', async () => {
    const user = await createTestUser()
    mockUserId = user.id
    const site = await createTestSite(user.id, { layoutMode: 'geo' })
    await syncChairsWithLayout(site.id, parcelConfig(true), 'create')
    const unitSeats = await prisma.inventoryItem.findMany({
      where: { siteId: site.id }, orderBy: { number: 'asc' }, take: 2,
    })
    await mountDeviceOn(site.id, unitSeats[0]!.number, 'GUARD2')

    const res = await deleteInventoryItems(site.id, [unitSeats[1]!.id])

    expect(res.status).toBe('ok')
    expect(await prisma.inventoryItem.count({ where: { siteId: site.id } })).toBe(7)
  })

  it('REFUSES a whole-parcel delete when any spot in it carries a device', async () => {
    const user = await createTestUser()
    mockUserId = user.id
    const site = await createTestSite(user.id, { layoutMode: 'geo' })
    await syncChairsWithLayout(site.id, parcelConfig(true), 'create')
    const first = await prisma.inventoryItem.findFirstOrThrow({
      where: { siteId: site.id }, orderBy: { number: 'asc' },
    })
    await mountDeviceOn(site.id, first.number, 'GUARD3')

    const res = await deleteItemsByGroup(site.id, 1)

    expect(res.status).toBe('error')
    expect(await prisma.inventoryItem.count({ where: { siteId: site.id } })).toBe(8)
  })
})
