/**
 * Per-worker cash till — the operational cash-reconciliation layer (track 008,
 * Alonso "Group A"). A worker's "open till" is the cash they've physically taken
 * at a site this shift, recorded as explicit TillEntry ledger rows. The till is
 * fully ledger-sourced (track 013 P3): reservation settlements and rental
 * settlements are both TillEntry rows. Closing snapshots the total into a
 * TillClose row; the open till then reads zero.
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

export interface OpenTill {
  total: number
  count: number
}

export interface EmployeeTill {
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
 * The worker's open till at a site: cash taken **since their last close** — an
 * uncounted running balance, not a daily reset. If a worker never closed on a
 * prior day, that uncounted cash rolls forward and is swept in by the next
 * close, so cash is never orphaned by a day boundary. If they have never closed
 * at this site, the balance is all-time.
 *
 * Fully ledger-sourced (track 013 P3): sums all non-voided TillEntry rows
 * attributed to this employee since the last TillClose. Rental settlements are
 * TillEntry rows (backfilled by migration 20260621162554_add_till_entry_rental_booking),
 * so no separate rentalBooking aggregate is needed.
 */
export async function getOpenTill(siteId: string, employeeId: string): Promise<OpenTill> {
  const lastClose = await prisma.tillClose.findFirst({
    where: { siteId, employeeId },
    orderBy: { closedAt: 'desc' },
    select: { closedAt: true },
  })

  const entries = await prisma.tillEntry.aggregate({
    where: {
      siteId,
      employeeId,
      voidedAt: null,
      ...(lastClose ? { settledAt: { gt: lastClose.closedAt } } : {}),
    },
    _sum: { amount: true },
    _count: true,
  })

  return {
    total: round(entries._sum.amount ?? 0),
    count: entries._count,
  }
}

/**
 * Every roster employee's **open** (unclosed) till at a site — the manager /
 * admin overview behind the on-site "till summary". Each employee's balance is
 * cash since *their own* last close (all-time if never closed), so a worker who
 * forgot to close on a prior day still surfaces their full uncounted balance
 * here (and closing it snapshots the whole amount). Mirrors getTillByEmployee's
 * roster zero-fill; sorted by name.
 *
 * Read-only; the caller owns auth/ownership.
 */
export async function getOpenTillsByEmployee(siteId: string): Promise<EmployeeTill[]> {
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
      const since = lastCloseByEmp.get(e.id) ?? null
      const agg = await prisma.tillEntry.aggregate({
        where: {
          siteId,
          employeeId: e.id,
          voidedAt: null,
          ...(since ? { settledAt: { gt: since } } : {}),
        },
        _sum: { amount: true },
        _count: true,
      })
      return {
        employeeId: e.id,
        name: e.name,
        active: e.active,
        total: round(agg._sum.amount ?? 0),
        count: agg._count,
      }
    }),
  )
}

export interface OpenTillItem {
  id: string
  kind: 'sunbed' | 'rental'
  label: string
  amount: number
  at: Date
}

export interface EmployeeOpenTill {
  employeeId: string
  name: string
  active: boolean
  total: number
  count: number
  items: OpenTillItem[]
}

/**
 * Every roster employee's open till at a site, ITEMIZED — the Alonso "cierre de
 * caja empleado" per-worker view: each employee's unclosed cash broken down into
 * the individual sunbeds (and cash rentals) that make it up, since their own last
 * close. The `items` sum to `total` (cash-only, because TillEntry rows only exist
 * for cash), so this is the drawer contents, not a broader earnings view. Mirrors
 * getOpenTillsByEmployee's roster zero-fill + since-last-close window, and adds
 * the line items. Sorted by name; items oldest-first.
 *
 * A sunbed line's `label` is the reserved seats joined (seatLabel, else number);
 * a rental line's `label` is the rental item name. Read-only; caller owns auth.
 */
export async function getOpenTillItemsByEmployee(siteId: string): Promise<EmployeeOpenTill[]> {
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
      const since = lastCloseByEmp.get(e.id) ?? null
      const entries = await prisma.tillEntry.findMany({
        where: {
          siteId,
          employeeId: e.id,
          voidedAt: null,
          ...(since ? { settledAt: { gt: since } } : {}),
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
        if (en.reservation) {
          const seats = en.reservation.items.map((it) => it.seatLabel ?? String(it.number))
          return { id: en.id, kind: 'sunbed', label: seats.join(', '), amount: round(en.amount), at: en.settledAt }
        }
        return {
          id: en.id,
          kind: 'rental',
          label: en.rentalBooking?.rentalItem?.name ?? '',
          amount: round(en.amount),
          at: en.settledAt,
        }
      })

      return {
        employeeId: e.id,
        name: e.name,
        active: e.active,
        total: round(entries.reduce((sum, en) => sum + en.amount, 0)),
        count: items.length,
        items,
      }
    }),
  )
}

/**
 * Close EVERY employee's open till at a site in one shot — the manager
 * end-of-day "cierre de caja" cash-up. For each roster employee with a non-zero
 * unclosed balance (from getOpenTillsByEmployee), snapshots a TillClose row.
 * Employees with a zero open balance are skipped (no empty snapshot), exactly
 * like the per-worker closeTill.
 *
 * Idempotent: re-running immediately after a close finds every open till at
 * zero and is a no-op. Returns how many tills were closed and their combined
 * total. Read/aggregation is caller-auth'd; this only writes TillClose rows —
 * it does NOT touch reservations or floor state (that cleanup is the caller's).
 */
export async function closeAllOpenTills(
  siteId: string,
): Promise<{ closedCount: number; totalClosed: number }> {
  const opens = await getOpenTillsByEmployee(siteId)
  const toClose = opens.filter((o) => o.count > 0)
  if (toClose.length === 0) return { closedCount: 0, totalClosed: 0 }

  await prisma.tillClose.createMany({
    data: toClose.map((o) => ({
      siteId,
      employeeId: o.employeeId,
      totalAmount: o.total,
      txnCount: o.count,
    })),
  })

  return {
    closedCount: toClose.length,
    totalClosed: round(toClose.reduce((sum, o) => sum + o.total, 0)),
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
 */
export async function getTillByEmployee(siteId: string, from: Date, to: Date): Promise<EmployeeTill[]> {
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
 * Auth/ownership is the caller's responsibility.
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
