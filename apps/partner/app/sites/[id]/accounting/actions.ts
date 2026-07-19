'use server'

import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import {
  RESERVATION_COMPLETE,
  ORDER_COMPLETE,
} from '@repo/data/reservation-status'
import { getMonthlyFiscalReport as _getMonthlyFiscalReport } from '@repo/data/fiscal'
import {
  getRevenueByDay,
  summarizeRevenue,
  getOccupancyByDay,
  summarizeOccupancy,
  toFiguresCsv,
  getReservationDayStats,
  summarizeReservationStats,
  getFloorStateSnapshot,
  getRevenueByChannelByDay,
  summarizeRevenueByChannel,
  getMonthlySourceSummary,
  type FloorStateSnapshot,
  type MonthlySourceSummary,
} from '@repo/data/analytics'
import { getTillByEmployee, getEmployeeShiftItems } from '@repo/data/till'

/**
 * Per-employee cash breakdown for the selected accounting month — the manager
 * retrospective on who rang up how much floor cash (walk-ins + cash rentals).
 * The on-site till (manage page) is the live per-shift view; this is the durable
 * monthly roll-up Alonso's day-reset model can't keep. Session-gated + site
 * ownership (mirrors getPaidItemsByMonth); aggregation in `@repo/data/till`.
 * Returns the roster zero-filled (empty array ⇒ the account has no staff).
 */
export async function getStaffTill(siteId: string, year: number, month: number) {
  const session = await auth()
  if (!session?.user) throw new Error('Not authenticated')

  const site = await prisma.site.findUnique({ where: { id: siteId }, select: { userId: true } })
  if (!site || site.userId !== session.user.id) throw new Error('Not authorized')

  // Whole-month bounds (getTillByEmployee uses createdAt gte..lte, inclusive).
  const from = new Date(Date.UTC(year, month - 1, 1))
  const to = new Date(Date.UTC(year, month, 1) - 1)
  return getTillByEmployee(siteId, from, to)
}

/**
 * Total takings for the selected calendar month — the operator's real cash-in
 * figure (cash walk-ins + card/QR + online, `paymentAmount`-based), the takings
 * counterpart to the invoice-based fiscal summary (`getPaidItemsByMonth`, which
 * counts only `complete`/invoiced sales and so excludes cash walk-ins). Reuses the
 * takings day-stats helper over whole-month bounds; session + site-ownership gate.
 */
export async function getMonthlyTakings(siteId: string, year: number, month: number) {
  const session = await auth()
  if (!session?.user) throw new Error('Not authenticated')

  const site = await prisma.site.findUnique({ where: { id: siteId }, select: { userId: true } })
  if (!site || site.userId !== session.user.id) throw new Error('Not authorized')

  const from = new Date(Date.UTC(year, month - 1, 1))
  const to = new Date(Date.UTC(year, month, 1) - 1)
  return summarizeReservationStats(await getReservationDayStats(siteId, from, to))
}

/**
 * All-source monthly takings summary for the four summary cards — sunbeds,
 * rentals, orders, and refunds broken out by revenue + count, plus the
 * previous month's total for a month-over-month delta. Calls
 * `getMonthlySourceSummary` from `@repo/data/analytics` for both the
 * selected month and the preceding month; returns `{ current, prevTotal }`.
 * Session-gated + site-ownership (mirrors `getMonthlyTakings`).
 */
export async function getMonthlySummary(
  siteId: string,
  year: number,
  month: number,
): Promise<{ current: MonthlySourceSummary; prevTotal: number }> {
  const session = await auth()
  if (!session?.user) throw new Error('Not authenticated')

  const site = await prisma.site.findUnique({ where: { id: siteId }, select: { userId: true } })
  if (!site || site.userId !== session.user.id) throw new Error('Not authorized')

  // Current-month whole-month UTC bounds
  const from = new Date(Date.UTC(year, month - 1, 1))
  const to = new Date(Date.UTC(year, month, 1) - 1)

  // Previous-month bounds
  const prevYear = month === 1 ? year - 1 : year
  const prevMonth = month === 1 ? 12 : month - 1
  const prevFrom = new Date(Date.UTC(prevYear, prevMonth - 1, 1))
  const prevTo = new Date(Date.UTC(prevYear, prevMonth, 1) - 1)

  const [current, prev] = await Promise.all([
    getMonthlySourceSummary(siteId, from, to),
    getMonthlySourceSummary(siteId, prevFrom, prevTo),
  ])

  return { current, prevTotal: prev.total }
}

