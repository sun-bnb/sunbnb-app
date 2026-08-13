import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/auth', () => ({
  auth: vi.fn().mockResolvedValue(null),
}))

import { getInvoicesByMonth, getPaidItemsByMonth, getRevenueTrend, getOccupancyTrend, getRevenueCsv, getStaffTill } from './actions'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import { getRevenueByDay, summarizeRevenue, getOccupancyByDay, summarizeOccupancy, getReservationDayStats, toFiguresCsv } from '@repo/data/analytics'
import { getTillByEmployee } from '@repo/data/till'
import { RESERVATION_COMPLETE, ORDER_COMPLETE } from '@repo/data/reservation-status'

const mockAuth = vi.mocked(auth)

const OWNER_ID = 'owner-1'
const OTHER_ID = 'other-partner'
const SITE_ID = 'site-1'

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue(null)
})

function authenticateAsOwner() {
  mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
}

// ─── getInvoicesByMonth ───────────────────────────────────────────────────────

describe('getInvoicesByMonth', () => {
  it('throws when not authenticated', async () => {
    await expect(getInvoicesByMonth(OWNER_ID, 2024, 3)).rejects.toThrow('Not authenticated')
    expect(vi.mocked(prisma.invoice.findMany)).not.toHaveBeenCalled()
  })

  /**
   * BUG-REVEALING: The function receives an `accountId` parameter but IGNORES it,
   * always scoping the query to `session.user.id`. This is the CORRECT security
   * behaviour — prevents one partner from reading another partner's invoices by
   * supplying a foreign accountId. This test asserts the secure behaviour holds.
   */
  it('ignores the passed accountId and scopes the query to session.user.id', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([])

    // Pass a DIFFERENT accountId than the session user — should still filter by session.user.id
    await getInvoicesByMonth(OTHER_ID, 2024, 3)

    expect(vi.mocked(prisma.invoice.findMany)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          accountId: OWNER_ID, // session.user.id, NOT the caller-supplied OTHER_ID
        }),
      })
    )
  })

  it('applies PARTNER issuerType filter to exclude platform-side invoices', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([])

    await getInvoicesByMonth(OWNER_ID, 2024, 3)

    expect(vi.mocked(prisma.invoice.findMany)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          issuerType: 'PARTNER',
        }),
      })
    )
  })

  it('computes the correct UTC month window for a mid-year month', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([])

    await getInvoicesByMonth(OWNER_ID, 2024, 3)

    expect(vi.mocked(prisma.invoice.findMany)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          invoicedAt: {
            gte: new Date(Date.UTC(2024, 2, 1)), // 2024-03-01T00:00:00Z
            lt:  new Date(Date.UTC(2024, 3, 1)), // 2024-04-01T00:00:00Z
          },
        }),
      })
    )
  })

  it('correctly crosses the year boundary for December → January', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([])

    await getInvoicesByMonth(OWNER_ID, 2024, 12)

    expect(vi.mocked(prisma.invoice.findMany)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          invoicedAt: {
            gte: new Date(Date.UTC(2024, 11, 1)), // 2024-12-01T00:00:00Z
            lt:  new Date(Date.UTC(2025, 0, 1)),  // 2025-01-01T00:00:00Z
          },
        }),
      })
    )
  })

  it('includes invoiceLines in the result', async () => {
    authenticateAsOwner()
    const fakeInvoices = [
      { id: 'inv-1', accountId: OWNER_ID, invoiceLines: [{ id: 'line-1', amount: 50 }] },
    ]
    vi.mocked(prisma.invoice.findMany).mockResolvedValue(fakeInvoices as any)

    const result = await getInvoicesByMonth(OWNER_ID, 2024, 3)

    expect(result).toEqual(fakeInvoices)
    expect(vi.mocked(prisma.invoice.findMany)).toHaveBeenCalledWith(
      expect.objectContaining({ include: { invoiceLines: true } })
    )
  })

  it('returns empty array when no invoices exist for the month', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([])

    const result = await getInvoicesByMonth(OWNER_ID, 2024, 3)

    expect(result).toEqual([])
  })
})

// ─── getPaidItemsByMonth ──────────────────────────────────────────────────────

