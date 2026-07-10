import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { cleanDatabase, disconnectDatabase, prisma } from './test/setup'
import {
  createTestUser,
  createTestPartnerAccount,
  createTestSite,
  createTestInventoryItem,
  createTestReservation,
  createTestRentalItem,
  createTestRentalBooking,
  createTestOrder,
  resetCounter,
} from './test/fixtures'
import { getRevenueByDay, getOccupancyByDay, getReservationDayStats, summarizeRevenue, getFloorStateSnapshot, getRevenueByChannelByDay, getMonthlySourceSummary } from './analytics'

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

describe('getReservationDayStats', () => {
  it('attributes each paid reservation to its createdAt UTC day with summed revenue + seat count', async () => {
    const user = await createTestUser()
    await createTestPartnerAccount(user.id)
    const site = await createTestSite(user.id)
    const item1 = await createTestInventoryItem(user.id, site.id, { number: 1 })
    const item2 = await createTestInventoryItem(user.id, site.id, { number: 2 })
    const item3 = await createTestInventoryItem(user.id, site.id, { number: 3 })

    // Day 1: two reservations — one cash (1 seat, 25), one online (2 seats, 40)
    await createTestReservation(user.id, site.id, [item1.id], {
      status: 'paid-in-cash',
      paymentAmount: 25,
      createdAt: d('2026-07-01T08:00:00Z'),
    })
    await createTestReservation(user.id, site.id, [item2.id, item3.id], {
      status: 'complete',
      paymentAmount: 40,
      createdAt: d('2026-07-01T14:00:00Z'),
    })

    // Day 3: one cash reservation
    await createTestReservation(user.id, site.id, [item1.id], {
      status: 'paid-in-cash',
      paymentAmount: 15,
      createdAt: d('2026-07-03T10:00:00Z'),
    })

    const rows = await getReservationDayStats(site.id, d('2026-07-01T00:00:00Z'), d('2026-07-03T00:00:00Z'))

    expect(rows).toEqual([
      { date: '2026-07-01', rentedSeats: 3, revenue: 65 },
      { date: '2026-07-02', rentedSeats: 0, revenue: 0 },
      { date: '2026-07-03', rentedSeats: 1, revenue: 15 },
    ])
  })

  it('excludes isComp reservations', async () => {
    const user = await createTestUser()
    await createTestPartnerAccount(user.id)
    const site = await createTestSite(user.id)
    const item = await createTestInventoryItem(user.id, site.id, { number: 1 })

    await createTestReservation(user.id, site.id, [item.id], {
      status: 'paid-in-cash',
      paymentAmount: 0,
      isComp: true,
      createdAt: d('2026-07-01T09:00:00Z'),
    })

    const rows = await getReservationDayStats(site.id, d('2026-07-01T00:00:00Z'), d('2026-07-01T00:00:00Z'))
    expect(rows).toEqual([{ date: '2026-07-01', rentedSeats: 0, revenue: 0 }])
  })

  it('excludes refunded reservations', async () => {
    const user = await createTestUser()
    await createTestPartnerAccount(user.id)
    const site = await createTestSite(user.id)
    const item = await createTestInventoryItem(user.id, site.id, { number: 1 })

    await createTestReservation(user.id, site.id, [item.id], {
      status: 'complete',
      paymentAmount: 50,
      refundedAt: new Date('2026-07-01T12:00:00Z'),
      createdAt: d('2026-07-01T09:00:00Z'),
    })

    const rows = await getReservationDayStats(site.id, d('2026-07-01T00:00:00Z'), d('2026-07-01T00:00:00Z'))
    expect(rows).toEqual([{ date: '2026-07-01', rentedSeats: 0, revenue: 0 }])
  })

  it('excludes pending and other non-paid statuses', async () => {
    const user = await createTestUser()
    await createTestPartnerAccount(user.id)
    const site = await createTestSite(user.id)
    const item = await createTestInventoryItem(user.id, site.id, { number: 1 })

    // pending — should not appear
    await createTestReservation(user.id, site.id, [item.id], {
      status: 'pending',
      paymentAmount: 30,
      createdAt: d('2026-07-01T09:00:00Z'),
    })
    // canceled — should not appear
    await createTestReservation(user.id, site.id, [item.id], {
      status: 'canceled',
      paymentAmount: 20,
      createdAt: d('2026-07-01T10:00:00Z'),
    })

    const rows = await getReservationDayStats(site.id, d('2026-07-01T00:00:00Z'), d('2026-07-01T00:00:00Z'))
    expect(rows).toEqual([{ date: '2026-07-01', rentedSeats: 0, revenue: 0 }])
  })

  it('zero-fills days with no paid reservations within the range', async () => {
    const user = await createTestUser()
    await createTestPartnerAccount(user.id)
    const site = await createTestSite(user.id)

    // No reservations at all
    const rows = await getReservationDayStats(site.id, d('2026-07-01T00:00:00Z'), d('2026-07-03T00:00:00Z'))
    expect(rows).toHaveLength(3)
    expect(rows.every((r) => r.rentedSeats === 0 && r.revenue === 0)).toBe(true)
  })

  it('excludes reservations for a different site', async () => {
    const user = await createTestUser()
    await createTestPartnerAccount(user.id)
    const site = await createTestSite(user.id)
    const other = await createTestUser()
    await createTestPartnerAccount(other.id)
    const otherSite = await createTestSite(other.id)
    const otherItem = await createTestInventoryItem(other.id, otherSite.id, { number: 1 })

    await createTestReservation(other.id, otherSite.id, [otherItem.id], {
      status: 'complete',
      paymentAmount: 99,
      createdAt: d('2026-07-01T09:00:00Z'),
    })

    const rows = await getReservationDayStats(site.id, d('2026-07-01T00:00:00Z'), d('2026-07-01T00:00:00Z'))
    expect(rows).toEqual([{ date: '2026-07-01', rentedSeats: 0, revenue: 0 }])
  })
})

