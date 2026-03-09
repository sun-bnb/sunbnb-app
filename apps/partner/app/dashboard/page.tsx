import prisma from '@repo/data/PrismaCient'
import DashboardView, { DashboardData } from './view'
import { auth } from '@/app/auth'


export interface MonthTotals {
  month: string    // e.g. "2025-01"
  revenue: number  // sum of invoice.totalAmount for that month
  fees: number     // sum of invoiceLine.amount for fee‐lines in that month
}

export async function getRevenueAndFeesByMonth(
  userId: string
): Promise<MonthTotals[]> {
  const now = new Date()
  const months: string[] = []

  // 1) Build the last five months (YYYY-MM), oldest first
  for (let i = 4; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const year = d.getFullYear()
    const month = String(d.getMonth() + 1).padStart(2, '0')
    months.push(`${year}-${month}`)
  }

  // 2) Figure out the earliest date (start of the first of those five months)
  const [firstYear, firstMonth] = months[0]!.split('-').map(Number)
  const startOfFirstMonth = new Date(firstYear!, firstMonth! - 1, 1, 0, 0, 0, 0)

  // 3) Run a single grouped query that returns rows for months that have data
  const rawRows: { month: string; revenue: number; fees: number }[] =
    await prisma.$queryRaw`
      SELECT
        month,
        SUM(revenue) AS revenue,
        SUM(fees)    AS fees
      FROM (
        -- 3a) PARTNER invoices = gross revenue
        SELECT
          TO_CHAR(i.invoiced_at, 'YYYY-MM') AS month,
          i.total_amount                   AS revenue,
          0                                AS fees
        FROM "Invoice" AS i
        WHERE i.account_id = ${userId}
          AND i.invoiced_at >= ${startOfFirstMonth}
          AND i.issuer_type = 'PARTNER'

        UNION ALL

        -- 3b) PLATFORM invoices = service fees / commission
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

  // 4) Build a map from month string → { revenue, fees }
  const resultMap: Record<string, { revenue: number; fees: number }> = {}
  for (const row of rawRows) {
    resultMap[row.month] = {
      revenue: Number(row.revenue || 0),
      fees: Number(row.fees || 0),
    }
  }

  // 5) Fill in any months with no data (default to 0)
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

  // 1) Count sites for this user
  const totalSites = await prisma.site.count({
    where: { userId },
  })

  // 2) Fetch all site IDs for this user
  const siteIds = await prisma.site.findMany({
    where: { userId },
    select: { id: true },
  }).then(sites => sites.map(s => s.id))

  // 3) Count total chairs (inventory items) across those sites
  const totalChairs = await prisma.inventoryItem.count({
    where: { siteId: { in: siteIds } }
  })

  // 4) Compute start/end of today in local time
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const endOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    23, 59, 59, 999
  )

  // 5) Count reservations overlapping "today" for those sites
  const reservationsToday = await prisma.reservation.count({
    where: {
      siteId: { in: siteIds },
      from: { lte: endOfToday },
      to:   { gte: startOfToday },
    }
  })

  // 6) Revenue aggregation
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
  const startOfYear = new Date(now.getFullYear(), 0, 1)

  const monthAgg = await prisma.invoice.aggregate({
    where: {
      accountId: userId,
      issuerType: 'PARTNER',
      invoicedAt: { gte: startOfMonth, lte: now },
    },
    _sum: { totalAmount: true },
  })
  const revenueThisMonth = monthAgg._sum.totalAmount ?? 0

  const yearAgg = await prisma.invoice.aggregate({
    where: {
      accountId: userId,
      issuerType: 'PARTNER',
      invoicedAt: { gte: startOfYear, lte: now },
    },
    _sum: { totalAmount: true },
  })
  const revenueYearToDate = yearAgg._sum.totalAmount ?? 0

  const revenueHistory = await getRevenueAndFeesByMonth(userId)

  // 7) Upcoming reservations (next 7 days)
  const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
  const upcomingRaw = await prisma.reservation.findMany({
    where: {
      siteId: { in: siteIds },
      from: { gte: startOfToday, lte: sevenDaysFromNow },
      status: { not: 'cancelled' },
    },
    orderBy: { from: 'asc' },
    take: 8,
    select: {
      id: true,
      from: true,
      to: true,
      status: true,
      site: { select: { name: true, id: true } },
      _count: { select: { items: true } },
    },
  })

  const upcomingReservations = upcomingRaw.map(r => ({
    id: r.id,
    siteName: r.site.name,
    siteId: r.site.id,
    from: r.from.toISOString(),
    to: r.to.toISOString(),
    status: r.status,
    itemCount: r._count.items,
  }))

  return {
    totalSites,
    totalChairs,
    reservationsToday,
    revenueThisMonth,
    revenueYearToDate,
    revenueHistory,
    upcomingReservations,
  }
}



export default async function DashboardPage() {

  const session = await auth()
  if (!session?.user) return null

  const dashboardData = await getDashboardData(session.user.id)

  return (
    <DashboardView data={dashboardData} />
  )
}
