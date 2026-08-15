/**
 * Oracle-equivalence tests for the set-based availability rewrite
 * (track 020 P2) — REAL Postgres.
 *
 * Availability is money-adjacent: it gates what a guest can book and what the
 * conflict guard later re-checks. The rewrite from the JS loop to SQL must
 * therefore be provably equivalent, not plausibly equivalent. The referee here
 * is the ORIGINAL pre-P2 implementation, ported VERBATIM below (same Prisma
 * query incl. the `include: { items, site }` bloat, same dayjs isBetween
 * logic) — every combination in the seeded matrix is answered by both
 * implementations and the answers must match exactly.
 *
 * The matrix covers the semantics that have bitten before:
 *  - every blocking + non-blocking payment status (track 012 flipped these);
 *  - the no-show/departed STAY-OVER release rule (venue-local end-of-today);
 *  - inclusive overlap boundaries (r.to == from and r.from == to BLOCK);
 *  - multi-seat reservations (every seat of a party blocks);
 *  - the absence contract (inactive / foreign-site / bogus ids are ABSENT,
 *    never "available") for the booking-validation variant.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import dayjs from 'dayjs'
import isBetween from 'dayjs/plugin/isBetween'
import { cleanDatabase, disconnectDatabase, prisma } from '@/app/test/setup'
import { createTestUser, createTestSite, createTestInventoryItem } from '@/app/test/fixtures'
import { BLOCKING_STATUSES, OP_NO_SHOW, OP_DEPARTED } from '@repo/data/reservation-status'
import { siteDayBounds } from '@repo/data/site-day'
import { getAvailability, getAvailabilityForItems } from './availabilityService'

dayjs.extend(isBetween)

// ─── The ORACLE: the pre-P2 implementation, verbatim ────────────────────────

function oracleCheckAvailability(reservations: any[], itemId: string, from: Date, to: Date) {
  const periods = reservations.filter(reservation => {
    const idMatch = (reservation.items || []).some((invItem: any) => invItem.id === itemId)
    let overlap = false
    if (idMatch) {
      const first = dayjs(from).isBetween(reservation.from, reservation.to, null, '[]')
      const second = dayjs(to).isBetween(reservation.from, reservation.to, null, '[]')
      const third = (
        dayjs(reservation.from).isBetween(from, to, null, '[]') &&
        dayjs(reservation.to).isBetween(from, to, null, '[]')
      )
      overlap = first || second || third
    }
    return idMatch && overlap
  })
  return {
    itemId,
    available: periods.length === 0,
    periods: periods.map(period => ({ from: period.from, to: period.to })),
  }
}

async function oracleGetAvailability(siteId: string, from: Date, to: Date) {
  const site = await prisma.site.findUnique({
    where: { id: siteId },
    select: { timeZone: true, locationLat: true, locationLng: true },
  })
  const items = await prisma.inventoryItem.findMany({
    where: { siteId, status: 'active' },
    orderBy: { number: 'asc' },
    select: { id: true },
  })
  const itemIds = items.map(item => item.id)
  const endOfToday = siteDayBounds({
    timeZone: site?.timeZone ?? null,
    latitude: site?.locationLat ? parseFloat(site.locationLat) : undefined,
    longitude: site?.locationLng ? parseFloat(site.locationLng) : undefined,
  }).end
  const reservations = await prisma.reservation.findMany({
    where: {
      siteId,
      status: { in: BLOCKING_STATUSES },
      from: { lte: to },
      to: { gte: from },
      NOT: {
        operationalStatus: { in: [OP_NO_SHOW, OP_DEPARTED] },
        to: { lte: endOfToday },
      },
    },
    include: { items: true, site: true },
  })
  return itemIds.map(itemId => oracleCheckAvailability(reservations, itemId, from, to))
}

// ─── Matrix fixture ─────────────────────────────────────────────────────────

const DAY = 86400000
const W0 = new Date(); W0.setHours(0, 0, 0, 0)          // window start: today 00:00 (server-local)
const W2 = new Date(W0.getTime() + 2 * DAY)             // window end

const PAYMENT_STATUSES = [
  'pending', 'processing', 'complete', 'paid-in-cash', 'held', // blocking
  'canceled', 'refunded', 'payment_failed',                    // non-blocking
]
const OP_STATUSES = ['expected', 'checked-in', 'walked-in', 'no-show', 'departed']

// [label, from, to] relative to the query window — boundaries deliberately exact.
const OVERLAPS: Array<[string, Date, Date]> = [
  ['before',      new Date(W0.getTime() - 3 * DAY), new Date(W0.getTime() - 1 * DAY)],
  ['touch-start', new Date(W0.getTime() - 1 * DAY), new Date(W0.getTime())],
  ['inside',      new Date(W0.getTime() + 6 * 3600000), new Date(W0.getTime() + 18 * 3600000)],
  ['touch-end',   new Date(W2.getTime()), new Date(W2.getTime() + 1 * DAY)],
  ['after',       new Date(W2.getTime() + 1 * DAY), new Date(W2.getTime() + 2 * DAY)],
  ['spanning',    new Date(W0.getTime() - 1 * DAY), new Date(W2.getTime() + 1 * DAY)],
]

let siteId: string
let scoped: { activeId: string; inactiveId: string; foreignId: string }

beforeAll(async () => {
  await cleanDatabase()
  const user = await createTestUser()
  const site = await createTestSite(user.id, { timeZone: 'Europe/Madrid' })
  siteId = site.id

  let number = 1
  const seedCombo = async (
    status: string, opStatus: string, resFrom: Date, resTo: Date, seats = 1
  ) => {
    const items = []
    for (let k = 0; k < seats; k++) {
      items.push(await createTestInventoryItem(user.id, site.id, { number: number++ }))
    }
    await prisma.reservation.create({
      data: {
        userId: user.id,
        siteId: site.id,
        from: resFrom,
        to: resTo,
        status,
        operationalStatus: opStatus,
        items: { connect: items.map(i => ({ id: i.id })) },
      },
    })
    return items
  }

  // 1. status × op × {stay-over, future-stay}: one seat each, reservation
  //    overlapping the window. Stay-over: ends today 12:00 (before venue
  //    midnight, > 3h from any tz boundary). Future-stay: ends tomorrow noon.
  for (const status of PAYMENT_STATUSES) {
    for (const op of OP_STATUSES) {
      await seedCombo(status, op, new Date(W0.getTime() - DAY), new Date(W0.getTime() + 12 * 3600000))
      await seedCombo(status, op, new Date(W0.getTime() - DAY), new Date(W0.getTime() + DAY + 12 * 3600000))
    }
  }

  // 2. Overlap-boundary matrix with one canonical blocking status.
  for (const [, f, t] of OVERLAPS) {
    await seedCombo('complete', 'expected', f, t)
  }

  // 3. A 3-seat party (every seat must block) + a seat with NO reservations.
  await seedCombo('complete', 'expected', new Date(W0.getTime() + 3600000), new Date(W0.getTime() + DAY), 3)
  const free = await createTestInventoryItem(user.id, site.id, { number: number++ })

  // 4. Absence-contract fixtures: an inactive seat, and a seat on ANOTHER site.
  const inactive = await createTestInventoryItem(user.id, site.id, {
    number: number++, status: 'inactive',
  })
  const otherSite = await createTestSite(user.id, { name: 'Other Beach' })
  const foreign = await createTestInventoryItem(user.id, otherSite.id, { number: 1 })
  scoped = { activeId: free.id, inactiveId: inactive.id, foreignId: foreign.id }
})

afterAll(async () => {
  await cleanDatabase()
  await disconnectDatabase()
})

// ─── Equivalence ────────────────────────────────────────────────────────────

describe('set-based availability ≡ the pre-P2 implementation', () => {
  it('answers identically for every (status × op-status × stay-over) and overlap combo', async () => {
    const [current, oracle] = await Promise.all([
      getAvailability(siteId, W0, W2),
      oracleGetAvailability(siteId, W0, W2),
    ])

    // ~90 seats seeded — the matrix must actually be populated.
    expect(current.length).toBeGreaterThan(80)
    expect(current.length).toBe(oracle.length)

    for (let i = 0; i < current.length; i++) {
      expect(current[i]!.itemId).toBe(oracle[i]!.itemId) // same ordering contract
      expect(
        { itemId: current[i]!.itemId, available: current[i]!.available },
      ).toEqual(
        { itemId: oracle[i]!.itemId, available: oracle[i]!.available },
      )
      // periods equivalent as (from,to) sets — the old order was incidental.
      const key = (p: { from: Date; to: Date }) => `${p.from.toISOString()}|${p.to.toISOString()}`
      expect(new Set(current[i]!.periods.map(key))).toEqual(new Set(oracle[i]!.periods.map(key)))
    }

    // Sanity: the matrix produces BOTH outcomes in volume (a trivially
    // all-available or all-blocked fixture would prove nothing).
    const blocked = current.filter(a => !a.available).length
    expect(blocked).toBeGreaterThan(20)
    expect(current.length - blocked).toBeGreaterThan(20)
  })

  it('agrees with the oracle for a window in the far future (stay-over rule inert)', async () => {
    const f = new Date(W0.getTime() + 30 * DAY)
    const t = new Date(W0.getTime() + 33 * DAY)
    const [current, oracle] = await Promise.all([
      getAvailability(siteId, f, t),
      oracleGetAvailability(siteId, f, t),
    ])
    expect(current.map(a => ({ i: a.itemId, a: a.available })))
      .toEqual(oracle.map(a => ({ i: a.itemId, a: a.available })))
  })
})

describe('getAvailabilityForItems (booking-validation variant)', () => {
  it('equals the site-wide result filtered to the requested ids', async () => {
    const all = await getAvailability(siteId, W0, W2)
    const sample = [all[0]!, all[Math.floor(all.length / 2)]!, all[all.length - 1]!]
    const scopedResult = await getAvailabilityForItems(
      siteId, sample.map(s => s.itemId), W0, W2
    )
    expect(scopedResult.map(s => ({ i: s.itemId, a: s.available })))
      .toEqual(sample.map(s => ({ i: s.itemId, a: s.available })))
  })

  it('ABSENTS inactive, foreign-site and bogus ids — never reports them available', async () => {
    const result = await getAvailabilityForItems(
      siteId,
      [scoped.activeId, scoped.inactiveId, scoped.foreignId, 'bogus-id-123'],
      W0, W2
    )
    expect(result.map(r => r.itemId)).toEqual([scoped.activeId])
  })

  it('returns [] for an empty id list without querying', async () => {
    expect(await getAvailabilityForItems(siteId, [], W0, W2)).toEqual([])
  })
})
