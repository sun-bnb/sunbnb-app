import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { cleanDatabase, disconnectDatabase, prisma } from './test/setup'
import {
  createTestUser,
  createTestPartnerAccount,
  createTestSite,
  createTestInventoryItem,
  createTestReservation,
  resetCounter,
} from './test/fixtures'
import { getRevenueByDay, getOccupancyByDay, summarizeRevenue } from './analytics'

beforeEach(async () => {
  await cleanDatabase()
  resetCounter()
})

afterAll(async () => {
  await disconnectDatabase()
})

const d = (iso: string) => new Date(iso)

/** Create a PARTNER invoice on a specific day, linked to a reservation (for site scoping). */
async function createInvoice(
  accountId: string,
  reservationId: string,
  invoicedAt: Date,
  totalAmount: number,
  overrides: Record<string, unknown> = {},
) {
  return prisma.invoice.create({
    data: {
      accountId,
      issuerType: 'PARTNER',
      invoicedAt,
      totalCharge: totalAmount,
      totalAmount,
      reservationId,
      ...overrides,
    },
  })
}

describe('getRevenueByDay', () => {
  it('groups PARTNER-invoice revenue by day — dense, zero-filled, site-scoped, PARTNER-only', async () => {
    const user = await createTestUser()
    await createTestPartnerAccount(user.id)
    const site = await createTestSite(user.id)
    const item = await createTestInventoryItem(user.id, site.id, { number: 1 })
    const res = await createTestReservation(user.id, site.id, [item.id])

    // Day 1: two PARTNER invoices → 24 / count 2. Day 3: one → 10 / count 1.
    await createInvoice(user.id, res.id, d('2026-06-01T09:00:00Z'), 16)
    await createInvoice(user.id, res.id, d('2026-06-01T18:00:00Z'), 8)
    await createInvoice(user.id, res.id, d('2026-06-03T10:00:00Z'), 10)
    // Excluded: a PLATFORM (commission) invoice on day 1.
    await createInvoice(user.id, res.id, d('2026-06-01T12:00:00Z'), 99, { issuerType: 'PLATFORM' })

    // Excluded: a PARTNER invoice on a DIFFERENT site.
    const other = await createTestUser()
    await createTestPartnerAccount(other.id)
    const otherSite = await createTestSite(other.id)
    const otherItem = await createTestInventoryItem(other.id, otherSite.id, { number: 1 })
    const otherRes = await createTestReservation(other.id, otherSite.id, [otherItem.id])
    await createInvoice(other.id, otherRes.id, d('2026-06-01T12:00:00Z'), 50)

    const rows = await getRevenueByDay(site.id, d('2026-06-01T00:00:00Z'), d('2026-06-03T00:00:00Z'))

    expect(rows).toEqual([
      { date: '2026-06-01', revenue: 24, count: 2 },
      { date: '2026-06-02', revenue: 0, count: 0 },
      { date: '2026-06-03', revenue: 10, count: 1 },
    ])
    expect(summarizeRevenue(rows)).toEqual({
      totalRevenue: 34,
      totalCount: 3,
      bestDay: { date: '2026-06-01', revenue: 24, count: 2 },
    })
  })
})

describe('getOccupancyByDay', () => {
  it('counts distinct occupied + comp beds vs active capacity, excluding no-show/departed', async () => {
    const user = await createTestUser()
    await createTestPartnerAccount(user.id)
    const site = await createTestSite(user.id)
    const items = await Promise.all(
      [1, 2, 3, 4].map((n) => createTestInventoryItem(user.id, site.id, { number: n })),
    )
    const day = { from: d('2026-06-01T00:00:00Z'), to: d('2026-06-01T23:59:59Z') }

    // item1: occupied walk-in; item2: comp; item3: no-show (must be excluded); item4: free.
    await createTestReservation(user.id, site.id, [items[0]!.id], {
      status: 'paid-in-cash', operationalStatus: 'walked-in', ...day,
    })
    await createTestReservation(user.id, site.id, [items[1]!.id], {
      status: 'paid-in-cash', operationalStatus: 'comp', isComp: true, ...day,
    })
    await createTestReservation(user.id, site.id, [items[2]!.id], {
      status: 'paid-in-cash', operationalStatus: 'no-show', ...day,
    })

    const rows = await getOccupancyByDay(site.id, d('2026-06-01T00:00:00Z'), d('2026-06-01T00:00:00Z'))

    expect(rows).toEqual([
      { date: '2026-06-01', capacity: 4, occupied: 2, comps: 1, occupancyPct: 50 },
    ])
  })
})
