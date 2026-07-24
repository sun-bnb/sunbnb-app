/**
 * Per-worker cash till — the operational cash-reconciliation layer (track 008,
 * Alonso "Group A"; day-anchored rework track 016). A worker's till balance is
 * fully ledger-sourced (track 013 P3): reservation settlements and rental
 * settlements are both TillEntry rows. Closing snapshots the total into a
 * TillClose row; the open till then reads zero.
 *
 * Day-anchored, two-bucket model (track 016): every employee's open till is
 * split into a **today** bucket and a **carryOver** bucket, anchored to the
 * venue-local day. The caller computes `dayStart` (venue-local start of today,
 * e.g. via `siteDayBounds(buildSiteTimezone(site), now)`) and passes it in —
 * this module stays timezone-agnostic and does no site lookups for tz purposes.
 *
 *   lastClose = the employee's latest TillClose.closedAt at this site (or none)
 *   floor     = max(lastClose, dayStart)
 *   today     = non-voided TillEntry rows with settledAt > floor
 *   carryOver = non-voided TillEntry rows with settledAt in (lastClose, dayStart]
 *               — empty when the worker already closed today (lastClose >= dayStart);
 *               everything at-or-before dayStart when never closed.
 *   total/count (the sweepable balance a close snapshots) = today + carryOver,
 *   which is identical to the old "since last close" total — close semantics
 *   (and idempotency) are unchanged, only the balance is now surfaced split.
 *
 * Ledger helpers exported here:
 *   recordSettlement              — write a TillEntry for cash taken (reservation
 *                                   OR rental booking; pass whichever id applies)
 *   voidSettlementsForReservation — mark cash returned for a reservation
 *   voidSettlementsForRentalBooking — mark cash returned for a rental booking
 *
 * Read-only aggregation; the caller (partner action) owns auth/ownership. Mirrors
 * the `@repo/data/analytics` pattern. Integration-tested against sunbnb_test.
 */

import prisma from '../index'
import { round } from './payment'
import { RESERVATION_PAID_IN_CASH, RESERVATION_COMPLETE } from './reservation-status'

// ─── Shift-items types (per-employee itemized audit) ────────────────────────

/**
 * A single reservation attributed to an employee during a shift window.
 * `seats` uses `seatLabel` when set, otherwise falls back to `String(number)`.
 * `channel` distinguishes cash walk-ins from card/online-collected reservations.
 * `amount` = reservation.paymentAmount ?? 0, rounded.
 */
export interface EmployeeShiftItem {
  reservationId: string
  seats: string[]
  amount: number
  at: Date
  channel: 'cash' | 'card'
}

/**
 * One employee's full itemized shift for the window, including a total and count.
 *
 * Note: `total` spans BOTH cash and card (any employee-initiated payment — walk-in
 * cash AND QR-collected card). It intentionally differs from `getTillByEmployee`,
 * which is cash-only (ledger-sourced via TillEntry rows that only exist for cash
 * payments). Use this helper for the "who rented which bed" audit across all channels;
 * use `getTillByEmployee` for the cash-drawer reconciliation.
 */
export interface EmployeeShift {
  employeeId: string
  name: string
  active: boolean
  total: number
  count: number
  items: EmployeeShiftItem[]
}

/** A same-shape money+count bucket used for both `today` and `carryOver`. */
export interface TillBucket {
  total: number
  count: number
}

/** The carry-over bucket additionally surfaces the oldest unclosed entry's date. */
export interface CarryOverBucket extends TillBucket {
  oldestAt: Date | null
}

export interface OpenTill {
  /** Sweepable balance — what a close snapshots. Always today.total + carryOver.total. */
  total: number
  count: number
  today: TillBucket
  carryOver: CarryOverBucket
}

export interface EmployeeTill {
  employeeId: string
  name: string
  active: boolean
  total: number
  count: number
  today: TillBucket
  carryOver: CarryOverBucket
}

