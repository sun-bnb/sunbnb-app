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

// ─── Internal Helpers ────────────────────────────────────────────────────────

function startOfToday(): Date {
  const n = new Date()
  return new Date(n.getFullYear(), n.getMonth(), n.getDate())
}

// ─── Till Read Queries ───────────────────────────────────────────────────────

/**
 * The worker's open till at a site: cash taken since the later of their last
 * close and the start of today (a till is a daily drawer).
 *
 * Fully ledger-sourced (track 013 P3): sums all non-voided TillEntry rows
 * attributed to this employee in the window. Rental settlements are now
 * TillEntry rows (backfilled by migration 20260621162554_add_till_entry_rental_booking),
 * so no separate rentalBooking aggregate is needed.
 */
export async function getOpenTill(siteId: string, employeeId: string): Promise<OpenTill> {
  const lastClose = await prisma.tillClose.findFirst({
    where: { siteId, employeeId },
    orderBy: { closedAt: 'desc' },
    select: { closedAt: true },
  })
  const today = startOfToday()
  const since = lastClose && lastClose.closedAt > today ? lastClose.closedAt : today

  const entries = await prisma.tillEntry.aggregate({
    where: { siteId, employeeId, voidedAt: null, settledAt: { gt: since } },
    _sum: { amount: true },
    _count: true,
  })

  return {
    total: round(entries._sum.amount ?? 0),
    count: entries._count,
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
