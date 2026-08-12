import prisma from '@repo/data/PrismaCient'
import DashboardView, { type DashboardData } from './view'
import { auth } from '@/app/auth'
import {
  RESERVATION_CANCELED,
  RESERVATION_PAYMENT_FAILED,
  RESERVATION_COMPLETE,
  RESERVATION_PAID_IN_CASH,
  BLOCKING_STATUSES,
  OP_CHECKED_IN,
  OP_WALKED_IN,
  ORDER_COMPLETE,
  ORDER_ACCEPTED,
  ORDER_PREPARING,
  ORDER_READY,
} from '@repo/data/reservation-status'
import { getOccupancySnapshotForSites } from '@repo/data/analytics'


// Local to this module — Next.js page modules may only export `default`,
// `metadata`, `viewport`, etc. Any other export trips .next/types validation.
interface MonthTotals {
  month: string
  revenue: number
  fees: number
}

async function getRevenueAndFeesByMonth(
  userId: string
): Promise<MonthTotals[]> {
  const now = new Date()
  const months: string[] = []

  for (let i = 4; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const year = d.getFullYear()
    const month = String(d.getMonth() + 1).padStart(2, '0')
    months.push(`${year}-${month}`)
  }

  const [firstYear, firstMonth] = months[0]!.split('-').map(Number)
  const startOfFirstMonth = new Date(firstYear!, firstMonth! - 1, 1, 0, 0, 0, 0)

  const rawRows: { month: string; revenue: number; fees: number }[] =
    await prisma.$queryRaw`
      SELECT
        month,
        SUM(revenue) AS revenue,
        SUM(fees)    AS fees
      FROM (
        SELECT
          TO_CHAR(i.invoiced_at, 'YYYY-MM') AS month,
          i.total_amount                   AS revenue,
          0                                AS fees
        FROM "Invoice" AS i
        WHERE i.account_id = ${userId}
          AND i.invoiced_at >= ${startOfFirstMonth}
          AND i.issuer_type = 'PARTNER'

        UNION ALL

        SELECT
          TO_CHAR(i.invoiced_at, 'YYYY-MM') AS month,
          0                                AS revenue,
          i.total_amount                   AS fees
        FROM "Invoice" AS i
        WHERE i.account_id = ${userId}
          AND i.invoiced_at >= ${startOfFirstMonth}
          AND i.issuer_type = 'PLATFORM'
      ) AS combined
      GROUP BY month
      ORDER BY month;
    `

  const resultMap: Record<string, { revenue: number; fees: number }> = {}
  for (const row of rawRows) {
    resultMap[row.month] = {
      revenue: Number(row.revenue || 0),
      fees: Number(row.fees || 0),
    }
  }

  return months.map((m) => {
    const entry = resultMap[m]
    return {
      month: m,
      revenue: entry ? entry.revenue : 0,
      fees: entry ? entry.fees : 0,
    }
  })
}


