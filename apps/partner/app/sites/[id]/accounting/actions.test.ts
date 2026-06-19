import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/auth', () => ({
  auth: vi.fn().mockResolvedValue(null),
}))

import { getInvoicesByMonth, getPaidItemsByMonth, getRevenueTrend } from './actions'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import { getRevenueByDay, summarizeRevenue } from '@repo/data/analytics'
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
    vi.mocked(prisma.site.findUnique).mockResolvedValue({ userId: OWNER_ID } as any)
    vi.mocked(prisma.order.findMany).mockResolvedValue([])
    vi.mocked(prisma.reservation.findMany).mockResolvedValue([])

    await getPaidItemsByMonth(SITE_ID, 2024, 3)

    expect(vi.mocked(prisma.site.findUnique)).toHaveBeenCalledWith({
      where: { id: SITE_ID },
      select: { userId: true },
    })
  })

  it('filters orders by ORDER_COMPLETE status', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.site.findUnique).mockResolvedValue({ userId: OWNER_ID } as any)
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
    vi.mocked(prisma.site.findUnique).mockResolvedValue({ userId: OWNER_ID } as any)
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
    vi.mocked(prisma.site.findUnique).mockResolvedValue({ userId: OWNER_ID } as any)
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

  it('returns { orders, reservations } on happy path', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.site.findUnique).mockResolvedValue({ userId: OWNER_ID } as any)
    const fakeOrders = [{ id: 'order-1', status: ORDER_COMPLETE, invoices: [] }]
    const fakeReservations = [{ id: 'res-1', status: RESERVATION_COMPLETE, invoices: [] }]
    vi.mocked(prisma.order.findMany).mockResolvedValue(fakeOrders as any)
    vi.mocked(prisma.reservation.findMany).mockResolvedValue(fakeReservations as any)

    const result = await getPaidItemsByMonth(SITE_ID, 2024, 3)

    expect(result).toEqual({ orders: fakeOrders, reservations: fakeReservations })
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
