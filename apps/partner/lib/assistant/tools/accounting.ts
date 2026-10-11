import prisma from '@repo/data/PrismaCient'
import { getMonthlySourceSummary, getRevenueByChannelByDay, summarizeRevenueByChannel } from '@repo/data/analytics'
import { siteDayBounds, siteMonthBounds, type SiteTimezone } from '@repo/data/site-day'
import { defineTool, round2 } from './helpers'

const DAY_MS = 24 * 60 * 60 * 1000
export const TREND_DAYS = [1, 7, 30, 365] as const

function siteTz(site: { timeZone: string | null; locationLat: string | null; locationLng: string | null }): SiteTimezone {
  return {
    timeZone: site.timeZone,
    latitude: site.locationLat ? parseFloat(site.locationLat) : undefined,
    longitude: site.locationLng ? parseFloat(site.locationLng) : undefined,
  }
}

async function loadSiteTz(siteId: string): Promise<SiteTimezone | null> {
  const site = await prisma.site.findUnique({
    where: { id: siteId },
    select: { timeZone: true, locationLat: true, locationLng: true },
  })
  return site ? siteTz(site) : null
}

/** Pure: 'YYYY-MM' -> { year, month } or null. */
export function parseMonth(raw: unknown): { year: number; month: number } | null {
  if (typeof raw !== 'string') return null
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(raw)
  if (!m) return null
  const year = Number(m[1])
  if (year < 2000 || year > 2100) return null
  return { year, month: Number(m[2]) }
}

export const getAccountingSummary = defineTool({
  name: 'get_accounting_summary',
  label: 'Reading accounting',
  description:
    'Takings of the open site for one calendar month (venue-local): total and count, split by source (sunbeds, rentals, orders), refunds, bed capacity, and the previous month total. Amounts are what customers paid (VAT-inclusive).',
  properties: { month: { type: 'string', description: 'YYYY-MM, e.g. 2026-09' } },
  required: ['month'],
  async run(input, ctx) {
    const parsed = parseMonth(input.month)
    if (!parsed) return { ok: false, error: 'invalid_month' }
    const tz = await loadSiteTz(ctx.siteId)
    if (!tz) return { ok: false, error: 'site_not_found' }

    const { year, month } = parsed
    const prev = month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 }
    const cur = siteMonthBounds(tz, year, month)
    const prv = siteMonthBounds(tz, prev.year, prev.month)
    const [current, previous] = await Promise.all([
      getMonthlySourceSummary(ctx.siteId, cur.start, cur.end),
      getMonthlySourceSummary(ctx.siteId, prv.start, prv.end),
    ])
    return {
      month: input.month,
      total: current.total,
      transactions: current.totalCount,
      sunbeds: current.sunbeds,
      rentals: current.rentals,
      orders: { revenue: current.orders.revenue, count: current.orders.count },
      refunds: current.refunds,
      bedCapacity: current.capacity,
      previousMonthTotal: previous.total,
    }
  },
})

export const getRevenueTrend = defineTool({
  name: 'get_revenue_trend',
  label: 'Reading revenue trend',
  description:
    'Revenue of the open site over the last 1, 7, 30 or 365 days ending today (venue-local), split by channel (cash, QR, online) with the best day. Daily rows for up to 30 days, monthly totals for 365.',
  properties: { days: { type: 'integer', enum: [...TREND_DAYS] } },
  required: ['days'],
  async run(input, ctx) {
    const days = input.days as number
    const tz = await loadSiteTz(ctx.siteId)
    if (!tz) return { ok: false, error: 'site_not_found' }

    // Same window as accounting/actions.ts `venueTrendWindow`: noon-anchored so DST can't shift the day.
    const { start: todayStart, end: to } = siteDayBounds(tz)
    const from = siteDayBounds(tz, new Date(todayStart.getTime() - (days - 1) * DAY_MS + 12 * 60 * 60 * 1000)).start

    const rows = await getRevenueByChannelByDay(ctx.siteId, from, to)
    const summary = summarizeRevenueByChannel(rows)
    const series =
      days <= 30
        ? rows.map((r) => ({ date: r.date, total: r.total }))
        : [...rows.reduce((acc, r) => acc.set(r.date.slice(0, 7), round2((acc.get(r.date.slice(0, 7)) ?? 0) + r.total)), new Map<string, number>())].map(
            ([month, total]) => ({ month, total }),
          )
    return {
      days,
      total: summary.total,
      cash: summary.cash,
      qr: summary.qr,
      online: summary.online,
      bestDay: summary.bestDay ? { date: summary.bestDay.date, total: summary.bestDay.total } : null,
      series,
    }
  },
})