/**
 * Plain (non-bucketed) per-employee cash total — the civil-day-window report
 * shape returned by `getTillByEmployee`, unchanged by the track 016 rework
 * (arbitrary `[from, to]` ranges don't have a "today vs carry-over" notion).
 */
export interface EmployeeCashTotal {
  employeeId: string
  name: string
  active: boolean
  total: number
  count: number
}

export interface TillEntryRow {
  id: string
  siteId: string
  reservationId: string | null
  rentalBookingId: string | null
  employeeId: string | null
  amount: number
  settledAt: Date
  voidedAt: Date | null
  createdAt: Date
}

// ─── Ledger Helpers ──────────────────────────────────────────────────────────

/**
 * Record a cash settlement for a reservation OR a rental booking.
 * Exactly one of reservationId / rentalBookingId should be set (both are
 * optional so existing callers passing only reservationId keep working).
 * Creates a TillEntry that immediately contributes to the open till.
 * settledAt defaults to now() — pass a specific date only for historical backfills.
 */
export async function recordSettlement(opts: {
  siteId: string
  reservationId?: string | null
  rentalBookingId?: string | null
  employeeId?: string | null
  amount: number
  settledAt?: Date
}): Promise<TillEntryRow> {
  const {
    siteId,
    reservationId = null,
    rentalBookingId = null,
    employeeId = null,
    amount,
    settledAt = new Date(),
  } = opts
  return prisma.tillEntry.create({
    data: { siteId, reservationId, rentalBookingId, employeeId, amount, settledAt },
  })
}

/**
 * Void all non-voided TillEntry rows for a reservation, recording that cash
 * left the drawer (refund / money returned on unreserve). Returns the number
 * of rows voided (0 if none existed or all already voided).
 */
export async function voidSettlementsForReservation(reservationId: string): Promise<number> {
  const result = await prisma.tillEntry.updateMany({
    where: { reservationId, voidedAt: null },
    data: { voidedAt: new Date() },
  })
  return result.count
}

/**
 * Void all non-voided TillEntry rows for a rental booking, recording that cash
 * left the drawer (future rental-refund flow). Returns the number of rows voided
 * (0 if none existed or all already voided).
 */
export async function voidSettlementsForRentalBooking(rentalBookingId: string): Promise<number> {
  const result = await prisma.tillEntry.updateMany({
    where: { rentalBookingId, voidedAt: null },
    data: { voidedAt: new Date() },
  })
  return result.count
}

// ─── Till Read Queries ───────────────────────────────────────────────────────

/**
 * Shared two-bucket window computation. `lastClose` is the employee's own
 * latest TillClose.closedAt at the site (or null if they've never closed).
 * See the module doc comment for the window math.
 */
async function computeOpenTill(
  siteId: string,
  employeeId: string,
  dayStart: Date,
  lastClose: Date | null,
): Promise<OpenTill> {
  const floor = lastClose && lastClose > dayStart ? lastClose : dayStart

  const [todayAgg, carryAgg] = await Promise.all([
    prisma.tillEntry.aggregate({
      where: { siteId, employeeId, voidedAt: null, settledAt: { gt: floor } },
      _sum: { amount: true },
      _count: true,
    }),
    prisma.tillEntry.aggregate({
      where: {
        siteId,
        employeeId,
        voidedAt: null,
        settledAt: { lte: dayStart, ...(lastClose ? { gt: lastClose } : {}) },
      },
      _sum: { amount: true },
      _count: true,
      _min: { settledAt: true },
    }),
  ])

  const today: TillBucket = { total: round(todayAgg._sum.amount ?? 0), count: todayAgg._count }
  const carryOver: CarryOverBucket = {
    total: round(carryAgg._sum.amount ?? 0),
    count: carryAgg._count,
    oldestAt: carryAgg._min.settledAt,
  }

  return {
    total: round(today.total + carryOver.total),
    count: today.count + carryOver.count,
    today,
    carryOver,
  }
}

