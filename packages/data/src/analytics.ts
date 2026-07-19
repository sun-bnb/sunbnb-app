/**
 * Operator analytics — site-scoped, read-only aggregation for the partner
 * dashboard + accounting surfaces (track 007). Generalizes the calendar-month,
 * invoice-driven accounting queries into arbitrary date ranges grouped per day,
 * and adds the non-invoice occupancy/comp view the invoice-driven page can't show.
 *
 * Auth/ownership is the CALLER's job (the partner action does `auth()` + site
 * ownership, mirroring accounting/actions.ts); these helpers take a trusted
 * `siteId`. Pure helpers (`summarizeRevenue`, `toFiguresCsv`,
 * `summarizeRevenueByChannel`) are unit-tested; the DB helpers are
 * integration-tested against sunbnb_test.
 *
 * `from`/`to` are inclusive day bounds — any timestamp within the first and last
 * day you want. All day bucketing is UTC (`YYYY-MM-DD`).
 */

import prisma from '../index'
import { round } from './payment'
import {
  BLOCKING_STATUSES,
  OP_NO_SHOW,
  OP_DEPARTED,
  OP_CHECKED_IN,
  OP_WALKED_IN,
  OP_EXPECTED,
  RESERVATION_PAID_IN_CASH,
  RESERVATION_COMPLETE,
  RENTAL_COMPLETE,
  RENTAL_REFUNDED,
  ORDER_COMPLETE,
  ORDER_ACCEPTED,
  ORDER_PREPARING,
  ORDER_READY,
  ORDER_DELIVERED,
  ORDER_COMPLETED,
  ORDER_REFUNDED,
  TAB_PAID,
  TAB_SETTLED_CASH,
} from './reservation-status'

/**
 * Tab-paid-ness filter for Order queries.
 *
 * Tab orders enter kitchen states (complete/accepted/…/delivered) at placement,
 * BEFORE payment. An Order with `tabId != null` is only revenue once its
 * owning tab has reached a terminal paid status (TAB_PAID for online, or
 * TAB_SETTLED_CASH for cash settlement). Non-tab orders (tabId = null) are
 * revenue as soon as their own status reaches a post-payment kitchen state.
 *
 * Usage: spread into a Prisma `where` clause alongside status filters.
 */
const TAB_PAID_FILTER = {
  OR: [
    { tabId: null },
    { tab: { status: { in: [TAB_PAID, TAB_SETTLED_CASH] } } },
  ],
}

// ─── Types ──────────────────────────────────────────────────────────────────

export interface DailyRevenueByChannel {
  /** UTC day, `YYYY-MM-DD`. */
  date: string
  /** Cash walk-in takings (status === RESERVATION_PAID_IN_CASH), rounded. */
  cash: number
  /** QR / counter-collected takings (status === RESERVATION_COMPLETE, employeeId != null), rounded. */
  qr: number
  /** Online self-booked takings (status === RESERVATION_COMPLETE, employeeId == null), rounded. */
  online: number
  /** cash + qr + online, rounded. */
  total: number
}

export interface ChannelRevenueSummary {
  total: number
  cash: number
  qr: number
  online: number
  /** Highest-total day with total > 0; null if nothing earned. */
  bestDay: DailyRevenueByChannel | null
}

export interface DailyReservationStats {
  /** UTC day, `YYYY-MM-DD`. */
  date: string
  /** Sum of seat counts (items.length) across that day's paid reservations. */
  rentedSeats: number
  /** Sum of paymentAmount across that day's paid reservations, rounded. */
  revenue: number
}

export interface ReservationStatsSummary {
  totalRevenue: number
  totalSeats: number
  /** Highest-revenue day with revenue > 0; null if nothing earned. */
  bestDay: DailyReservationStats | null
}

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

/**
 * Totals + the best (highest-revenue) day over a reservation-stats set.
 * `bestDay` is null when no day had revenue > 0 (never "best day: €0").
 */