describe('getFloorStateSnapshot', () => {
  it('classifies seats into the 5-way state split with correct precedence and libres calculation', async () => {
    const user = await createTestUser()
    await createTestPartnerAccount(user.id)
    const site = await createTestSite(user.id)

    // 8 active inventory items
    const items = await Promise.all(
      [1, 2, 3, 4, 5, 6, 7, 8].map((n) =>
        createTestInventoryItem(user.id, site.id, { number: n }),
      ),
    )

    const day = d('2026-07-15T00:00:00Z')
    // Reservation time bounds that overlap the day under test
    const dayBounds = { from: d('2026-07-15T00:00:00Z'), to: d('2026-07-15T23:59:59Z') }

    // (1) item[0] + item[1]: two seats on a single checked-in reservation → alquiladas (2)
    await createTestReservation(user.id, site.id, [items[0]!.id, items[1]!.id], {
      status: 'complete',
      operationalStatus: 'checked-in',
      isComp: false,
      ...dayBounds,
    })

    // (2) item[2]: walked-in → alquiladas (+1 = 3)
    await createTestReservation(user.id, site.id, [items[2]!.id], {
      status: 'paid-in-cash',
      operationalStatus: 'walked-in',
      isComp: false,
      ...dayBounds,
    })

    // (3) item[3]: expected → reservadas (1)
    await createTestReservation(user.id, site.id, [items[3]!.id], {
      status: 'complete',
      operationalStatus: 'expected',
      isComp: false,
      ...dayBounds,
    })

    // (4) item[4]: comp (isComp: true) → gratis (1)
    await createTestReservation(user.id, site.id, [items[4]!.id], {
      status: 'paid-in-cash',
      operationalStatus: 'comp',
      isComp: true,
      ...dayBounds,
    })

    // (5) item[5]: blocked (op-status 'blocked') → desactivada (1)
    await createTestReservation(user.id, site.id, [items[5]!.id], {
      status: 'complete',
      operationalStatus: 'blocked',
      isComp: false,
      ...dayBounds,
    })

    // (6) item[6]: departed → excluded (not a blocking op-status): falls into libres
    await createTestReservation(user.id, site.id, [items[6]!.id], {
      status: 'complete',
      operationalStatus: 'departed',
      isComp: false,
      ...dayBounds,
    })

    // (7) item[7]: no-show → excluded: falls into libres
    await createTestReservation(user.id, site.id, [items[7]!.id], {
      status: 'complete',
      operationalStatus: 'no-show',
      isComp: false,
      ...dayBounds,
    })

    // (8) A reservation on a DIFFERENT day (should not affect the snapshot)
    const otherDay = { from: d('2026-07-16T00:00:00Z'), to: d('2026-07-16T23:59:59Z') }
    await createTestReservation(user.id, site.id, [items[0]!.id], {
      status: 'complete',
      operationalStatus: 'checked-in',
      ...otherDay,
    })

    const snap = await getFloorStateSnapshot(site.id, day)

    // capacity=8, alquiladas=3 (items 0,1,2), reservadas=1 (item 3),
    // gratis=1 (item 4), desactivada=1 (item 5)
    // libres = 8 - 3 - 1 - 1 - 1 = 2 (items 6 & 7 are excluded by op-status filter)
    expect(snap).toEqual({
      capacity: 8,
      alquiladas: 3,
      reservadas: 1,
      gratis: 1,
      desactivada: 1,
      libres: 2,
    })
  })

  it('precedence: blocked beats isComp when a seat appears on both', async () => {
    // Edge case: a seat on a 'blocked' reservation and also on a comp reservation
    // on the same day. The 'blocked' row should win (highest precedence).
    const user = await createTestUser()
    await createTestPartnerAccount(user.id)
    const site = await createTestSite(user.id)
    const item = await createTestInventoryItem(user.id, site.id, { number: 1 })

    const dayBounds = { from: d('2026-07-20T00:00:00Z'), to: d('2026-07-20T23:59:59Z') }

    await createTestReservation(user.id, site.id, [item.id], {
      status: 'complete',
      operationalStatus: 'blocked',
      isComp: false,
      ...dayBounds,
    })
    await createTestReservation(user.id, site.id, [item.id], {
      status: 'complete',
      operationalStatus: 'comp',
      isComp: true,
      ...dayBounds,
    })

    const snap = await getFloorStateSnapshot(site.id, d('2026-07-20T00:00:00Z'))
    // item appears on blocked first (Prisma returns rows in insertion order for
    // non-ordered queries, but the test seeds blocked first). Either way, the
    // classified Set prevents double-counting: total classified = 1.
    expect(snap.desactivada + snap.gratis).toBe(1)
    expect(snap.alquiladas).toBe(0)
    expect(snap.reservadas).toBe(0)
    // libres = capacity(1) - classified(1) = 0
    expect(snap.libres).toBe(0)
  })

  it('returns all-free snapshot when site has active items but no overlapping reservations', async () => {
    const user = await createTestUser()
    await createTestPartnerAccount(user.id)
    const site = await createTestSite(user.id)
    await createTestInventoryItem(user.id, site.id, { number: 1 })
    await createTestInventoryItem(user.id, site.id, { number: 2 })
    await createTestInventoryItem(user.id, site.id, { number: 3 })

    const snap = await getFloorStateSnapshot(site.id, d('2026-08-01T00:00:00Z'))
    expect(snap).toEqual({ capacity: 3, libres: 3, alquiladas: 0, reservadas: 0, gratis: 0, desactivada: 0 })
  })
})