/**
 * The worker's open till at a site, split into `today` (venue-local, since
 * `dayStart` or since their last close today, whichever is later) and
 * `carryOver` (unclosed cash from before `dayStart`). `total`/`count` are the
 * sweepable balance (today + carryOver) — unchanged from the pre-track-016
 * since-last-close total, so close semantics are unchanged.
 *
 * `dayStart` is REQUIRED and must be computed by the caller (venue-local start
 * of today) — this module does not look up site timezone.
 *
 * Fully ledger-sourced (track 013 P3): sums all non-voided TillEntry rows
 * attributed to this employee since the last TillClose. Rental settlements are
 * TillEntry rows (backfilled by migration 20260621162554_add_till_entry_rental_booking),
 * so no separate rentalBooking aggregate is needed.
 */
export async function getOpenTill(siteId: string, employeeId: string, dayStart: Date): Promise<OpenTill> {
  const lastClose = await prisma.tillClose.findFirst({
    where: { siteId, employeeId },
    orderBy: { closedAt: 'desc' },
    select: { closedAt: true },
  })

  return computeOpenTill(siteId, employeeId, dayStart, lastClose?.closedAt ?? null)
}

/**
 * Every roster employee's **open** (unclosed) till at a site — the manager /
 * admin overview behind the on-site "till summary". Each employee's balance
 * uses their OWN last close as the window floor (all-time carryOver if never
 * closed), so a worker who forgot to close on a prior day still surfaces
 * their full uncounted balance here, now explicitly split into `today` and
 * `carryOver`. Mirrors getTillByEmployee's roster zero-fill; sorted by name.
 *
 * `dayStart` is REQUIRED (venue-local start of today, caller-computed).
 * Read-only; the caller owns auth/ownership.
 */
export async function getOpenTillsByEmployee(siteId: string, dayStart: Date): Promise<EmployeeTill[]> {
  const site = await prisma.site.findUnique({ where: { id: siteId }, select: { userId: true } })
  if (!site) return []

  const employees = await prisma.employee.findMany({
    where: { accountId: site.userId },
    select: { id: true, name: true, active: true },
    orderBy: { name: 'asc' },
  })

  // Latest close per employee at this site → each employee's window floor.
  const closes = await prisma.tillClose.groupBy({
    by: ['employeeId'],
    where: { siteId },
    _max: { closedAt: true },
  })
  const lastCloseByEmp = new Map(closes.map((c) => [c.employeeId, c._max.closedAt]))

  return Promise.all(
    employees.map(async (e) => {
      const lastClose = lastCloseByEmp.get(e.id) ?? null
      const till = await computeOpenTill(siteId, e.id, dayStart, lastClose)
      return { employeeId: e.id, name: e.name, active: e.active, ...till }
    }),
  )
}

export interface OpenTillItem {
  id: string
  kind: 'sunbed' | 'rental'
  label: string
  /** Number of sunbeds on the settled reservation (0 for rental entries). */
  seats: number
  amount: number
  at: Date
  /** True when this entry settled at-or-before dayStart (carried over from a prior day). */
  carryOver: boolean
}

export interface EmployeeOpenTill {
  employeeId: string
  name: string
  active: boolean
  total: number
  count: number
  today: TillBucket
  carryOver: CarryOverBucket
  items: OpenTillItem[]
}

/**
 * Every roster employee's open till at a site, ITEMIZED — the Alonso "cierre de
 * caja empleado" per-worker view: each employee's unclosed cash broken down into
 * the individual sunbeds (and cash rentals) that make it up, since their own last
 * close, with each item tagged `carryOver` (settled at-or-before `dayStart`) vs
 * today. The `items` sum to `total` (cash-only, because TillEntry rows only exist
 * for cash), so this is the drawer contents, not a broader earnings view. Mirrors
 * getOpenTillsByEmployee's roster zero-fill + since-last-close window, and adds
 * the line items plus the same `today`/`carryOver` bucket totals per employee.
 * Sorted by name; items oldest-first.
 *
 * `dayStart` is REQUIRED (venue-local start of today, caller-computed).
 *
 * A sunbed line's `label` is the reserved seats joined (seatLabel, else number);
 * a rental line's `label` is the rental item name. Read-only; caller owns auth.
 */