describe('getPaidItemsByMonth', () => {
  it('throws when not authenticated', async () => {
    await expect(getPaidItemsByMonth(SITE_ID, 2024, 3)).rejects.toThrow('Not authenticated')
    expect(vi.mocked(prisma.site.findUnique)).not.toHaveBeenCalled()
  })

  it('throws when the site does not exist', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.site.findUnique).mockResolvedValue(null)

    await expect(getPaidItemsByMonth(SITE_ID, 2024, 3)).rejects.toThrow('Not authorized')
    expect(vi.mocked(prisma.order.findMany)).not.toHaveBeenCalled()
  })

  /**
   * BUG-REVEALING: Ownership gate — a logged-in partner must not be able to
   * retrieve another partner's financial data by supplying a foreign siteId.
   */
  it('throws when the site belongs to a different user (IDOR guard)', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.site.findUnique).mockResolvedValue({ userId: OTHER_ID } as any)

    await expect(getPaidItemsByMonth(SITE_ID, 2024, 3)).rejects.toThrow('Not authorized')
    // Financial queries must NOT be reached for a non-owner
    expect(vi.mocked(prisma.order.findMany)).not.toHaveBeenCalled()
    expect(vi.mocked(prisma.reservation.findMany)).not.toHaveBeenCalled()
  })

  it('verifies site ownership before issuing financial queries', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.site.findUnique).mockResolvedValue({ userId: OWNER_ID, timeZone: 'UTC' } as any)
    vi.mocked(prisma.order.findMany).mockResolvedValue([])
    vi.mocked(prisma.reservation.findMany).mockResolvedValue([])

    await getPaidItemsByMonth(SITE_ID, 2024, 3)

    expect(vi.mocked(prisma.site.findUnique)).toHaveBeenCalledWith({
      where: { id: SITE_ID },
      select: { userId: true, timeZone: true, locationLat: true, locationLng: true },
    })
  })

  it('filters orders by ORDER_COMPLETE status', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.site.findUnique).mockResolvedValue({ userId: OWNER_ID, timeZone: 'UTC' } as any)
    vi.mocked(prisma.order.findMany).mockResolvedValue([])
    vi.mocked(prisma.reservation.findMany).mockResolvedValue([])

    await getPaidItemsByMonth(SITE_ID, 2024, 3)

    expect(vi.mocked(prisma.order.findMany)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          siteId: SITE_ID,
          status: ORDER_COMPLETE,
        }),
      })
    )
  })

  it('filters reservations by RESERVATION_COMPLETE status', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.site.findUnique).mockResolvedValue({ userId: OWNER_ID, timeZone: 'UTC' } as any)
    vi.mocked(prisma.order.findMany).mockResolvedValue([])
    vi.mocked(prisma.reservation.findMany).mockResolvedValue([])

    await getPaidItemsByMonth(SITE_ID, 2024, 3)

    expect(vi.mocked(prisma.reservation.findMany)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          siteId: SITE_ID,
          status: RESERVATION_COMPLETE,
        }),
      })
    )
  })

  it('filters by PARTNER invoices within the correct UTC month window', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.site.findUnique).mockResolvedValue({ userId: OWNER_ID, timeZone: 'UTC' } as any)
    vi.mocked(prisma.order.findMany).mockResolvedValue([])
    vi.mocked(prisma.reservation.findMany).mockResolvedValue([])

    await getPaidItemsByMonth(SITE_ID, 2024, 6)

    const expectedStart = new Date(Date.UTC(2024, 5, 1)) // 2024-06-01
    const expectedEnd   = new Date(Date.UTC(2024, 6, 1)) // 2024-07-01

    expect(vi.mocked(prisma.order.findMany)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          invoices: {
            some: {
              issuerType: 'PARTNER',
              invoicedAt: { gte: expectedStart, lt: expectedEnd },
            },
          },
        }),
      })
    )
    expect(vi.mocked(prisma.reservation.findMany)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          invoices: {
            some: {
              issuerType: 'PARTNER',
              invoicedAt: { gte: expectedStart, lt: expectedEnd },
            },
          },
        }),
      })
    )
  })

  /**
   * BUG-REVEALING (track 017 P4): a Europe/Madrid venue's civil month starts
   * at 22:00 UTC the day before (CEST, UTC+2) — a UTC-anchored window would
   * book the first ~2 local hours of August into July's fiscal/VAT period.
   */
  it('anchors the month window to the venue timezone, not UTC', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.site.findUnique).mockResolvedValue({
      userId: OWNER_ID,
      timeZone: 'Europe/Madrid',
    } as any)
    vi.mocked(prisma.order.findMany).mockResolvedValue([])
    vi.mocked(prisma.reservation.findMany).mockResolvedValue([])

    await getPaidItemsByMonth(SITE_ID, 2025, 8)

    const expectedStart = new Date('2025-07-31T22:00:00.000Z')
    const expectedEnd = new Date('2025-08-31T22:00:00.000Z')

    expect(vi.mocked(prisma.order.findMany)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          invoices: {
            some: {
              issuerType: 'PARTNER',
              invoicedAt: { gte: expectedStart, lt: expectedEnd },
            },
          },
        }),
      })
    )
  })

  it('returns { orders, reservations, tabs } on happy path', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.site.findUnique).mockResolvedValue({ userId: OWNER_ID, timeZone: 'UTC' } as any)
    const fakeOrders = [{ id: 'order-1', status: ORDER_COMPLETE, invoices: [] }]
    const fakeReservations = [{ id: 'res-1', status: RESERVATION_COMPLETE, invoices: [] }]
    const fakeTabs = [{ id: 'inv-tab-1', tableTabId: 'tab-1', issuerType: 'PARTNER', invoiceLines: [], tableTab: { id: 'tab-1', status: 'paid', closedAt: new Date(), table: { number: 3, label: 'Terrace' } } }]
    vi.mocked(prisma.order.findMany).mockResolvedValue(fakeOrders as any)
    vi.mocked(prisma.reservation.findMany).mockResolvedValue(fakeReservations as any)
    vi.mocked(prisma.invoice.findMany).mockResolvedValue(fakeTabs as any)

    const result = await getPaidItemsByMonth(SITE_ID, 2024, 3)

    expect(result).toEqual({ orders: fakeOrders, reservations: fakeReservations, tabs: fakeTabs })
  })

  it('queries PARTNER tab invoices filtered by tableTabId not null and siteId via tableTab relation', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.site.findUnique).mockResolvedValue({ userId: OWNER_ID, timeZone: 'UTC' } as any)
    vi.mocked(prisma.order.findMany).mockResolvedValue([])
    vi.mocked(prisma.reservation.findMany).mockResolvedValue([])
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([])

    const expectedStart = new Date(Date.UTC(2024, 5, 1)) // 2024-06-01
    const expectedEnd   = new Date(Date.UTC(2024, 6, 1)) // 2024-07-01

    await getPaidItemsByMonth(SITE_ID, 2024, 6)

    expect(vi.mocked(prisma.invoice.findMany)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          issuerType: 'PARTNER',
          invoicedAt: { gte: expectedStart, lt: expectedEnd },
          tableTabId: { not: null },
          tableTab: { siteId: SITE_ID },
        }),
      })
    )
  })

  it('includes invoiceLines and tableTab with table number/label in tab query', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.site.findUnique).mockResolvedValue({ userId: OWNER_ID, timeZone: 'UTC' } as any)
    vi.mocked(prisma.order.findMany).mockResolvedValue([])
    vi.mocked(prisma.reservation.findMany).mockResolvedValue([])
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([])

    await getPaidItemsByMonth(SITE_ID, 2024, 6)

    expect(vi.mocked(prisma.invoice.findMany)).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          invoiceLines: true,
          tableTab: expect.objectContaining({
            select: expect.objectContaining({
              id: true,
              status: true,
              closedAt: true,
              table: expect.objectContaining({
                select: expect.objectContaining({ number: true, label: true }),
              }),
            }),
          }),
        }),
      })
    )
  })

  /**
   * BUG-REVEALING: The tab query must NOT fire when the site does not belong to the
   * session user — the ownership check must guard all three queries.
   */
  it('does not query tab invoices when the site belongs to a different user (IDOR guard)', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.site.findUnique).mockResolvedValue({ userId: OTHER_ID } as any)

    await expect(getPaidItemsByMonth(SITE_ID, 2024, 3)).rejects.toThrow('Not authorized')
    expect(vi.mocked(prisma.invoice.findMany)).not.toHaveBeenCalled()
  })

  it('returns empty tabs array when no tab invoices exist for the month', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.site.findUnique).mockResolvedValue({ userId: OWNER_ID, timeZone: 'UTC' } as any)
    vi.mocked(prisma.order.findMany).mockResolvedValue([])
    vi.mocked(prisma.reservation.findMany).mockResolvedValue([])
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([])

    const result = await getPaidItemsByMonth(SITE_ID, 2024, 3)

    expect(result.tabs).toEqual([])
  })
})

