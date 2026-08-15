/**
 * getParcelSummaries — the parcel-tier payload (track 020 C2 slice 2).
 *
 * This replaces "ship every seat and group them in JS", so the summaries must
 * agree EXACTLY with what that JS produced: same parcels, same counts, same
 * geometry. The verbatim per-seat grouping runs as the referee.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { cleanDatabase, disconnectDatabase, prisma } from '@/app/test/setup'
import { createTestUser, createTestSite, createTestInventoryItem } from '@/app/test/fixtures'
import { getParcelSummaries } from './parcels'

beforeAll(async () => { await cleanDatabase() })
beforeEach(async () => { await cleanDatabase() })
afterAll(async () => { await cleanDatabase(); await disconnectDatabase() })

/** Pre-C2 client-side grouping, verbatim in spirit: seats → parcels + counts. */
async function oracle(siteId: string) {
  const items = await prisma.inventoryItem.findMany({ where: { siteId } })
  const visible = items.filter((i) => i.status !== 'pool')
  const byGroup: Record<number, number> = {}
  for (const i of visible) if (i.group > 0) byGroup[i.group] = (byGroup[i.group] ?? 0) + 1
  return {
    groups: Object.keys(byGroup).map(Number).sort((a, b) => a - b),
    counts: byGroup,
    ungroupedCount: visible.filter((i) => !(i.group > 0)).length,
  }
}

async function seedParcel(userId: string, siteId: string, group: number, seats: number, geo = true) {
  let itemGroupId: string | undefined
  if (geo) {
    const ig = await prisma.itemGroup.create({
      data: {
        number: group, rows: 1, seatsPerRow: seats,
        locationLat: '36.7213', locationLng: '-4.4214',
        horizontalGap: 1, verticalGap: 1.5, pairGap: 0.3, rotation: 25,
      },
    })
    itemGroupId = ig.id
  }
  for (let n = 0; n < seats; n++) {
    await createTestInventoryItem(userId, siteId, {
      number: group * 1000 + n, group, itemGroupId,
      locationLat: '36.7213', locationLng: '-4.4214',
    })
  }
  return itemGroupId
}

describe('getParcelSummaries', () => {
  it('matches the pre-C2 per-seat grouping and carries ItemGroup geometry', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    await seedParcel(user.id, site.id, 1, 3)
    await seedParcel(user.id, site.id, 2, 5)
    // Ungrouped seat + a pool sentinel (excluded from the editor entirely).
    await createTestInventoryItem(user.id, site.id, { number: 1, group: 0 })
    await createTestInventoryItem(user.id, site.id, { number: 9901, group: 1, status: 'pool' })

    const summary = await getParcelSummaries(site.id)
    const ref = await oracle(site.id)

    expect(summary.parcels.map((p) => p.group)).toEqual(ref.groups)
    for (const p of summary.parcels) expect(p.count).toBe(ref.counts[p.group])
    expect(summary.ungroupedCount).toBe(ref.ungroupedCount)

    // Geometry is what parcelFootprint needs to draw the box without seats.
    const p1 = summary.parcels.find((p) => p.group === 1)!
    expect(p1.itemGroupId).toBeTruthy()
    expect(p1).toMatchObject({
      rows: 1, seatsPerRow: 3, horizontalGap: 1, verticalGap: 1.5, pairGap: 0.3, rotation: 25,
      locationLat: '36.7213', locationLng: '-4.4214',
    })
  })

  it('legacy parcels without an ItemGroup report null geometry (client falls back to seats)', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    await seedParcel(user.id, site.id, 4, 2, /* geo */ false)

    const summary = await getParcelSummaries(site.id)
    const p = summary.parcels.find((x) => x.group === 4)!
    expect(p.count).toBe(2)
    expect(p.itemGroupId).toBeNull()
    expect(p.rotation).toBeNull()
  })

  it('is site-scoped — a neighbour venue never contributes parcels or counts', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    const other = await createTestSite(user.id)
    await seedParcel(user.id, site.id, 1, 2)
    await seedParcel(user.id, other.id, 1, 7)
    await seedParcel(user.id, other.id, 9, 4)

    const summary = await getParcelSummaries(site.id)
    expect(summary.parcels).toHaveLength(1)
    expect(summary.parcels[0]).toMatchObject({ group: 1, count: 2 })
    expect(await oracle(site.id)).toMatchObject({ counts: { 1: 2 } })
  })

  it('empty site yields no parcels', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    expect(await getParcelSummaries(site.id)).toEqual({ parcels: [], ungroupedCount: 0 })
  })
})
