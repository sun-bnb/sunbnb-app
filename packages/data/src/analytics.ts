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
import { deriveState } from './reservation-machine'
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
  /**
   * Seats OUT OF SERVICE that day — machine kind `block` (`blockBed`, which
   * stores a sticky `to` = 2999-12-31 so the block survives day rollover).
   * Excluded from `occupied` *and* from the `occupancyPct` denominator: a bed
   * the venue deliberately took off the floor is neither rented nor sellable.
   */
  blocked: number
  /** `capacity − blocked`, floored at 0 — the floor the venue could actually sell. */
  sellable: number
  /**
   * Distinct seats with a GUEST ON THEM: revenue-bearing kinds (`walkin`, and
   * `online` once `complete`) plus comps. Excludes out-of-service blocks,
   * unpaid holds, and unconfirmed/abandoned online checkouts — none of which
   * are a rented sunbed.
   */
  occupied: number
  /** Of `occupied`, how many were comp (zero-revenue) occupancy. */
  comps: number
  /** Seats reserved but not paid for — machine kind `hold`. Excluded from `occupied`. */
  held: number
  /**
   * Seats on an online checkout that never confirmed (`pending`/`processing`).
   * These block inventory until the cleanup cron sweeps them, but they are not
   * a rental. Excluded from `occupied`.
   */
  unconfirmed: number
  /** `occupied / sellable * 100`, 0 when sellable is 0. */
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
 * Fixed-column figures dump (date, sunbeds, revenue) → CSV string, one row per
 * supplied day. Serializes EXACTLY the rows it's given.
 *
 * Takes `DailyReservationStats` — reservation-driven, bucketed by `createdAt` —
 * deliberately, because that is what the trend screens show. Two earlier
 * mismatches this closes:
 *
 *  - the column was labelled `rentals` but carried `DailyRevenue.count`, the
 *    number of PARTNER INVOICES that day. A 10-seat €80 day exported as `1`
 *    while the screen said "10 sunbeds";
 *  - `DailyRevenue` is bucketed by `invoicedAt`, so a sale could even land on a
 *    different DAY in the file than on the screen.
 *
 * `rentedSeats` and `revenue` come from ONE row here, so the seat count and the
 * money can never describe different reservations. For invoice-driven fiscal
 * truth use the accounting page's separate invoice-register export, not this.
 */
export function toFiguresCsv(rows: DailyReservationStats[]): string {
  const header = 'date,sunbeds,revenue'
  const body = rows.map((r) => `${r.date},${r.rentedSeats},${r.revenue.toFixed(2)}`)
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
 * Seat buckets in CLASSIFICATION PRECEDENCE order — a seat is counted exactly
 * once, in the first bucket that claims it. Precedence only bites when one seat
 * sits on two reservations overlapping the same day (e.g. a sticky block laid
 * over a booking made earlier); the conflict guard prevents it otherwise.
 */
const OCCUPANCY_BUCKETS = ['blocked', 'comps', 'rented', 'held', 'unconfirmed'] as const
type OccupancyBucket = (typeof OCCUPANCY_BUCKETS)[number]

/**
 * Which bucket a reservation's seats fall into, decided by the state machine's
 * own `kind` (`reservation-machine.ts`) rather than a hand-rolled status ladder.
 * `kind` is already the vocabulary that separates revenue-bearing reservations
 * (`walkin`, `online`) from the `pay: 'none'` ones (`hold`, `comp`, `block`), so
 * "is this seat rented?" has exactly one definition repo-wide.
 *
 * `walkin` counts as rented whether or not the cash is settled yet — the bed IS
 * rented; the till just hasn't caught up. `online` only counts once `complete`:
 * `pending`/`processing` is an in-flight or abandoned checkout.
 *
 * Note: derived from the PARENT row's op-status — a range query loads no
 * `ReservationDay` rows, same as `getFloorStateSnapshot`.
 */
function occupancyBucket(res: {
  status: string
  operationalStatus: string
  isComp: boolean
}): OccupancyBucket {
  const { kind } = deriveState(res)
  switch (kind) {
    case 'block':
      return 'blocked'
    case 'comp':
      return 'comps'
    case 'hold':
      return 'held'
    case 'walkin':
      return 'rented'
    case 'online':
      return res.status === RESERVATION_COMPLETE ? 'rented' : 'unconfirmed'
  }
}

/**
 * Per-day occupancy for a site over `[from, to]` (dense). Not invoice-driven:
 * capacity = active inventory; every seat held by a blocking reservation
 * overlapping the day is classified into ONE mutually-exclusive bucket by
 * machine kind (see `occupancyBucket`), and `occupied` counts only the buckets
 * that mean "a guest is on this bed" — rented + comps.
 *
 * The reservation filter still mirrors `availabilityService` /
 * `reserveWithConflictGuard` (`BLOCKING_STATUSES`, op-status ∉ [no-show,
 * departed]) — that is the right set for "what is holding inventory". The
 * partition is what separates *holding inventory* from *rented*: previously
 * everything blocking counted as occupied, so out-of-service beds (kind
 * `block`, sticky `to` = 2999-12-31) inflated the series by a flat baseline on
 * every single day, forever, and dragged `occupancyPct` down with them.
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
        status: true,
        operationalStatus: true,
        isComp: true,
        items: { select: { id: true } },
      },
    }),
  ])

  // Bucket each reservation once up front — `deriveState` is per-row, not per-day.
  const bucketed = reservations.map((res) => ({ res, bucket: occupancyBucket(res) }))

  return eachDay(from, to).map((d) => {
    const dayStart = d
    const dayEnd = addDays(d, 1)
    const overlapping = bucketed.filter(
      ({ res }) => res.from < dayEnd && res.to >= dayStart,
    )

    const seats: Record<OccupancyBucket, Set<string>> = {
      blocked: new Set(),
      comps: new Set(),
      rented: new Set(),
      held: new Set(),
      unconfirmed: new Set(),
    }
    // Global "already classified" set — a seat lands in one bucket only.
    const classified = new Set<string>()
    for (const bucket of OCCUPANCY_BUCKETS) {
      for (const entry of overlapping) {
        if (entry.bucket !== bucket) continue
        for (const it of entry.res.items) {
          if (classified.has(it.id)) continue
          classified.add(it.id)
          seats[bucket].add(it.id)
        }
      }
    }

    const blocked = seats.blocked.size
    const comps = seats.comps.size
    const occupied = seats.rented.size + comps
    const sellable = Math.max(capacity - blocked, 0)
    return {
      date: dayKey(d),
      capacity,
      blocked,
      sellable,
      occupied,
      comps,
      held: seats.held.size,
      unconfirmed: seats.unconfirmed.size,
      occupancyPct: sellable > 0 ? round((occupied / sellable) * 100) : 0,
    }
  })
}

export interface OccupancySnapshot {
  /** Active inventory across the sites. */
  capacity: number
  /** Seats out of service (kind `block`). */
  blocked: number
  /** `capacity − blocked` — the floor that could actually be sold. */
  sellable: number
  /** Seats with a guest on them: rented + comps. */
  occupied: number
  comps: number
  held: number
  unconfirmed: number
  /**
   * Guest PARTIES (reservation rows) holding a seat — out-of-service blocks
   * excluded. Rows, NOT seats: the correct denominator for a party-level ratio
   * such as check-ins, which counts rows on both sides.
   */
  parties: number
  /** `occupied / sellable * 100`, 0 when sellable is 0. */
  occupancyPct: number
}

