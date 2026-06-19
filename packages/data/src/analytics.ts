/**
 * Operator analytics — site-scoped, read-only aggregation for the partner
 * dashboard + accounting surfaces (track 007). Generalizes the calendar-month,
 * invoice-driven accounting queries into arbitrary date ranges grouped per day,
 * and adds the non-invoice occupancy/comp view the invoice-driven page can't show.
 *
 * Auth/ownership is the CALLER's job (the partner action does `auth()` + site
 * ownership, mirroring accounting/actions.ts); these helpers take a trusted
 * `siteId`. Pure helpers (`summarizeRevenue`, `toFiguresCsv`) are unit-tested;
 * the two DB helpers are integration-tested against sunbnb_test.
 *
 * `from`/`to` are inclusive day bounds — any timestamp within the first and last
 * day you want. All day bucketing is UTC (`YYYY-MM-DD`).
 */

import prisma from '../index'
import { round } from './payment'
import { BLOCKING_STATUSES, OP_NO_SHOW, OP_DEPARTED } from './reservation-status'

// ─── Types ──────────────────────────────────────────────────────────────────

export interface DailyRevenue {
  /** UTC day, `YYYY-MM-DD`. */
  date: string
  /** Sum of PARTNER-invoice gross totals that day. */
  revenue: number
  /** Number of PARTNER invoices that day (sales/rentals). */
  count: number
}

export interface RevenueSummary {
  totalRevenue: number
  totalCount: number
  /** Highest-revenue day in the set, or null if no day had revenue. */
  bestDay: DailyRevenue | null
}

export interface DailyOccupancy {
  date: string
  /** Active inventory count for the site (current). */
  capacity: number
  /** Distinct beds occupied by a blocking reservation overlapping the day. */
  occupied: number
  /** Of those, how many were comp (zero-revenue) occupancy. */
  comps: number
  /** `occupied / capacity * 100`, 0 when capacity is 0. */
  occupancyPct: number
}

export interface OccupancySummary {
  /** Mean daily occupancy % across the window. */
  avgOccupancyPct: number
  /** Highest single-day occupancy %. */
  peakOccupancyPct: number
  /** Comp bed-days over the window (sum of daily comp counts). */
  totalComps: number
}

// ─── Date helpers (UTC) ───────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000

function utcDayStart(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}
function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * DAY_MS)
}
function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10)
}
/** Every UTC day from `from`'s day through `to`'s day, inclusive. */
function eachDay(from: Date, to: Date): Date[] {
  const end = utcDayStart(to).getTime()
  const days: Date[] = []
  for (let d = utcDayStart(from); d.getTime() <= end; d = addDays(d, 1)) days.push(d)
  return days
}

// ─── Pure helpers (no DB) ─────────────────────────────────────────────────────

/** Totals + the best (highest-revenue) day over a windowed set. */
export function summarizeRevenue(rows: DailyRevenue[]): RevenueSummary {
  let totalRevenue = 0
  let totalCount = 0
  let bestDay: DailyRevenue | null = null
  for (const r of rows) {
    totalRevenue += r.revenue
    totalCount += r.count
    // Best day only among days that actually earned — never "best day: €0".
    if (r.revenue > 0 && (!bestDay || r.revenue > bestDay.revenue)) bestDay = r
  }
  return { totalRevenue: round(totalRevenue), totalCount, bestDay }
}

/** Window aggregates over a per-day occupancy set (avg/peak %, comp bed-days). */
export function summarizeOccupancy(rows: DailyOccupancy[]): OccupancySummary {
  if (rows.length === 0) return { avgOccupancyPct: 0, peakOccupancyPct: 0, totalComps: 0 }
  let sumPct = 0
  let peak = 0
  let comps = 0
  for (const r of rows) {
    sumPct += r.occupancyPct
    if (r.occupancyPct > peak) peak = r.occupancyPct
    comps += r.comps
  }
  return { avgOccupancyPct: round(sumPct / rows.length), peakOccupancyPct: peak, totalComps: comps }
}

