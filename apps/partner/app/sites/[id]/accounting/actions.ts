'use server'

import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import {
  RESERVATION_COMPLETE,
  ORDER_COMPLETE,
} from '@repo/data/reservation-status'
import {
  getRevenueByDay,
  summarizeRevenue,
  getOccupancyByDay,
  summarizeOccupancy,
} from '@repo/data/analytics'

/** Rolling-window days the trend lens offers (operational pulse vs the
 *  calendar-month accounting view). */
const TREND_WINDOWS = [7, 30, 365] as const
const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Per-day revenue + a summary (total, count, best day) for a rolling window
 * ending today — the dashboard-style "how am I doing lately" lens on the
 * accounting page. Session-gated + site-ownership (mirrors getPaidItemsByMonth);
 * the aggregation lives in `@repo/data/analytics`.
 */
export async function getRevenueTrend(siteId: string, days: number) {
  const session = await auth()
  if (!session?.user) throw new Error('Not authenticated')

  const site = await prisma.site.findUnique({ where: { id: siteId }, select: { userId: true } })
  if (!site || site.userId !== session.user.id) throw new Error('Not authorized')

  const window = (TREND_WINDOWS as readonly number[]).includes(days) ? days : 30
  const to = new Date()
  const from = new Date(to.getTime() - (window - 1) * DAY_MS)

  const rows = await getRevenueByDay(siteId, from, to)
  return { rows, summary: summarizeRevenue(rows) }
}

/**
 * Per-day occupancy + a summary (avg/peak %, comp bed-days) for a rolling window
 * ending today — the comp/occupancy visibility the invoice-driven view can't show
 * (comps carry no revenue). Same session + site-ownership gate as getRevenueTrend.
 */
export async function getOccupancyTrend(siteId: string, days: number) {
  const session = await auth()
  if (!session?.user) throw new Error('Not authenticated')

  const site = await prisma.site.findUnique({ where: { id: siteId }, select: { userId: true } })
  if (!site || site.userId !== session.user.id) throw new Error('Not authorized')

  const window = (TREND_WINDOWS as readonly number[]).includes(days) ? days : 30
  const to = new Date()
  const from = new Date(to.getTime() - (window - 1) * DAY_MS)

  const rows = await getOccupancyByDay(siteId, from, to)
  return { rows, summary: summarizeOccupancy(rows) }
}

export async function getInvoicesByMonth(
  accountId: string,
  year: number,
  month: number
) {
  const session = await auth()
  if (!session?.user) throw new Error('Not authenticated')

  const startDate = new Date(Date.UTC(year, month - 1, 1))
  const endDate = new Date(Date.UTC(year, month, 1))

  return prisma.invoice.findMany({
    where: {
      accountId: session.user.id,
      issuerType: 'PARTNER',
      invoicedAt: {
        gte: startDate,
        lt: endDate,
      },
    },
    include: {
      invoiceLines: true,
    },
    orderBy: { invoicedAt: 'desc' },
  })
}

export async function getPaidItemsByMonth(siteId: string, year: number, month: number) {
  const session = await auth()
  if (!session?.user) throw new Error('Not authenticated')

  // Verify the site belongs to this user
  const site = await prisma.site.findUnique({ where: { id: siteId }, select: { userId: true } })
  if (!site || site.userId !== session.user.id) throw new Error('Not authorized')

  const start = new Date(Date.UTC(year, month - 1, 1))
  const end = new Date(Date.UTC(year, month, 1))

  const [orders, reservations] = await Promise.all([
    prisma.order.findMany({
      where: {
        siteId,
        status: ORDER_COMPLETE,
        invoices: {
          some: {
            issuerType: 'PARTNER',
            invoicedAt: { gte: start, lt: end },
          },
        },
      },
      include: {
        invoices: {
          where: { issuerType: 'PARTNER' },
          include: { invoiceLines: true },
        },
        orderItems: true,
        seat: { select: { number: true, seatLabel: true } },
        user: { select: { email: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.reservation.findMany({
      where: {
        siteId,
        status: RESERVATION_COMPLETE,
        invoices: {
          some: {
            issuerType: 'PARTNER',
            invoicedAt: { gte: start, lt: end },
          },
        },
      },
      include: {
        invoices: {
          where: { issuerType: 'PARTNER' },
          include: { invoiceLines: true },
        },
        user: { select: { email: true } },
        items: { select: { number: true, seatLabel: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
  ])

  return { orders, reservations }
}