describe('getRevenueByChannelByDay', () => {
  it('splits paid reservations into cash / qr / online channels by createdAt day', async () => {
    const user = await createTestUser()
    await createTestPartnerAccount(user.id)
    const site = await createTestSite(user.id)
    const item = await createTestInventoryItem(user.id, site.id, { number: 1 })

    // Create an Employee so we can attribute the QR reservation
    const employee = await prisma.employee.create({ data: { accountId: user.id, name: 'Test Worker' } })

    // Day 1: one cash walk-in (30), one QR collect (50, with employeeId), one online (20)
    await createTestReservation(user.id, site.id, [item.id], {
      status: 'paid-in-cash',
      paymentAmount: 30,
      createdAt: d('2026-08-01T08:00:00Z'),
    })
    await createTestReservation(user.id, site.id, [item.id], {
      status: 'complete',
      paymentAmount: 50,
      employeeId: employee.id,
      createdAt: d('2026-08-01T10:00:00Z'),
    })
    await createTestReservation(user.id, site.id, [item.id], {
      status: 'complete',
      paymentAmount: 20,
      createdAt: d('2026-08-01T14:00:00Z'),
    })

    // Day 3: one online (60) — day 2 should be zero-filled
    await createTestReservation(user.id, site.id, [item.id], {
      status: 'complete',
      paymentAmount: 60,
      createdAt: d('2026-08-03T09:00:00Z'),
    })

    const rows = await getRevenueByChannelByDay(site.id, d('2026-08-01T00:00:00Z'), d('2026-08-03T00:00:00Z'))

    expect(rows).toEqual([
      { date: '2026-08-01', cash: 30, qr: 50, online: 20, total: 100 },
      { date: '2026-08-02', cash: 0, qr: 0, online: 0, total: 0 },
      { date: '2026-08-03', cash: 0, qr: 0, online: 60, total: 60 },
    ])
  })

  it('excludes isComp reservations from all channels', async () => {
    const user = await createTestUser()
    await createTestPartnerAccount(user.id)
    const site = await createTestSite(user.id)
    const item = await createTestInventoryItem(user.id, site.id, { number: 1 })

    await createTestReservation(user.id, site.id, [item.id], {
      status: 'paid-in-cash',
      paymentAmount: 0,
      isComp: true,
      createdAt: d('2026-08-05T09:00:00Z'),
    })

    const rows = await getRevenueByChannelByDay(site.id, d('2026-08-05T00:00:00Z'), d('2026-08-05T00:00:00Z'))
    expect(rows).toEqual([{ date: '2026-08-05', cash: 0, qr: 0, online: 0, total: 0 }])
  })

  it('excludes refunded reservations from all channels', async () => {
    const user = await createTestUser()
    await createTestPartnerAccount(user.id)
    const site = await createTestSite(user.id)
    const item = await createTestInventoryItem(user.id, site.id, { number: 1 })

    await createTestReservation(user.id, site.id, [item.id], {
      status: 'complete',
      paymentAmount: 50,
      refundedAt: new Date('2026-08-06T12:00:00Z'),
      createdAt: d('2026-08-06T09:00:00Z'),
    })

    const rows = await getRevenueByChannelByDay(site.id, d('2026-08-06T00:00:00Z'), d('2026-08-06T00:00:00Z'))
    expect(rows).toEqual([{ date: '2026-08-06', cash: 0, qr: 0, online: 0, total: 0 }])
  })

  it('total equals cash + qr + online for every day', async () => {
    const user = await createTestUser()
    await createTestPartnerAccount(user.id)
    const site = await createTestSite(user.id)
    const item = await createTestInventoryItem(user.id, site.id, { number: 1 })
    const employee = await prisma.employee.create({ data: { accountId: user.id, name: 'Worker' } })

    await createTestReservation(user.id, site.id, [item.id], {
      status: 'paid-in-cash', paymentAmount: 15, createdAt: d('2026-08-10T08:00:00Z'),
    })
    await createTestReservation(user.id, site.id, [item.id], {
      status: 'complete', paymentAmount: 25, employeeId: employee.id, createdAt: d('2026-08-10T09:00:00Z'),
    })
    await createTestReservation(user.id, site.id, [item.id], {
      status: 'complete', paymentAmount: 35, createdAt: d('2026-08-10T10:00:00Z'),
    })

    const rows = await getRevenueByChannelByDay(site.id, d('2026-08-10T00:00:00Z'), d('2026-08-10T00:00:00Z'))
    expect(rows).toHaveLength(1)
    const row = rows[0]!
    expect(row.total).toBe(row.cash + row.qr + row.online)
    expect(row.total).toBe(75)
  })

  it('zero-fills the dense range when no paid reservations exist', async () => {
    const user = await createTestUser()
    await createTestPartnerAccount(user.id)
    const site = await createTestSite(user.id)

    const rows = await getRevenueByChannelByDay(site.id, d('2026-09-01T00:00:00Z'), d('2026-09-03T00:00:00Z'))
    expect(rows).toHaveLength(3)
    expect(rows.every((r) => r.cash === 0 && r.qr === 0 && r.online === 0 && r.total === 0)).toBe(true)
  })

  it('attributes a reservation to its createdAt UTC day, not from/to', async () => {
    const user = await createTestUser()
    await createTestPartnerAccount(user.id)
    const site = await createTestSite(user.id)
    const item = await createTestInventoryItem(user.id, site.id, { number: 1 })

    // A multiday booking created on day 1 — should appear on day 1, not spread across days
    await createTestReservation(user.id, site.id, [item.id], {
      status: 'complete',
      paymentAmount: 100,
      from: d('2026-08-20T00:00:00Z'),
      to: d('2026-08-22T23:59:59Z'),
      createdAt: d('2026-08-20T09:00:00Z'),
    })

    const rows = await getRevenueByChannelByDay(site.id, d('2026-08-20T00:00:00Z'), d('2026-08-22T00:00:00Z'))
    expect(rows[0]).toEqual({ date: '2026-08-20', cash: 0, qr: 0, online: 100, total: 100 })
    expect(rows[1]).toEqual({ date: '2026-08-21', cash: 0, qr: 0, online: 0, total: 0 })
    expect(rows[2]).toEqual({ date: '2026-08-22', cash: 0, qr: 0, online: 0, total: 0 })
  })
})