/**
 * Fixed-column figures dump (date, rentals, revenue) → CSV string (one row per
 * supplied day). Serializes EXACTLY the rows it's given — the caller passes the
 * same windowed rows shown on screen, so there's no screen-vs-file mismatch.
 */
export function toFiguresCsv(rows: DailyRevenue[]): string {
  const header = 'date,rentals,revenue'
  const body = rows.map((r) => `${r.date},${r.count},${r.revenue.toFixed(2)}`)
  return [header, ...body].join('\n') + '\n'
}

// ─── DB helpers ───────────────────────────────────────────────────────────────

/**
 * Per-day revenue + sale count for a site over `[from, to]` (dense — every day in
 * range, zero-filled). Revenue = PARTNER invoices on the site's reservations OR
 * orders, summed by `invoicedAt` day. (`Invoice` is account-scoped, so the site
 * filter rides the reservation/order relation — same join as `getPaidItemsByMonth`.)
 */
export async function getRevenueByDay(
  siteId: string,
  from: Date,
  to: Date,
): Promise<DailyRevenue[]> {
  const rangeStart = utcDayStart(from)
  const rangeEndExcl = addDays(utcDayStart(to), 1)

  const invoices = await prisma.invoice.findMany({
    where: {
      issuerType: 'PARTNER',
      invoicedAt: { gte: rangeStart, lt: rangeEndExcl },
      OR: [{ reservation: { siteId } }, { order: { siteId } }],
    },
    select: { invoicedAt: true, totalAmount: true },
  })

  const byDay = new Map<string, { revenue: number; count: number }>()
  for (const inv of invoices) {
    const key = dayKey(inv.invoicedAt)
    const cur = byDay.get(key) ?? { revenue: 0, count: 0 }
    cur.revenue += inv.totalAmount
    cur.count += 1
    byDay.set(key, cur)
  }

  return eachDay(from, to).map((d) => {
    const e = byDay.get(dayKey(d))
    return { date: dayKey(d), revenue: round(e?.revenue ?? 0), count: e?.count ?? 0 }
  })
}

/**
 * Per-day occupancy for a site over `[from, to]` (dense). Not invoice-driven:
 * capacity = active inventory; occupied = distinct beds with a blocking
 * reservation overlapping the day (mirrors `availabilityService` /
 * `reserveWithConflictGuard`: `BLOCKING_STATUSES`, op-status ∉ [no-show,
 * departed]); comps = those whose reservation `isComp`.
 */
export async function getOccupancyByDay(
  siteId: string,
  from: Date,
  to: Date,
): Promise<DailyOccupancy[]> {
  const rangeStart = utcDayStart(from)
  const rangeEndExcl = addDays(utcDayStart(to), 1)

  const [capacity, reservations] = await Promise.all([
    prisma.inventoryItem.count({ where: { siteId, status: 'active' } }),
    prisma.reservation.findMany({
      where: {
        siteId,
        status: { in: BLOCKING_STATUSES },
        operationalStatus: { notIn: [OP_NO_SHOW, OP_DEPARTED] },
        from: { lt: rangeEndExcl },
        to: { gte: rangeStart },
      },
      select: {
        from: true,
        to: true,
        isComp: true,
        items: { select: { id: true } },
      },
    }),
  ])

  return eachDay(from, to).map((d) => {
    const dayStart = d
    const dayEnd = addDays(d, 1)
    const occupiedItems = new Set<string>()
    const compItems = new Set<string>()
    for (const res of reservations) {
      if (res.from < dayEnd && res.to >= dayStart) {
        for (const it of res.items) {
          occupiedItems.add(it.id)
          if (res.isComp) compItems.add(it.id)
        }
      }
    }
    const occupied = occupiedItems.size
    return {
      date: dayKey(d),
      capacity,
      occupied,
      comps: compItems.size,
      occupancyPct: capacity > 0 ? round((occupied / capacity) * 100) : 0,
    }
  })
}