/**
 * Single-day, MULTI-SITE occupancy snapshot — for the partner dashboard's
 * "today" KPI, which spans every site the operator owns.
 *
 * Shares `occupancyBucket` with `getOccupancyByDay`, so the dashboard and the
 * trend surfaces can never drift apart on what "occupied" means. Critically it
 * counts distinct SEATS (via the item join) against sellable seats — a
 * reservation-row count over an inventory-seat count is a unit mismatch, and a
 * 24-seat out-of-service block spread over 6 rows reads as "6 occupied" one way
 * and "24 unsellable" the other.
 *
 * `dayStart`/`dayEnd` are caller-supplied so this module stays
 * timezone-agnostic (same discipline as `till.ts`) — pass the bounds of the
 * civil day you mean.
 */
export async function getOccupancySnapshotForSites(
  siteIds: string[],
  dayStart: Date,
  dayEnd: Date,
): Promise<OccupancySnapshot> {
  const empty: OccupancySnapshot = {
    capacity: 0, blocked: 0, sellable: 0, occupied: 0,
    comps: 0, held: 0, unconfirmed: 0, parties: 0, occupancyPct: 0,
  }
  if (siteIds.length === 0) return empty

  const [capacity, reservations] = await Promise.all([
    prisma.inventoryItem.count({ where: { siteId: { in: siteIds }, status: 'active' } }),
    prisma.reservation.findMany({
      where: {
        siteId: { in: siteIds },
        status: { in: BLOCKING_STATUSES },
        operationalStatus: { notIn: [OP_NO_SHOW, OP_DEPARTED] },
        from: { lte: dayEnd },
        to: { gte: dayStart },
      },
      select: {
        status: true,
        operationalStatus: true,
        isComp: true,
        items: { select: { id: true } },
      },
    }),
  ])

  const seats: Record<OccupancyBucket, Set<string>> = {
    blocked: new Set(), comps: new Set(), rented: new Set(), held: new Set(), unconfirmed: new Set(),
  }
  const classified = new Set<string>()
  const bucketed = reservations.map((res) => ({ res, bucket: occupancyBucket(res) }))
  for (const bucket of OCCUPANCY_BUCKETS) {
    for (const entry of bucketed) {
      if (entry.bucket !== bucket) continue
      for (const it of entry.res.items) {
        if (classified.has(it.id)) continue
        classified.add(it.id)
        seats[bucket].add(it.id)
      }
    }
  }

  const blocked = seats.blocked.size
  const comps = seats.comps.size
  const occupied = seats.rented.size + comps
  const sellable = Math.max(capacity - blocked, 0)
  return {
    capacity,
    blocked,
    sellable,
    occupied,
    comps,
    held: seats.held.size,
    unconfirmed: seats.unconfirmed.size,
    parties: bucketed.filter((e) => e.bucket !== 'blocked').length,
    occupancyPct: sellable > 0 ? round((occupied / sellable) * 100) : 0,
  }
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
