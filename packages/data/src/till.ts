/**
 * Per-worker cash till — the operational cash-reconciliation layer (track 008,
 * Alonso "Group A"). A worker's "open till" is the cash they've physically taken
 * at a site this shift, recorded as explicit TillEntry ledger rows. The
 * reservation portion of the till is sourced from TillEntry (track 013 P0);
 * the rental portion still comes from RentalBooking.paymentAmount (moves to
 * the ledger in track 013 P3). Closing snapshots the total into a TillClose row;
 * the open till then reads zero.
 *
 * Ledger helpers exported here:
 *   recordSettlement   — write a TillEntry for cash taken on a reservation
 *   voidSettlementsForReservation — mark cash returned (voids all non-voided
 *                        entries for that reservation so they stop counting)
 *
 * Read-only aggregation; the caller (partner action) owns auth/ownership. Mirrors
 * the `@repo/data/analytics` pattern. Integration-tested against sunbnb_test.
 */

import prisma from '../index'
import { round } from './payment'
import { RESERVATION_PAID_IN_CASH } from './reservation-status'

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
  employeeId: string | null
  amount: number
  settledAt: Date
  voidedAt: Date | null
  createdAt: Date
}

// ─── Ledger Helpers ──────────────────────────────────────────────────────────

/**
 * Record a cash settlement for a reservation.
 * Creates a TillEntry that immediately contributes to the open till.
 * settledAt defaults to now() — pass a specific date only for historical backfills.
 */
export async function recordSettlement(opts: {
  siteId: string
  reservationId?: string | null
  employeeId?: string | null
  amount: number
  settledAt?: Date
}): Promise<TillEntryRow> {
  const { siteId, reservationId = null, employeeId = null, amount, settledAt = new Date() } = opts
  return prisma.tillEntry.create({
    data: { siteId, reservationId, employeeId, amount, settledAt },
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
 * Reservation portion: sum of non-voided TillEntry rows attributed to this
 * employee in the window.
 * Rental portion: cash rental bookings (paymentAmount) by this employee in
 * the window — unchanged until track 013 P3 moves rentals to the ledger.
 */
export async function getOpenTill(siteId: string, employeeId: string): Promise<OpenTill> {
  const lastClose = await prisma.tillClose.findFirst({
    where: { siteId, employeeId },
    orderBy: { closedAt: 'desc' },
    select: { closedAt: true },
  })
  const today = startOfToday()
  const since = lastClose && lastClose.closedAt > today ? lastClose.closedAt : today

  const [entries, rent] = await Promise.all([
    // Reservation portion: explicit ledger entries
    prisma.tillEntry.aggregate({
      where: { siteId, employeeId, voidedAt: null, settledAt: { gt: since } },
      _sum: { amount: true },
      _count: true,
    }),
    // Rental portion: cash rental bookings (unchanged until P3)
    prisma.rentalBooking.aggregate({
      where: { siteId, employeeId, status: RESERVATION_PAID_IN_CASH, createdAt: { gt: since } },
      _sum: { paymentAmount: true },
      _count: true,
    }),
  ])

  return {
    total: round((entries._sum.amount ?? 0) + (rent._sum.paymentAmount ?? 0)),
    count: entries._count + rent._count,
  }
}

/**
 * Per-employee cash for a site over `[from, to]` — the manager day-breakdown.
 * Returns every roster employee of the site's account (zero rows included), plus
 * any departed/removed employee who still has attributed cash in-window.
 *
 * Reservation portion: non-voided TillEntry rows with settledAt in [from, to].
 * Rental portion: cash rental bookings with createdAt in [from, to].
 */
export async function getTillByEmployee(siteId: string, from: Date, to: Date): Promise<EmployeeTill[]> {
  const site = await prisma.site.findUnique({ where: { id: siteId }, select: { userId: true } })
  if (!site) return []

  const employees = await prisma.employee.findMany({
    where: { accountId: site.userId },
    select: { id: true, name: true, active: true },
    orderBy: { name: 'asc' },
  })

  const [entriesByEmp, rentByEmp] = await Promise.all([
    // Reservation portion: non-voided ledger entries in window
    prisma.tillEntry.groupBy({
      by: ['employeeId'],
      where: { siteId, employeeId: { not: null }, voidedAt: null, settledAt: { gte: from, lte: to } },
      _sum: { amount: true },
      _count: true,
    }),
    // Rental portion: cash rental bookings in window
    prisma.rentalBooking.groupBy({
      by: ['employeeId'],
      where: { siteId, status: RESERVATION_PAID_IN_CASH, employeeId: { not: null }, createdAt: { gte: from, lte: to } },
      _sum: { paymentAmount: true },
      _count: true,
    }),
  ])

  const tally = new Map<string, { total: number; count: number }>()
  const add = (id: string | null, amount: number | null, count: number) => {
    if (!id) return
    const cur = tally.get(id) ?? { total: 0, count: 0 }
    cur.total += amount ?? 0
    cur.count += count
    tally.set(id, cur)
  }
  for (const r of entriesByEmp) add(r.employeeId, r._sum.amount, r._count)
  for (const r of rentByEmp) add(r.employeeId, r._sum.paymentAmount, r._count)

  // Every account employee maps to a tally (zero when no in-window sales). Deleting
  // an Employee SetNulls the FK and inactive ones stay on the roster, so there are
  // no dangling attributed ids beyond this list.
  return employees.map((e) => {
    const t = tally.get(e.id) ?? { total: 0, count: 0 }
    return { employeeId: e.id, name: e.name, active: e.active, total: round(t.total), count: t.count }
  })
}