export async function getOpenTillItemsByEmployee(siteId: string, dayStart: Date): Promise<EmployeeOpenTill[]> {
  const site = await prisma.site.findUnique({ where: { id: siteId }, select: { userId: true } })
  if (!site) return []

  const employees = await prisma.employee.findMany({
    where: { accountId: site.userId },
    select: { id: true, name: true, active: true },
    orderBy: { name: 'asc' },
  })

  const closes = await prisma.tillClose.groupBy({
    by: ['employeeId'],
    where: { siteId },
    _max: { closedAt: true },
  })
  const lastCloseByEmp = new Map(closes.map((c) => [c.employeeId, c._max.closedAt]))

  return Promise.all(
    employees.map(async (e) => {
      const lastClose = lastCloseByEmp.get(e.id) ?? null
      const entries = await prisma.tillEntry.findMany({
        where: {
          siteId,
          employeeId: e.id,
          voidedAt: null,
          ...(lastClose ? { settledAt: { gt: lastClose } } : {}),
        },
        select: {
          id: true,
          amount: true,
          settledAt: true,
          reservation: { select: { items: { select: { number: true, seatLabel: true } } } },
          rentalBooking: { select: { rentalItem: { select: { name: true } } } },
        },
        orderBy: { settledAt: 'asc' },
      })

      const items: OpenTillItem[] = entries.map((en) => {
        const carryOver = en.settledAt <= dayStart
        if (en.reservation) {
          const seats = en.reservation.items.map((it) => it.seatLabel ?? String(it.number))
          return {
            id: en.id,
            kind: 'sunbed',
            label: seats.join(', '),
            seats: seats.length,
            amount: round(en.amount),
            at: en.settledAt,
            carryOver,
          }
        }
        return {
          id: en.id,
          kind: 'rental',
          label: en.rentalBooking?.rentalItem?.name ?? '',
          seats: 0,
          amount: round(en.amount),
          at: en.settledAt,
          carryOver,
        }
      })

      // items are settledAt-ascending, so filtering preserves order — the
      // first carry-over item is the oldest.
      const carryItems = items.filter((i) => i.carryOver)
      const todayItems = items.filter((i) => !i.carryOver)

      return {
        employeeId: e.id,
        name: e.name,
        active: e.active,
        total: round(entries.reduce((sum, en) => sum + en.amount, 0)),
        count: items.length,
        today: {
          total: round(todayItems.reduce((sum, i) => sum + i.amount, 0)),
          count: todayItems.length,
        },
        carryOver: {
          total: round(carryItems.reduce((sum, i) => sum + i.amount, 0)),
          count: carryItems.length,
          oldestAt: carryItems[0]?.at ?? null,
        },
        items,
      }
    }),
  )
}

export interface TillCloseBreakdown {
  /** False when the sweepable balance was zero — no TillClose row was written. */
  closed: boolean
  totalAmount: number
  txnCount: number
  carryOverAmount: number
  carryOverCount: number
  /** The open till this breakdown was computed from (zeroed out once closed). */
  till: OpenTill
}

/**
 * Close ONE employee's till at a site — the single TillClose snapshot writer
 * both the per-worker close (`manage/actions.ts` closeTill, P3) and the
 * manager end-of-day sweep (closeAllOpenTills, below) route through.
 *
 * Reads the open till (today + carryOver); no-ops when the sweepable total
 * count is 0 (returns `{ closed: false, ... }` with the — zeroed — till so the
 * caller can still render a breakdown). Otherwise creates a TillClose row with
 * totalAmount/txnCount = the sweepable total/count and carryOverAmount/
 * carryOverCount = the carry-over bucket, so the snapshot records how much of
 * what was just swept came from before today.
 *
 * `dayStart` is REQUIRED (venue-local start of today, caller-computed).
 */
