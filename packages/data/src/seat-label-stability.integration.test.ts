/**
 * Track 021 P3 — a unit's label must survive its NEIGHBOURS changing.
 *
 * Before P3 the unit ordinal in `{parcel}-{row}{seq}-{member}` was a positional
 * index recomputed site-wide after almost every mutation, so inserting or
 * removing one unit renamed every unit to its right — while the number painted
 * on the bed stayed exactly where it was. These tests pin the fix against real
 * Postgres, and pin that the FIRST run changes nothing (the ordinals are seeded
 * from today's positional order, so no label moves on release).
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import prisma from '../index'
import { cleanDatabase } from './test/setup'
import { recomputeSeatLabels } from './seat-label-db'

beforeAll(async () => { await cleanDatabase() })
beforeEach(async () => { await cleanDatabase() })
afterAll(async () => { await cleanDatabase(); await prisma.$disconnect() })

async function seedSite() {
  const user = await prisma.user.create({
    data: { email: `p3-${Date.now()}-${Math.round(performance.now())}@test.local`, name: 'P3' },
  })
  const site = await prisma.site.create({
    data: {
      userId: user.id, name: 'P3 Site', services: [], status: 'active',
      locationLat: '36.7213', locationLng: '-4.4214',
    },
  })
  return { user, site }
}

/** One unit of `members` seats in (parcel 1, row 1), at the given seat indices. */
async function addUnit(userId: string, siteId: string, seatIdxs: number[]) {
  const unit = await prisma.sunbedGroup.create({ data: { siteId } })
  for (const idx of seatIdxs) {
    await prisma.inventoryItem.create({
      data: {
        userId, siteId, number: 10100 + idx, status: 'active',
        locationLat: '36.7', locationLng: '-4.4', group: 1, sunbedGroupId: unit.id,
      },
    })
  }
  return unit
}

const labelsBySeat = async (siteId: string) => {
  const rows = await prisma.inventoryItem.findMany({
    where: { siteId }, select: { number: true, seatLabel: true }, orderBy: { number: 'asc' },
  })
  return Object.fromEntries(rows.map((r) => [r.number, r.seatLabel]))
}

describe('unit label stability', () => {
  it('the first recompute assigns ordinals WITHOUT changing any label', async () => {
    const { user, site } = await seedSite()
    await addUnit(user.id, site.id, [1, 2])
    await addUnit(user.id, site.id, [3, 4])

    await recomputeSeatLabels(site.id)
    const before = await labelsBySeat(site.id)
    expect(before).toEqual({ 10101: '1-101-1', 10102: '1-101-2', 10103: '1-102-1', 10104: '1-102-2' })

    // Idempotent: running again neither moves a label nor re-seeds an ordinal.
    await recomputeSeatLabels(site.id)
    expect(await labelsBySeat(site.id)).toEqual(before)
  })

  it('inserting a unit BETWEEN two others does not rename the one to its right', async () => {
    const { user, site } = await seedSite()
    await addUnit(user.id, site.id, [1, 2])
    const right = await addUnit(user.id, site.id, [7, 8])
    await recomputeSeatLabels(site.id)
    const before = await labelsBySeat(site.id)
    expect(before[10107]).toBe('1-102-1')

    // A new unit lands physically between them (seat indices 3,4).
    await addUnit(user.id, site.id, [3, 4])
    await recomputeSeatLabels(site.id)

    const after = await labelsBySeat(site.id)
    // THE POINT: the right-hand unit keeps its name; the newcomer takes a free one.
    expect(after[10107]).toBe('1-102-1')
    expect(after[10101]).toBe(before[10101])
    expect(after[10103]).toBe('1-103-1')
    const rightRow = await prisma.sunbedGroup.findUniqueOrThrow({ where: { id: right.id } })
    expect(rightRow.seq).toBe(2)
  })

  it('removing a unit does not renumber the ones after it (a gap is fine)', async () => {
    const { user, site } = await seedSite()
    const first = await addUnit(user.id, site.id, [1, 2])
    await addUnit(user.id, site.id, [3, 4])
    await addUnit(user.id, site.id, [5, 6])
    await recomputeSeatLabels(site.id)
    const before = await labelsBySeat(site.id)
    expect(before[10105]).toBe('1-103-1')

    await prisma.inventoryItem.deleteMany({ where: { sunbedGroupId: first.id } })
    await prisma.sunbedGroup.delete({ where: { id: first.id } })
    await recomputeSeatLabels(site.id)

    const after = await labelsBySeat(site.id)
    // Units 2 and 3 keep their names — the gap at 01 is deliberate.
    expect(after[10103]).toBe('1-102-1')
    expect(after[10105]).toBe('1-103-1')
  })
})