// ─── getRevenueTrend ──────────────────────────────────────────────────────────

describe('getRevenueTrend', () => {
  const mockRevenueByDay = vi.mocked(getRevenueByDay)
  const mockSummarize = vi.mocked(summarizeRevenue)

  it('throws when not authenticated', async () => {
    await expect(getRevenueTrend(SITE_ID, 30)).rejects.toThrow('Not authenticated')
    expect(mockRevenueByDay).not.toHaveBeenCalled()
  })

  it('throws when the site belongs to another partner', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.site.findUnique).mockResolvedValue({ userId: OTHER_ID } as any)
    await expect(getRevenueTrend(SITE_ID, 30)).rejects.toThrow('Not authorized')
    expect(mockRevenueByDay).not.toHaveBeenCalled()
  })

  it('aggregates a 7-day window and returns rows + summary', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.site.findUnique).mockResolvedValue({ userId: OWNER_ID } as any)
    const rows = [{ date: '2026-06-18', revenue: 16, count: 2 }]
    mockRevenueByDay.mockResolvedValue(rows)
    mockSummarize.mockReturnValue({ totalRevenue: 16, totalCount: 2, bestDay: rows[0]! })

    const res = await getRevenueTrend(SITE_ID, 7)

    expect(res).toEqual({ rows, summary: { totalRevenue: 16, totalCount: 2, bestDay: rows[0] } })
    const [siteId, from, to] = mockRevenueByDay.mock.calls[0]!
    expect(siteId).toBe(SITE_ID)
    const spanDays = Math.round((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000))
    expect(spanDays).toBe(6) // 7-day inclusive window → 6 day span
    expect(mockSummarize).toHaveBeenCalledWith(rows)
  })

  it('clamps an invalid window to 30 days', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.site.findUnique).mockResolvedValue({ userId: OWNER_ID } as any)
    mockRevenueByDay.mockResolvedValue([])

    await getRevenueTrend(SITE_ID, 999)

    const [, from, to] = mockRevenueByDay.mock.calls[0]!
    const spanDays = Math.round((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000))
    expect(spanDays).toBe(29) // clamped 30-day window
  })
})