export async function closeEmployeeTill(
  siteId: string,
  employeeId: string,
  dayStart: Date,
): Promise<TillCloseBreakdown> {
  const till = await getOpenTill(siteId, employeeId, dayStart)

  if (till.count === 0) {
    return {
      closed: false,
      totalAmount: 0,
      txnCount: 0,
      carryOverAmount: 0,
      carryOverCount: 0,
      till,
    }
  }

  await prisma.tillClose.create({
    data: {
      siteId,
      employeeId,
      totalAmount: till.total,
      txnCount: till.count,
      carryOverAmount: till.carryOver.total,
      carryOverCount: till.carryOver.count,
    },
  })

  return {
    closed: true,
    totalAmount: till.total,
    txnCount: till.count,
    carryOverAmount: till.carryOver.total,
    carryOverCount: till.carryOver.count,
    till,
  }
}

/**
 * Close EVERY employee's open till at a site in one shot — the manager
 * end-of-day "cierre de caja" cash-up. For each roster employee with a non-zero
 * unclosed balance (from getOpenTillsByEmployee), snapshots a TillClose row via
 * `closeEmployeeTill` (today + carryOver both swept together — no partial
 * close). Employees with a zero open balance are skipped (no empty snapshot),
 * exactly like the per-worker close.
 *
 * Idempotent: re-running immediately after a close finds every open till at
 * zero and is a no-op. Returns how many tills were closed, their combined
 * sweepable total, and the combined carry-over portion of that total (for the
 * "€Y from previous days" summary line). Read/aggregation is caller-auth'd;
 * this only writes TillClose rows — it does NOT touch reservations or floor
 * state (that cleanup is the caller's).
 *
 * `dayStart` is REQUIRED (venue-local start of today, caller-computed).
 */
export async function closeAllOpenTills(
  siteId: string,
  dayStart: Date,
): Promise<{ closedCount: number; totalClosed: number; carryOverClosed: number }> {
  const opens = await getOpenTillsByEmployee(siteId, dayStart)
  const toClose = opens.filter((o) => o.count > 0)
  if (toClose.length === 0) return { closedCount: 0, totalClosed: 0, carryOverClosed: 0 }

  const results = await Promise.all(toClose.map((o) => closeEmployeeTill(siteId, o.employeeId, dayStart)))
  const closed = results.filter((r) => r.closed)

  return {
    closedCount: closed.length,
    totalClosed: round(closed.reduce((sum, r) => sum + r.totalAmount, 0)),
    carryOverClosed: round(closed.reduce((sum, r) => sum + r.carryOverAmount, 0)),
  }
}

/**
 * Per-employee cash for a site over `[from, to]` — the manager day-breakdown.
 * Returns every roster employee of the site's account (zero rows included), plus
 * any departed/removed employee who still has attributed cash in-window.
 *
 * Fully ledger-sourced (track 013 P3): sums non-voided TillEntry rows with
 * settledAt in [from, to]. Both reservation and rental settlements are ledger
 * rows, so no separate rentalBooking groupBy is needed.
 *
 * Unchanged by track 016 — this is the civil-day report, not the open-till window.
 */