async function getDashboardData(userId: string): Promise<DashboardData> {

  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999)
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
  const startOfYear = new Date(now.getFullYear(), 0, 1)
  const twoHoursFromNow = new Date(now.getTime() + 2 * 60 * 60 * 1000)
  const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)

  // Fetch site IDs
  const sites = await prisma.site.findMany({
    where: { userId },
    select: { id: true, features: true },
  })
  const siteIds = sites.map(s => s.id)
  const hasFnb = sites.some(s => s.features.includes('orders') || s.features.includes('food'))

  // ── Run all independent queries in parallel ───────────────────────────

  const [
    occupancy,
    checkedInCount,
    revenueToday,
    monthAgg,
    yearAgg,
    feesYtd,
    revenueHistory,
    pendingOrders,
    upcomingRaw,
    arrivingSoonRaw,
    canceledThisMonth,
    totalReservationsThisMonth,
  ] = await Promise.all([

    // Today's occupancy — SEATS occupied over SEATS sellable, classified by the
    // same machine-kind partition the trend surfaces use, so the dashboard can't
    // disagree with /manage/trends. Replaces a reservation-ROW count divided by
    // an inventory-SEAT count that also let out-of-service blocks, no-shows, and
    // departures inflate the percentage.
    getOccupancySnapshotForSites(siteIds, startOfToday, endOfToday),

    // Checked in today
    prisma.reservation.count({
      where: {
        siteId: { in: siteIds },
        from: { lte: endOfToday },
        to: { gte: startOfToday },
        status: { in: [...BLOCKING_STATUSES] },
        operationalStatus: { in: [OP_CHECKED_IN, OP_WALKED_IN] },
      },
    }),

    // Revenue today
    prisma.invoice.aggregate({
      where: {
        accountId: userId,
        issuerType: 'PARTNER',
        invoicedAt: { gte: startOfToday, lte: endOfToday },
      },
      _sum: { totalAmount: true },
    }),

    // Revenue this month
    prisma.invoice.aggregate({
      where: {
        accountId: userId,
        issuerType: 'PARTNER',
        invoicedAt: { gte: startOfMonth, lte: now },
      },
      _sum: { totalAmount: true },
    }),

    // Revenue year to date
    prisma.invoice.aggregate({
      where: {
        accountId: userId,
        issuerType: 'PARTNER',
        invoicedAt: { gte: startOfYear, lte: now },
      },
      _sum: { totalAmount: true },
    }),

    // Platform fees year to date
    prisma.invoice.aggregate({
      where: {
        accountId: userId,
        issuerType: 'PLATFORM',
        invoicedAt: { gte: startOfYear, lte: now },
      },
      _sum: { totalAmount: true },
    }),

    // Revenue history (5 months)
    getRevenueAndFeesByMonth(userId),

    // Pending orders needing attention
    hasFnb
      ? prisma.order.count({
          where: {
            siteId: { in: siteIds },
            status: { in: [ORDER_COMPLETE, ORDER_ACCEPTED, ORDER_PREPARING, ORDER_READY] },
          },
        })
      : Promise.resolve(0),

    // Upcoming reservations (next 7 days)
    prisma.reservation.findMany({
      where: {
        siteId: { in: siteIds },
        from: { gte: startOfToday, lte: sevenDaysFromNow },
        status: { not: RESERVATION_CANCELED },
      },
      orderBy: { from: 'asc' },
      take: 8,
      select: {
        id: true,
        from: true,
        to: true,
        status: true,
        operationalStatus: true,
        guestName: true,
        site: { select: { name: true, id: true } },
        _count: { select: { items: true } },
      },
    }),

    // Arriving in next 2 hours (expected but not checked in)
    prisma.reservation.findMany({
      where: {
        siteId: { in: siteIds },
        from: { gte: now, lte: twoHoursFromNow },
        status: { in: [...BLOCKING_STATUSES] },
        operationalStatus: 'expected',
      },
      orderBy: { from: 'asc' },
      take: 6,
      select: {
        id: true,
        from: true,
        to: true,
        guestName: true,
        site: { select: { name: true, id: true } },
        _count: { select: { items: true } },
      },
    }),

    // Canceled reservations this month (for cancellation rate)
    prisma.reservation.count({
      where: {
        siteId: { in: siteIds },
        createdAt: { gte: startOfMonth },
        status: RESERVATION_CANCELED,
      },
    }),

    // Total reservations this month (for cancellation rate)
    prisma.reservation.count({
      where: {
        siteId: { in: siteIds },
        createdAt: { gte: startOfMonth },
      },
    }),
  ])

  // ── Derived metrics ───────────────────────────────────────────────────

  // Occupancy is computed in @repo/data (seats over sellable seats) — rounded
  // here only for display.
  const occupancyPct = Math.round(occupancy.occupancyPct)

  const cancellationPct = totalReservationsThisMonth > 0
    ? Math.round((canceledThisMonth / totalReservationsThisMonth) * 100)
    : 0

  const upcomingReservations = upcomingRaw.map(r => ({
    id: r.id,
    siteName: r.site.name,
    siteId: r.site.id,
    from: r.from.toISOString(),
    to: r.to.toISOString(),
    status: r.status,
    operationalStatus: r.operationalStatus,
    guestName: r.guestName,
    itemCount: r._count.items,
  }))

  const arrivingSoon = arrivingSoonRaw.map(r => ({
    id: r.id,
    siteName: r.site.name,
    siteId: r.site.id,
    from: r.from.toISOString(),
    to: r.to.toISOString(),
    guestName: r.guestName,
    itemCount: r._count.items,
  }))

  return {
    // Today snapshot — seats for the occupancy card, parties for the check-in ratio
    sellableInventory: occupancy.sellable,
    blockedInventory: occupancy.blocked,
    occupiedSeats: occupancy.occupied,
    occupancyPct,
    partiesToday: occupancy.parties,
    checkedInCount,
    pendingOrders,
    hasFnb,

    // Financial
    revenueToday: revenueToday._sum.totalAmount ?? 0,
    revenueThisMonth: monthAgg._sum.totalAmount ?? 0,
    revenueYearToDate: yearAgg._sum.totalAmount ?? 0,
    feesYearToDate: feesYtd._sum.totalAmount ?? 0,
    revenueHistory,

    // Activity
    cancellationPct,
    arrivingSoon,
    upcomingReservations,
  }
}


export default async function DashboardPage() {
  const session = await auth()
  if (!session?.user) return null

  const dashboardData = await getDashboardData(session.user.id)

  return <DashboardView data={dashboardData} />
}