export function summarizeReservationStats(rows: DailyReservationStats[]): ReservationStatsSummary {
  let totalRevenue = 0
  let totalSeats = 0
  let bestDay: DailyReservationStats | null = null
  for (const r of rows) {
    totalRevenue += r.revenue
    totalSeats += r.rentedSeats
    if (r.revenue > 0 && (!bestDay || r.revenue > bestDay.revenue)) bestDay = r
  }
  return { totalRevenue: round(totalRevenue), totalSeats, bestDay }
}

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
 * Totals per channel + grand total, and the best (highest-total) day over a
 * channel-revenue set. `bestDay` is null when no day had total > 0 (never
 * "best day: €0"), mirroring `summarizeReservationStats`.
 */
export function summarizeRevenueByChannel(rows: DailyRevenueByChannel[]): ChannelRevenueSummary {
  let cash = 0
  let qr = 0
  let online = 0
  let bestDay: DailyRevenueByChannel | null = null
  for (const r of rows) {
    cash += r.cash
    qr += r.qr
    online += r.online
    if (r.total > 0 && (!bestDay || r.total > bestDay.total)) bestDay = r
  }
  const total = round(cash + qr + online)
  return { total, cash: round(cash), qr: round(qr), online: round(online), bestDay }
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
 * Per-day takings + rented-seat count for a site over `[from, to]` (dense — every
 * UTC day in range, zero-filled). This is the **takings lens** (paymentAmount-based,
 * all channels including cash walk-ins and online payments) — deliberately distinct
 * from the invoice-based `getRevenueByDay`.
 *
 * Each reservation is attributed to its `createdAt` UTC day (the business day it was
 * rung up — matches how the operator reads a daily report; multiday bookings are NOT
 * split). Revenue = paymentAmount (null → 0). Seats = items.length.
 *
 * Included: status ∈ [paid-in-cash, complete], refundedAt = null, isComp = false.
 * Auth/ownership is the caller's responsibility.
 */
export async function getReservationDayStats(
  siteId: string,
  from: Date,
  to: Date,
): Promise<DailyReservationStats[]> {
  const rangeStart = utcDayStart(from)
  const rangeEndExcl = addDays(utcDayStart(to), 1)

  const reservations = await prisma.reservation.findMany({
    where: {
      siteId,
      status: { in: [RESERVATION_PAID_IN_CASH, RESERVATION_COMPLETE] },
      refundedAt: null,
      isComp: false,
      createdAt: { gte: rangeStart, lt: rangeEndExcl },
    },
    select: {
      createdAt: true,
      paymentAmount: true,
      items: { select: { id: true } },
    },
  })

  const byDay = new Map<string, { revenue: number; rentedSeats: number }>()
  for (const res of reservations) {
    const key = dayKey(res.createdAt)
    const cur = byDay.get(key) ?? { revenue: 0, rentedSeats: 0 }
    cur.revenue += res.paymentAmount ?? 0
    cur.rentedSeats += res.items.length
    byDay.set(key, cur)
  }

  return eachDay(from, to).map((d) => {
    const e = byDay.get(dayKey(d))
    return {
      date: dayKey(d),
      rentedSeats: e?.rentedSeats ?? 0,
      revenue: round(e?.revenue ?? 0),
    }
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

// ─── Floor State Snapshot ─────────────────────────────────────────────────────

/**
 * 5-way state split of a site's inventory for a single civil day — the
 * *Estado actual de la parcela* (Alonso-parity daily-summary card).
 *
 * Counts are mutually exclusive: each seat is classified into the
 * highest-precedence bucket and counted once.
 *
 * Auth/ownership is the CALLER's responsibility.
 */
export interface FloorStateSnapshot {
  /** Active inventory count for the site. */
  capacity: number
  /** Free: capacity − (alquiladas + reservadas + gratis + desactivada), floored at 0. */
  libres: number
  /** Occupied/rented: distinct seats, op-status checked-in OR walked-in, not comp. */
  alquiladas: number
  /** Reserved/held: distinct seats, op-status expected, not comp. */
  reservadas: number
  /** Comp: distinct seats on isComp reservations. */
  gratis: number
  /** Out-of-service: distinct seats, op-status 'blocked'. */
  desactivada: number
}

/**
 * Returns the 5-way floor-state snapshot for `siteId` on the civil UTC day
 * containing `day`. Uses the same BLOCKING_STATUSES / no-show / departed
 * filter as `getOccupancyByDay` — seats on excluded reservations fall into
 * `libres`.
 *
 * Precedence (first match wins per seat, tracks a global "classified" Set):
 *   1. operationalStatus === 'blocked'  → desactivada
 *   2. isComp === true                  → gratis
 *   3. opStatus ∈ [checked-in, walked-in] → alquiladas
 *   4. opStatus === 'expected'          → reservadas
 */
export async function getFloorStateSnapshot(
  siteId: string,
  day: Date,
): Promise<FloorStateSnapshot> {
  const dayStart = utcDayStart(day)
  const dayEnd = addDays(dayStart, 1)

  const [capacity, reservations] = await Promise.all([
    prisma.inventoryItem.count({ where: { siteId, status: 'active' } }),
    prisma.reservation.findMany({
      where: {
        siteId,
        status: { in: BLOCKING_STATUSES },
        operationalStatus: { notIn: [OP_NO_SHOW, OP_DEPARTED] },
        from: { lt: dayEnd },
        to: { gte: dayStart },
      },
      select: {
        operationalStatus: true,
        isComp: true,
        items: { select: { id: true } },
      },
    }),
  ])

  // Four mutually-exclusive buckets (Sets of seat ids).
  const desactivadaSet = new Set<string>()
  const gratisSet = new Set<string>()
  const alquiladasSet = new Set<string>()
  const reservadasSet = new Set<string>()
  // Global "already classified" set — a seat counts once (highest-precedence bucket).
  const classified = new Set<string>()

  for (const res of reservations) {
    for (const it of res.items) {
      if (classified.has(it.id)) continue

      if (res.operationalStatus === 'blocked') {
        desactivadaSet.add(it.id)
        classified.add(it.id)
      } else if (res.isComp) {
        gratisSet.add(it.id)
        classified.add(it.id)
      } else if (res.operationalStatus === OP_CHECKED_IN || res.operationalStatus === OP_WALKED_IN) {
        alquiladasSet.add(it.id)
        classified.add(it.id)
      } else if (res.operationalStatus === OP_EXPECTED) {
        reservadasSet.add(it.id)
        classified.add(it.id)
      }
    }
  }

  const alquiladas = alquiladasSet.size
  const reservadas = reservadasSet.size
  const gratis = gratisSet.size
  const desactivada = desactivadaSet.size
  const libres = Math.max(0, capacity - alquiladas - reservadas - gratis - desactivada)

  return { capacity, libres, alquiladas, reservadas, gratis, desactivada }
}

/**
 * Per-day revenue broken down by payment channel for a site over `[from, to]`
 * (dense — every UTC day in range, zero-filled). This is a takings-lens view
 * (paymentAmount-based, same population as `getReservationDayStats`) with the
 * addition of a channel split:
 *
 *   cash   — status === RESERVATION_PAID_IN_CASH (cash walk-in at the desk)
 *   qr     — status === RESERVATION_COMPLETE AND employeeId != null
 *              (QR / counter-collected by a floor employee)
 *   online — status === RESERVATION_COMPLETE AND employeeId == null
 *              (guest self-booked and paid online)
 *
 * Included: status ∈ [paid-in-cash, complete], refundedAt = null, isComp = false.
 * Each reservation is attributed to its `createdAt` UTC day. Auth/ownership is
 * the caller's responsibility.
 */
export async function getRevenueByChannelByDay(
  siteId: string,
  from: Date,
  to: Date,
): Promise<DailyRevenueByChannel[]> {
  const rangeStart = utcDayStart(from)
  const rangeEndExcl = addDays(utcDayStart(to), 1)

  const reservations = await prisma.reservation.findMany({
    where: {
      siteId,
      status: { in: [RESERVATION_PAID_IN_CASH, RESERVATION_COMPLETE] },
      refundedAt: null,
      isComp: false,
      createdAt: { gte: rangeStart, lt: rangeEndExcl },
    },
    select: {
      createdAt: true,
      status: true,
      employeeId: true,
      paymentAmount: true,
    },
  })

  const byDay = new Map<string, { cash: number; qr: number; online: number }>()
  for (const res of reservations) {
    const key = dayKey(res.createdAt)
    const cur = byDay.get(key) ?? { cash: 0, qr: 0, online: 0 }
    const amount = res.paymentAmount ?? 0
    if (res.status === RESERVATION_PAID_IN_CASH) {
      cur.cash += amount
    } else if (res.employeeId != null) {
      cur.qr += amount
    } else {
      cur.online += amount
    }
    byDay.set(key, cur)
  }

  return eachDay(from, to).map((d) => {
    const e = byDay.get(dayKey(d))
    const cash = round(e?.cash ?? 0)
    const qr = round(e?.qr ?? 0)
    const online = round(e?.online ?? 0)
    return { date: dayKey(d), cash, qr, online, total: round(cash + qr + online) }
  })
}

// ─── Monthly Source Summary ───────────────────────────────────────────────────

interface SourceStat {
  revenue: number
  count: number
}

export interface MonthlySourceSummary {
  /** Paid sunbed reservations (Reservation), comp and refunded excluded. */
  sunbeds: { revenue: number; count: number; seats: number }
  /** Paid rental bookings (RentalBooking). */
  rentals: SourceStat
  /**
   * Paid F&B orders (Order), all post-payment fulfillment statuses included.
   * `bedLinkedRevenue` is the subset attributable to a bed (seatId or reservationId
   * set) — the F&B guests ordered from a sunbed — for the turnover-per-bed yield.
   */
  orders: SourceStat & { bedLinkedRevenue: number }
  /** Refunded rows across all three sources (createdAt-attributed). */
  refunds: SourceStat
  /** sunbeds.revenue + rentals.revenue + orders.revenue (excludes refunds), rounded. */
  total: number
  /** sunbeds.count + rentals.count + orders.count. */
  totalCount: number
  /** Active inventory count (physical beds) — the denominator for turnover-per-bed. */
  capacity: number
}

/**
 * Monthly takings broken down by revenue source (sunbeds / rentals / orders)
 * plus a combined refunds bucket.
 *
 * All buckets are **takings** (`paymentAmount`-based) and **createdAt-attributed**
 * to the `[utcDayStart(from), addDays(utcDayStart(to), 1))` window — the same
 * convention as `getReservationDayStats`. Auth/ownership is the caller's responsibility.
 *
 * Included:
 *   sunbeds  — Reservation: status ∈ [paid-in-cash, complete], isComp=false, refundedAt=null
 *   rentals  — RentalBooking: status ∈ ['paid-in-cash', RENTAL_COMPLETE]
 *   orders   — Order: status ∈ [complete, accepted, preparing, ready, delivered, completed]
 *   refunds  — Reservation with refundedAt != null  +  RentalBooking with status=RENTAL_REFUNDED
 *              + Order with status=ORDER_REFUNDED; all createdAt in range
 */
export async function getMonthlySourceSummary(
  siteId: string,
  from: Date,
  to: Date,
): Promise<MonthlySourceSummary> {
  const rangeStart = utcDayStart(from)
  const rangeEndExcl = addDays(utcDayStart(to), 1)

  const [rawReservations, rawRentals, rawOrders, refundedReservations, refundedRentals, refundedOrders, capacity] =
    await Promise.all([
      // Sunbed reservations — paid, not comp, not refunded
      prisma.reservation.findMany({
        where: {
          siteId,
          status: { in: [RESERVATION_PAID_IN_CASH, RESERVATION_COMPLETE] },
          isComp: false,
          refundedAt: null,
          createdAt: { gte: rangeStart, lt: rangeEndExcl },
        },
        select: {
          paymentAmount: true,
          items: { select: { id: true } },
        },
      }),

      // Rental bookings — cash walk-in or online complete
      // NOTE: cash walk-in rentals use literal 'paid-in-cash' (same value as
      // RESERVATION_PAID_IN_CASH); online rentals use RENTAL_COMPLETE ('complete').
      prisma.rentalBooking.findMany({
        where: {
          siteId,
          status: { in: [RESERVATION_PAID_IN_CASH, RENTAL_COMPLETE] },
          createdAt: { gte: rangeStart, lt: rangeEndExcl },
        },
        select: { paymentAmount: true },
      }),

      // F&B orders — all post-payment fulfillment states.
      // Tab orders (tabId != null) enter kitchen states at PLACEMENT before any
      // payment — apply TAB_PAID_FILTER so only orders whose tab has been paid
      // (online or cash) count as revenue. Non-tab orders are unaffected.
      prisma.order.findMany({
        where: {
          siteId,
          status: {
            in: [ORDER_COMPLETE, ORDER_ACCEPTED, ORDER_PREPARING, ORDER_READY, ORDER_DELIVERED, ORDER_COMPLETED],
          },
          createdAt: { gte: rangeStart, lt: rangeEndExcl },
          ...TAB_PAID_FILTER,
        },
        select: { paymentAmount: true, seatId: true, reservationId: true },
      }),

      // Refunded reservations (any that have refundedAt set, in the createdAt window)
      prisma.reservation.findMany({
        where: {
          siteId,
          refundedAt: { not: null },
          createdAt: { gte: rangeStart, lt: rangeEndExcl },
        },
        select: { paymentAmount: true },
      }),

      // Refunded rental bookings
      prisma.rentalBooking.findMany({
        where: {
          siteId,
          status: RENTAL_REFUNDED,
          createdAt: { gte: rangeStart, lt: rangeEndExcl },
        },
        select: { paymentAmount: true },
      }),

      // Refunded orders. Same tab-paid-ness rule as the revenue query: a
      // refunded round on a never-paid tab was never revenue, so it must not
      // count as a refund either — only refunds of paid/settled tabs (or
      // non-tab orders) belong in the refunds bucket.
      prisma.order.findMany({
        where: {
          siteId,
          status: ORDER_REFUNDED,
          createdAt: { gte: rangeStart, lt: rangeEndExcl },
          ...TAB_PAID_FILTER,
        },
        select: { paymentAmount: true },
      }),

      // Physical bed capacity — active inventory (current), the turnover-per-bed denominator
      prisma.inventoryItem.count({ where: { siteId, status: 'active' } }),
    ])

  // Sunbeds bucket
  let sunbedsRevenue = 0
  let sunbedsSeats = 0
  for (const res of rawReservations) {
    sunbedsRevenue += res.paymentAmount ?? 0
    sunbedsSeats += res.items.length
  }
  const sunbeds = {
    revenue: round(sunbedsRevenue),
    count: rawReservations.length,
    seats: sunbedsSeats,
  }

  // Rentals bucket
  let rentalsRevenue = 0
  for (const rb of rawRentals) {
    rentalsRevenue += rb.paymentAmount ?? 0
  }
  const rentals: SourceStat = {
    revenue: round(rentalsRevenue),
    count: rawRentals.length,
  }

  // Orders bucket — total + the bed-linked subset (F&B ordered from a bed)
  let ordersRevenue = 0
  let bedLinkedRevenue = 0
  for (const ord of rawOrders) {
    const amt = ord.paymentAmount ?? 0
    ordersRevenue += amt
    if (ord.seatId !== null || ord.reservationId !== null) bedLinkedRevenue += amt
  }
  const orders = {
    revenue: round(ordersRevenue),
    count: rawOrders.length,
    bedLinkedRevenue: round(bedLinkedRevenue),
  }

  // Refunds bucket (combined across all three sources)
  let refundsRevenue = 0
  for (const res of refundedReservations) refundsRevenue += res.paymentAmount ?? 0
  for (const rb of refundedRentals) refundsRevenue += rb.paymentAmount ?? 0
  for (const ord of refundedOrders) refundsRevenue += ord.paymentAmount ?? 0
  const refunds: SourceStat = {
    revenue: round(refundsRevenue),
    count: refundedReservations.length + refundedRentals.length + refundedOrders.length,
  }

  const total = round(sunbeds.revenue + rentals.revenue + orders.revenue)
  const totalCount = sunbeds.count + rentals.count + orders.count

  return { sunbeds, rentals, orders, refunds, total, totalCount, capacity }
}