// ─── getOccupancyTrend ────────────────────────────────────────────────────────

describe('getOccupancyTrend', () => {
  const mockOccByDay = vi.mocked(getOccupancyByDay)
  const mockSummarizeOcc = vi.mocked(summarizeOccupancy)

  it('throws when not authenticated', async () => {
    await expect(getOccupancyTrend(SITE_ID, 30)).rejects.toThrow('Not authenticated')
    expect(mockOccByDay).not.toHaveBeenCalled()
  })

  it('throws when the site belongs to another partner', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.site.findUnique).mockResolvedValue({ userId: OTHER_ID } as any)
    await expect(getOccupancyTrend(SITE_ID, 30)).rejects.toThrow('Not authorized')
    expect(mockOccByDay).not.toHaveBeenCalled()
  })

  it('aggregates the window and returns rows + summary', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.site.findUnique).mockResolvedValue({ userId: OWNER_ID } as any)
    const rows = [{
      date: '2026-06-18', capacity: 4, blocked: 0, sellable: 4,
      occupied: 2, comps: 1, held: 0, unconfirmed: 0, occupancyPct: 50,
    }]
    mockOccByDay.mockResolvedValue(rows)
    mockSummarizeOcc.mockReturnValue({ avgOccupancyPct: 50, peakOccupancyPct: 50, totalComps: 1 })

    const res = await getOccupancyTrend(SITE_ID, 30)

    expect(res).toEqual({ rows, summary: { avgOccupancyPct: 50, peakOccupancyPct: 50, totalComps: 1 } })
    expect(mockOccByDay.mock.calls[0]![0]).toBe(SITE_ID)
    expect(mockSummarizeOcc).toHaveBeenCalledWith(rows)
  })

  it('clamps an invalid window to 30 days', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.site.findUnique).mockResolvedValue({ userId: OWNER_ID } as any)
    mockOccByDay.mockResolvedValue([])

    await getOccupancyTrend(SITE_ID, -1)

    const [, from, to] = mockOccByDay.mock.calls[0]!
    const spanDays = Math.round((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000))
    expect(spanDays).toBe(29)
  })
})