export async function getTillByEmployee(siteId: string, from: Date, to: Date): Promise<EmployeeCashTotal[]> {
  const site = await prisma.site.findUnique({ where: { id: siteId }, select: { userId: true } })
  if (!site) return []

  const employees = await prisma.employee.findMany({
    where: { accountId: site.userId },
    select: { id: true, name: true, active: true },
    orderBy: { name: 'asc' },
  })

  const entriesByEmp = await prisma.tillEntry.groupBy({
    by: ['employeeId'],
    where: { siteId, employeeId: { not: null }, voidedAt: null, settledAt: { gte: from, lte: to } },
    _sum: { amount: true },
    _count: true,
  })

  const tally = new Map<string, { total: number; count: number }>()
  const add = (id: string | null, amount: number | null, count: number) => {
    if (!id) return
    const cur = tally.get(id) ?? { total: 0, count: 0 }
    cur.total += amount ?? 0
    cur.count += count
    tally.set(id, cur)
  }
  for (const r of entriesByEmp) add(r.employeeId, r._sum.amount, r._count)

  // Every account employee maps to a tally (zero when no in-window sales). Deleting
  // an Employee SetNulls the FK and inactive ones stay on the roster, so there are
  // no dangling attributed ids beyond this list.
  return employees.map((e) => {
    const t = tally.get(e.id) ?? { total: 0, count: 0 }
    return { employeeId: e.id, name: e.name, active: e.active, total: round(t.total), count: t.count }
  })
}

/**
 * Per-employee **itemized** attribution for `[from, to]` — every sunbed an employee
 * rang up, with seat identity, timestamp, amount, and channel.
 *
 * Scope = **employee-initiated payments only**: cash walk-ins AND QR-collected card
 * (both carry `employeeId`). Guest self-bookings (`employeeId = null`) are excluded
 * by construction. The window filter uses `createdAt gte/lte` (inclusive), mirroring
 * `getTillByEmployee`'s window semantics.
 *
 * `total` spans BOTH cash and card — intentionally different from `getTillByEmployee`
 * which is cash-only (ledger-sourced). Roster zero-fill follows the same pattern:
 * all account employees appear; no dangling ids beyond the roster (SetNull on delete
 * + inactive employees stay in the roster guarantees this).
 *
 * Auth/ownership is the caller's responsibility. Unchanged by track 016 — this is
 * the civil-day report, not the open-till window.
 */
export async function getEmployeeShiftItems(
  siteId: string,
  from: Date,
  to: Date,
): Promise<EmployeeShift[]> {
  const site = await prisma.site.findUnique({ where: { id: siteId }, select: { userId: true } })
  if (!site) return []

  const [employees, reservations] = await Promise.all([
    prisma.employee.findMany({
      where: { accountId: site.userId },
      select: { id: true, name: true, active: true },
      orderBy: { name: 'asc' },
    }),
    prisma.reservation.findMany({
      where: {
        siteId,
        employeeId: { not: null },
        status: { in: [RESERVATION_PAID_IN_CASH, RESERVATION_COMPLETE] },
        refundedAt: null,
        createdAt: { gte: from, lte: to },
      },
      select: {
        id: true,
        employeeId: true,
        status: true,
        paymentAmount: true,
        createdAt: true,
        items: { select: { number: true, seatLabel: true } },
      },
    }),
  ])

  // Group reservations by employeeId
  const byEmployee = new Map<string, EmployeeShiftItem[]>()
  for (const res of reservations) {
    if (!res.employeeId) continue
    const seats = res.items.map((it) => it.seatLabel ?? String(it.number))
    const item: EmployeeShiftItem = {
      reservationId: res.id,
      seats,
      amount: round(res.paymentAmount ?? 0),
      at: res.createdAt,
      channel: res.status === RESERVATION_PAID_IN_CASH ? 'cash' : 'card',
    }
    const list = byEmployee.get(res.employeeId) ?? []
    list.push(item)
    byEmployee.set(res.employeeId, list)
  }

  // Roster zero-fill: every account employee maps to a shift (empty items when none)
  return employees.map((e) => {
    const items = (byEmployee.get(e.id) ?? []).sort((a, b) => a.at.getTime() - b.at.getTime())
    const total = round(items.reduce((sum, it) => sum + it.amount, 0))
    return {
      employeeId: e.id,
      name: e.name,
      active: e.active,
      total,
      count: items.length,
      items,
    }
  })
}