/** Rolling-window days the trend lens offers (operational pulse vs the
 *  calendar-month accounting view). Includes 1 so the Alonso "Today" filter
 *  can request a single-day window via getOperationsTrend. */
const TREND_WINDOWS = [1, 7, 30, 365] as const
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
 * Per-day revenue split by channel (cash/qr/online) + a summary for a rolling
 * window ending today — the full-takings Revenue lens on the recentTrend chart.
 * Mirrors getOperationsTrend exactly (same auth + site-ownership gate, same
 * TREND_WINDOWS constant). Uses getRevenueByChannelByDay + summarizeRevenueByChannel
 * from @repo/data/analytics. Cash walk-ins, QR-collected, and online self-booked
 * are all included — fixes the invoice-only blind spot of the old getRevenueTrend.
 */
export async function getRevenueChannelTrend(siteId: string, days: number) {
  const session = await auth()
  if (!session?.user) throw new Error('Not authenticated')

  const site = await prisma.site.findUnique({ where: { id: siteId }, select: { userId: true } })
  if (!site || site.userId !== session.user.id) throw new Error('Not authorized')

  const window = (TREND_WINDOWS as readonly number[]).includes(days) ? days : 30
  const to = new Date()
  const from = new Date(to.getTime() - (window - 1) * DAY_MS)

  const rows = await getRevenueByChannelByDay(siteId, from, to)
  return { rows, summary: summarizeRevenueByChannel(rows) }
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

/**
 * Plain CSV figures dump (date, rentals, revenue) for a rolling window — the
 * "just give me the numbers" export. Serialized SERVER-side (the analytics module
 * transitively imports prisma, so it must not be pulled into the client bundle);
 * the client downloads the returned string. Same session + ownership gate.
 */
export async function getRevenueCsv(siteId: string, days: number): Promise<string> {
  const session = await auth()
  if (!session?.user) throw new Error('Not authenticated')

  const site = await prisma.site.findUnique({ where: { id: siteId }, select: { userId: true } })
  if (!site || site.userId !== session.user.id) throw new Error('Not authorized')

  const window = (TREND_WINDOWS as readonly number[]).includes(days) ? days : 30
  const to = new Date()
  const from = new Date(to.getTime() - (window - 1) * DAY_MS)

  return toFiguresCsv(await getRevenueByDay(siteId, from, to))
}

/**
 * Per-day reservation stats (seat count + revenue) + a summary for a rolling
 * window ending today — the Operations lens on the accounting page. Mirrors
 * the exact window / auth pattern of getRevenueTrend; the last row is always
 * "today" so the UI can read it for a Hoy card without a separate action.
 */
export async function getOperationsTrend(siteId: string, days: number) {
  const session = await auth()
  if (!session?.user) throw new Error('Not authenticated')

  const site = await prisma.site.findUnique({ where: { id: siteId }, select: { userId: true } })
  if (!site || site.userId !== session.user.id) throw new Error('Not authorized')

  const window = (TREND_WINDOWS as readonly number[]).includes(days) ? days : 30
  const to = new Date()
  const from = new Date(to.getTime() - (window - 1) * DAY_MS)

  const rows = await getReservationDayStats(siteId, from, to)
  return { rows, summary: summarizeReservationStats(rows) }
}

/**
 * Per-employee shift items for the selected accounting month — granular
 * transaction-level view of floor staff activity (walk-ins + cash rentals).
 * Complements getStaffTill (which gives the monthly cash total per employee);
 * this returns the individual line items. Same whole-month UTC bounds and
 * session + site-ownership gate as getStaffTill.
 */
export async function getStaffShiftItems(siteId: string, year: number, month: number) {
  const session = await auth()
  if (!session?.user) throw new Error('Not authenticated')

  const site = await prisma.site.findUnique({ where: { id: siteId }, select: { userId: true } })
  if (!site || site.userId !== session.user.id) throw new Error('Not authorized')

  const from = new Date(Date.UTC(year, month - 1, 1))
  const to = new Date(Date.UTC(year, month, 1) - 1)
  return getEmployeeShiftItems(siteId, from, to)
}

/**
 * 5-way floor-state snapshot for the site on today's civil UTC day — the
 * *Estado actual de la parcela* Alonso card. Returns libres/alquiladas/
 * reservadas/gratis/desactivada counts. Session-gated + site-ownership
 * (mirrors getRevenueTrend). Aggregation in `@repo/data/analytics`.
 */
export async function getFloorSnapshot(siteId: string): Promise<FloorStateSnapshot> {
  const session = await auth()
  if (!session?.user) throw new Error('Not authenticated')

  const site = await prisma.site.findUnique({ where: { id: siteId }, select: { userId: true } })
  if (!site || site.userId !== session.user.id) throw new Error('Not authorized')

  return getFloorStateSnapshot(siteId, new Date())
}

/**
 * Per-employee shift items for a single civil UTC day — the Alonso per-employee
 * day-scoped view (*Desglose por empleado* + *Cierre de caja empleado*).
 * Computes UTC day bounds from `dateIso` ('YYYY-MM-DD') and delegates to
 * `getEmployeeShiftItems`. Session-gated + site-ownership (mirrors getStaffTill).
 */
export async function getStaffShiftItemsForDay(siteId: string, dateIso: string) {
  const session = await auth()
  if (!session?.user) throw new Error('Not authenticated')

  const site = await prisma.site.findUnique({ where: { id: siteId }, select: { userId: true } })
  if (!site || site.userId !== session.user.id) throw new Error('Not authorized')

  const from = new Date(`${dateIso}T00:00:00.000Z`)
  const to = new Date(`${dateIso}T23:59:59.999Z`)
  return getEmployeeShiftItems(siteId, from, to)
}

/**
 * Invoice-based monthly fiscal summary for the accountant-facing export section.
 * Returns aggregate figures (gross, net, VAT, VAT-by-rate, platform commission,
 * processing fees, refunds) plus one register line per invoice-line for CSV export.
 * Auth mirrors getMonthlyTakings: session-gated + site-ownership check.
 */
export async function getMonthlyFiscalReport(siteId: string, year: number, month: number) {
  const session = await auth()
  if (!session?.user) throw new Error('Not authenticated')

  const site = await prisma.site.findUnique({ where: { id: siteId }, select: { userId: true } })
  if (!site || site.userId !== session.user.id) throw new Error('Not authorized')

  const from = new Date(Date.UTC(year, month - 1, 1))
  const to = new Date(Date.UTC(year, month, 1))
  return _getMonthlyFiscalReport(siteId, from, to)
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

  const [orders, reservations, tabs] = await Promise.all([
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
    // Dine-in tab invoices: PARTNER invoices linked via tableTabId for this site.
    // Tabs have status 'paid' (Mollie/online) or 'settled_cash' (staff cash close).
    // The invoice is the fiscal record; the tab status distinguishes payment method.
    prisma.invoice.findMany({
      where: {
        issuerType: 'PARTNER',
        invoicedAt: { gte: start, lt: end },
        tableTabId: { not: null },
        tableTab: { siteId },
      },
      include: {
        invoiceLines: true,
        tableTab: {
          select: {
            id: true,
            status: true,
            closedAt: true,
            table: { select: { number: true, label: true } },
          },
        },
      },
      orderBy: { invoicedAt: 'desc' },
    }),
  ])

  return { orders, reservations, tabs }
}