// ─── getRevenueCsv ────────────────────────────────────────────────────────────

describe('getRevenueCsv', () => {
  // Reservation-driven (getReservationDayStats), NOT invoice-driven — the file
  // must match the on-screen trend. The invoice register is a separate export.
  const mockDayStats = vi.mocked(getReservationDayStats)
  const mockCsv = vi.mocked(toFiguresCsv)

  it('throws when not authenticated', async () => {
    await expect(getRevenueCsv(SITE_ID, 30)).rejects.toThrow('Not authenticated')
    expect(mockDayStats).not.toHaveBeenCalled()
  })

  it('throws when the site belongs to another partner', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.site.findUnique).mockResolvedValue({ userId: OTHER_ID } as any)
    await expect(getRevenueCsv(SITE_ID, 30)).rejects.toThrow('Not authorized')
    expect(mockDayStats).not.toHaveBeenCalled()
  })

  it('serializes the window rows to CSV from the reservation-driven seat/revenue source', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.site.findUnique).mockResolvedValue({ userId: OWNER_ID } as any)
    const rows = [{ date: '2026-06-18', rentedSeats: 2, revenue: 16 }]
    mockDayStats.mockResolvedValue(rows)
    mockCsv.mockReturnValue('date,sunbeds,revenue\n2026-06-18,2,16.00\n')

    const csv = await getRevenueCsv(SITE_ID, 7)

    expect(mockCsv).toHaveBeenCalledWith(rows)
    expect(csv).toBe('date,sunbeds,revenue\n2026-06-18,2,16.00\n')
  })
})

describe('getStaffTill', () => {
  const mockTillByEmployee = vi.mocked(getTillByEmployee)

  it('throws when not authenticated', async () => {
    await expect(getStaffTill(SITE_ID, 2026, 6)).rejects.toThrow('Not authenticated')
    expect(mockTillByEmployee).not.toHaveBeenCalled()
  })

  it('throws when the site belongs to another partner', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.site.findUnique).mockResolvedValue({ userId: OTHER_ID } as any)
    await expect(getStaffTill(SITE_ID, 2026, 6)).rejects.toThrow('Not authorized')
    expect(mockTillByEmployee).not.toHaveBeenCalled()
  })

  it('delegates to getTillByEmployee with whole-month bounds', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.site.findUnique).mockResolvedValue({ userId: OWNER_ID, timeZone: 'UTC' } as any)
    const rows = [{ employeeId: 'e1', name: 'Alice', active: true, total: 30, count: 3 }]
    mockTillByEmployee.mockResolvedValue(rows)

    const res = await getStaffTill(SITE_ID, 2026, 6)

    expect(res).toEqual(rows)
    const [siteId, from, to] = mockTillByEmployee.mock.calls[0]!
    expect(siteId).toBe(SITE_ID)
    // June 2026: from = 1 Jun 00:00 UTC, to = last ms of 30 Jun.
    expect(from.toISOString()).toBe('2026-06-01T00:00:00.000Z')
    expect(to.toISOString()).toBe('2026-06-30T23:59:59.999Z')
  })

  /**
   * BUG-REVEALING (track 017 P4): a Europe/Madrid venue's civil month starts
   * at 22:00 UTC the day before (CEST, UTC+2) — a UTC-anchored window would
   * book the first ~2 local hours of August into July's fiscal period.
   */
  it('anchors the month window to the venue timezone, not UTC', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.site.findUnique).mockResolvedValue({
      userId: OWNER_ID,
      timeZone: 'Europe/Madrid',
    } as any)
    mockTillByEmployee.mockResolvedValue([])

    await getStaffTill(SITE_ID, 2026, 8)

    const [, from, to] = mockTillByEmployee.mock.calls[0]!
    expect(from.toISOString()).toBe('2026-07-31T22:00:00.000Z')
    expect(to.toISOString()).toBe('2026-08-31T21:59:59.999Z')
  })
})