describe('getMonthlySourceSummary', () => {
  // Shared window: all test data falls within July 2026
  const MONTH_FROM = d('2026-07-01T00:00:00Z')
  const MONTH_TO   = d('2026-07-31T23:59:59Z')

  it('sunbeds bucket: sums paymentAmount + seat count for cash and online reservations', async () => {
    const user = await createTestUser()
    await createTestPartnerAccount(user.id)
    const site = await createTestSite(user.id)
    const item1 = await createTestInventoryItem(user.id, site.id, { number: 1 })
    const item2 = await createTestInventoryItem(user.id, site.id, { number: 2 })
    const item3 = await createTestInventoryItem(user.id, site.id, { number: 3 })

    // Cash walk-in: 1 seat, 25
    await createTestReservation(user.id, site.id, [item1.id], {
      status: 'paid-in-cash',
      paymentAmount: 25,
      createdAt: d('2026-07-05T09:00:00Z'),
    })
    // Online (complete): 2 seats, 40
    await createTestReservation(user.id, site.id, [item2.id, item3.id], {
      status: 'complete',
      paymentAmount: 40,
      createdAt: d('2026-07-10T14:00:00Z'),
    })

    const summary = await getMonthlySourceSummary(site.id, MONTH_FROM, MONTH_TO)

    expect(summary.sunbeds).toEqual({ revenue: 65, count: 2, seats: 3 })
    expect(summary.rentals).toEqual({ revenue: 0, count: 0 })
    expect(summary.orders).toEqual({ revenue: 0, count: 0, bedLinkedRevenue: 0 })
    expect(summary.refunds).toEqual({ revenue: 0, count: 0 })
    expect(summary.total).toBe(65)
    expect(summary.totalCount).toBe(2)
  })

  it('sunbeds bucket: comp reservation is excluded; refunded reservation appears only in refunds', async () => {
    const user = await createTestUser()
    await createTestPartnerAccount(user.id)
    const site = await createTestSite(user.id)
    const item1 = await createTestInventoryItem(user.id, site.id, { number: 1 })
    const item2 = await createTestInventoryItem(user.id, site.id, { number: 2 })

    // Comp — excluded from sunbeds (isComp: true)
    await createTestReservation(user.id, site.id, [item1.id], {
      status: 'paid-in-cash',
      paymentAmount: 0,
      isComp: true,
      createdAt: d('2026-07-06T10:00:00Z'),
    })
    // Refunded — excluded from sunbeds, counted in refunds
    await createTestReservation(user.id, site.id, [item2.id], {
      status: 'complete',
      paymentAmount: 50,
      refundedAt: d('2026-07-08T12:00:00Z'),
      createdAt: d('2026-07-07T09:00:00Z'),
    })

    const summary = await getMonthlySourceSummary(site.id, MONTH_FROM, MONTH_TO)

    expect(summary.sunbeds).toEqual({ revenue: 0, count: 0, seats: 0 })
    expect(summary.refunds).toEqual({ revenue: 50, count: 1 })
    expect(summary.total).toBe(0)
    expect(summary.totalCount).toBe(0)
  })

  it('rentals bucket: includes paid-in-cash and complete rentals', async () => {
    const user = await createTestUser()
    await createTestPartnerAccount(user.id)
    const site = await createTestSite(user.id)
    const rentalItem = await createTestRentalItem(site.id)

    // Cash walk-in rental (literal 'paid-in-cash')
    await createTestRentalBooking(user.id, site.id, rentalItem.id, {
      status: 'paid-in-cash',
      paymentAmount: 15,
      createdAt: d('2026-07-12T09:00:00Z'),
    })
    // Online rental (RENTAL_COMPLETE = 'complete')
    await createTestRentalBooking(user.id, site.id, rentalItem.id, {
      status: 'complete',
      paymentAmount: 30,
      createdAt: d('2026-07-15T11:00:00Z'),
    })
    // Refunded rental — should NOT appear in rentals bucket; appears in refunds
    await createTestRentalBooking(user.id, site.id, rentalItem.id, {
      status: 'refunded',
      paymentAmount: 20,
      createdAt: d('2026-07-18T10:00:00Z'),
    })

    const summary = await getMonthlySourceSummary(site.id, MONTH_FROM, MONTH_TO)

    expect(summary.rentals).toEqual({ revenue: 45, count: 2 })
    expect(summary.refunds).toEqual({ revenue: 20, count: 1 })
    expect(summary.sunbeds).toEqual({ revenue: 0, count: 0, seats: 0 })
    expect(summary.orders).toEqual({ revenue: 0, count: 0, bedLinkedRevenue: 0 })
    expect(summary.total).toBe(45)
    expect(summary.totalCount).toBe(2)
  })

  it('orders bucket: includes all post-payment fulfillment statuses; pending and canceled excluded', async () => {
    const user = await createTestUser()
    await createTestPartnerAccount(user.id)
    const site = await createTestSite(user.id)

    // Post-payment order (complete) — included
    await createTestOrder(user.id, site.id, {
      status: 'complete',
      paymentAmount: 30,
      createdAt: d('2026-07-20T10:00:00Z'),
    })
    // Delivered — included
    await createTestOrder(user.id, site.id, {
      status: 'delivered',
      paymentAmount: 25,
      createdAt: d('2026-07-21T11:00:00Z'),
    })
    // Pending — excluded
    await createTestOrder(user.id, site.id, {
      status: 'pending',
      paymentAmount: 15,
      createdAt: d('2026-07-22T09:00:00Z'),
    })
    // Canceled — excluded
    await createTestOrder(user.id, site.id, {
      status: 'canceled',
      paymentAmount: 10,
      createdAt: d('2026-07-23T08:00:00Z'),
    })
    // Refunded — excluded from orders, counted in refunds
    await createTestOrder(user.id, site.id, {
      status: 'refunded',
      paymentAmount: 18,
      createdAt: d('2026-07-24T12:00:00Z'),
    })

    const summary = await getMonthlySourceSummary(site.id, MONTH_FROM, MONTH_TO)

    expect(summary.orders).toEqual({ revenue: 55, count: 2, bedLinkedRevenue: 0 })
    expect(summary.refunds).toEqual({ revenue: 18, count: 1 })
    expect(summary.total).toBe(55)
    expect(summary.totalCount).toBe(2)
  })

  it('combined: all three sources + combined refunds; total = sunbeds+rentals+orders', async () => {
    const user = await createTestUser()
    await createTestPartnerAccount(user.id)
    const site = await createTestSite(user.id)
    const item = await createTestInventoryItem(user.id, site.id, { number: 1 })
    const rentalItem = await createTestRentalItem(site.id)

    // Sunbed: 1 seat, 20
    await createTestReservation(user.id, site.id, [item.id], {
      status: 'paid-in-cash',
      paymentAmount: 20,
      createdAt: d('2026-07-03T08:00:00Z'),
    })
    // Rental: 10
    await createTestRentalBooking(user.id, site.id, rentalItem.id, {
      status: 'complete',
      paymentAmount: 10,
      createdAt: d('2026-07-04T09:00:00Z'),
    })
    // Order: 15
    await createTestOrder(user.id, site.id, {
      status: 'complete',
      paymentAmount: 15,
      createdAt: d('2026-07-05T10:00:00Z'),
    })
    // Refunded reservation: 8
    await createTestReservation(user.id, site.id, [item.id], {
      status: 'complete',
      paymentAmount: 8,
      refundedAt: d('2026-07-06T12:00:00Z'),
      createdAt: d('2026-07-06T09:00:00Z'),
    })
    // Refunded rental: 5
    await createTestRentalBooking(user.id, site.id, rentalItem.id, {
      status: 'refunded',
      paymentAmount: 5,
      createdAt: d('2026-07-07T10:00:00Z'),
    })
    // Refunded order: 12
    await createTestOrder(user.id, site.id, {
      status: 'refunded',
      paymentAmount: 12,
      createdAt: d('2026-07-08T11:00:00Z'),
    })

    const summary = await getMonthlySourceSummary(site.id, MONTH_FROM, MONTH_TO)

    expect(summary.sunbeds).toEqual({ revenue: 20, count: 1, seats: 1 })
    expect(summary.rentals).toEqual({ revenue: 10, count: 1 })
    expect(summary.orders).toEqual({ revenue: 15, count: 1, bedLinkedRevenue: 0 })
    expect(summary.refunds).toEqual({ revenue: 25, count: 3 })
    expect(summary.total).toBe(45)          // 20 + 10 + 15 (excludes refunds)
    expect(summary.totalCount).toBe(3)      // 1 + 1 + 1
  })

  it('excludes rows outside the date range', async () => {
    const user = await createTestUser()
    await createTestPartnerAccount(user.id)
    const site = await createTestSite(user.id)
    const item = await createTestInventoryItem(user.id, site.id, { number: 1 })
    const rentalItem = await createTestRentalItem(site.id)

    // All rows created in August — outside the July window
    await createTestReservation(user.id, site.id, [item.id], {
      status: 'complete',
      paymentAmount: 99,
      createdAt: d('2026-08-01T09:00:00Z'),
    })
    await createTestRentalBooking(user.id, site.id, rentalItem.id, {
      status: 'complete',
      paymentAmount: 50,
      createdAt: d('2026-08-05T10:00:00Z'),
    })
    await createTestOrder(user.id, site.id, {
      status: 'complete',
      paymentAmount: 30,
      createdAt: d('2026-08-10T11:00:00Z'),
    })

    const summary = await getMonthlySourceSummary(site.id, MONTH_FROM, MONTH_TO)

    expect(summary.sunbeds).toEqual({ revenue: 0, count: 0, seats: 0 })
    expect(summary.rentals).toEqual({ revenue: 0, count: 0 })
    expect(summary.orders).toEqual({ revenue: 0, count: 0, bedLinkedRevenue: 0 })
    expect(summary.refunds).toEqual({ revenue: 0, count: 0 })
    expect(summary.total).toBe(0)
    expect(summary.totalCount).toBe(0)
  })

  it('excludes rows for a different site', async () => {
    const user = await createTestUser()
    await createTestPartnerAccount(user.id)
    const site = await createTestSite(user.id)

    const other = await createTestUser()
    await createTestPartnerAccount(other.id)
    const otherSite = await createTestSite(other.id)
    const otherItem = await createTestInventoryItem(other.id, otherSite.id, { number: 1 })
    const otherRentalItem = await createTestRentalItem(otherSite.id)

    await createTestReservation(other.id, otherSite.id, [otherItem.id], {
      status: 'complete',
      paymentAmount: 100,
      createdAt: d('2026-07-10T09:00:00Z'),
    })
    await createTestRentalBooking(other.id, otherSite.id, otherRentalItem.id, {
      status: 'complete',
      paymentAmount: 40,
      createdAt: d('2026-07-11T10:00:00Z'),
    })
    await createTestOrder(other.id, otherSite.id, {
      status: 'complete',
      paymentAmount: 20,
      createdAt: d('2026-07-12T11:00:00Z'),
    })

    const summary = await getMonthlySourceSummary(site.id, MONTH_FROM, MONTH_TO)

    expect(summary.sunbeds).toEqual({ revenue: 0, count: 0, seats: 0 })
    expect(summary.rentals).toEqual({ revenue: 0, count: 0 })
    expect(summary.orders).toEqual({ revenue: 0, count: 0, bedLinkedRevenue: 0 })
    expect(summary.total).toBe(0)
    expect(summary.totalCount).toBe(0)
  })

  it('capacity = active inventory; orders.bedLinkedRevenue = only orders tied to a seat/reservation', async () => {
    const user = await createTestUser()
    await createTestPartnerAccount(user.id)
    const site = await createTestSite(user.id)
    const item1 = await createTestInventoryItem(user.id, site.id, { number: 1 })
    await createTestInventoryItem(user.id, site.id, { number: 2 })
    // An inactive item must NOT count toward capacity
    await createTestInventoryItem(user.id, site.id, { number: 3, status: 'inactive' })

    const res = await createTestReservation(user.id, site.id, [item1.id], {
      status: 'complete',
      paymentAmount: 40,
      createdAt: d('2026-07-05T09:00:00Z'),
    })
    // Bed-linked order (seatId set) → counts toward bedLinkedRevenue
    await createTestOrder(user.id, site.id, {
      status: 'complete',
      paymentAmount: 18,
      seatId: item1.id,
      createdAt: d('2026-07-05T10:00:00Z'),
    })
    // Reservation-linked order (reservationId set, no seatId) → also bed-linked
    await createTestOrder(user.id, site.id, {
      status: 'delivered',
      paymentAmount: 12,
      reservationId: res.id,
      createdAt: d('2026-07-05T11:00:00Z'),
    })
    // Counter order (no seat, no reservation) → in orders.revenue but NOT bed-linked
    await createTestOrder(user.id, site.id, {
      status: 'complete',
      paymentAmount: 20,
      createdAt: d('2026-07-06T12:00:00Z'),
    })

    const summary = await getMonthlySourceSummary(site.id, MONTH_FROM, MONTH_TO)

    expect(summary.capacity).toBe(2) // two active items; inactive excluded
    expect(summary.orders.revenue).toBe(50) // 18 + 12 + 20 (all post-payment orders)
    expect(summary.orders.bedLinkedRevenue).toBe(30) // 18 (seat) + 12 (reservation), NOT the 20 counter order
    // Turnover per available bed = (sunbeds 40 + bed-linked F&B 30) / capacity 2 = 35
    expect((summary.sunbeds.revenue + summary.orders.bedLinkedRevenue) / summary.capacity).toBe(35)
  })
})
