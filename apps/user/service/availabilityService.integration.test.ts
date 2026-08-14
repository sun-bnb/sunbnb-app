/**
 * Integration tests for `getAvailability`'s ORDERING contract (track 020 P1).
 *
 * Why this file exists, given availability semantics are already covered by
 * `siteService.integration.test.ts`:
 *
 * `getAvailability` returns one entry per active seat, and the ORDER of that
 * array is consumed, not just its contents. `pickFirstAvailablePair`
 * (app/sites/[id]/sunbed-preselection.ts) walks it and preselects the first
 * available seat for the guest — the reserve-first behaviour track 014 shipped.
 * That order came from an unordered `findMany`, i.e. from whatever the Postgres
 * planner chose to return. Such an order is stable only by accident: it changes
 * when the table grows past the point where a sequential scan stops winning, or
 * when an index is added (which track 020 P1 does).
 *
 * So this is a requirements test, not a mirror of the implementation: the guest
 * should be preselected the venue's LOWEST-NUMBERED available seat, and that
 * choice must not depend on physical row order. The seats are therefore
 * inserted in deliberately scrambled order — a test that inserted them in
 * ascending order would keep passing with the ordering removed, which is the
 * failure mode this file exists to prevent.
 *
 * Run via: npm run test:integration (requires the sunbnb_test DB).
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { getAvailability } from './availabilityService'
import { cleanDatabase, disconnectDatabase, prisma } from '@/app/test/setup'
import { createTestUser, createTestSite, createTestInventoryItem } from '@/app/test/fixtures'
import { pickFirstAvailablePair } from '@/app/sites/[id]/sunbed-preselection'

beforeEach(async () => {
  await cleanDatabase()
})

afterAll(async () => {
  await disconnectDatabase()
})

/**
 * Seat numbers inserted out of order. Deliberately NOT ascending: the lowest
 * (10) is inserted second, so "first row Postgres returns" and "lowest seat
 * number" are different answers.
 */
const SCRAMBLED = [30, 10, 50, 20, 40]
const LOWEST = 10

async function seedScrambledSite() {
  const user = await createTestUser()
  const site = await createTestSite(user.id, { timeZone: 'Europe/Madrid' })

  for (const number of SCRAMBLED) {
    await createTestInventoryItem(user.id, site.id, { number, status: 'active' })
  }

  const items = await prisma.inventoryItem.findMany({
    where: { siteId: site.id },
    select: { id: true, number: true, pairId: true, sunbedGroupId: true },
  })

  return { user, site, items, numberById: new Map(items.map((i) => [i.id, i.number])) }
}

function todayWindow() {
  const from = new Date()
  from.setHours(0, 0, 0, 0)
  return { from, to: new Date(from.getTime() + 23 * 60 * 60 * 1000) }
}

describe('getAvailability ordering', () => {
  it('returns seats in ascending seat-number order, not insertion order', async () => {
    const { site, numberById } = await seedScrambledSite()
    const { from, to } = todayWindow()

    const availability = await getAvailability(site.id, from, to)

    const numbers = availability.map((a) => numberById.get(a.itemId))
    expect(numbers).toEqual([...SCRAMBLED].sort((a, b) => a - b))
    // Explicitly assert it is NOT insertion order, so the test cannot pass by
    // coincidence on a table that happens to return rows as written.
    expect(numbers).not.toEqual(SCRAMBLED)
  })

  it('preselects the lowest-numbered available seat', async () => {
    const { site, items, numberById } = await seedScrambledSite()
    const { from, to } = todayWindow()

    const availability = await getAvailability(site.id, from, to)
    const picked = pickFirstAvailablePair(availability, items as never)

    expect(picked).toHaveLength(1)
    expect(numberById.get(picked[0]!.id)).toBe(LOWEST)
  })

  it('skips a booked lowest seat and preselects the next lowest', async () => {
    const { user, site, items, numberById } = await seedScrambledSite()
    const { from, to } = todayWindow()

    const lowest = items.find((i) => i.number === LOWEST)!
    await prisma.reservation.create({
      data: {
        userId: user.id,
        siteId: site.id,
        from,
        to,
        status: 'complete',
        items: { connect: { id: lowest.id } },
      },
    })

    const availability = await getAvailability(site.id, from, to)
    const picked = pickFirstAvailablePair(availability, items as never)

    expect(picked).toHaveLength(1)
    expect(numberById.get(picked[0]!.id)).toBe(20)
  })

  it('is stable across repeated calls', async () => {
    const { site } = await seedScrambledSite()
    const { from, to } = todayWindow()

    const first = await getAvailability(site.id, from, to)
    const second = await getAvailability(site.id, from, to)

    expect(first.map((a) => a.itemId)).toEqual(second.map((a) => a.itemId))
  })
})
