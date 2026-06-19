/**
 * Per-worker cash till — the operational cash-reconciliation layer (track 008,
 * Alonso "Group A"). A worker's "open till" is the cash they've physically taken
 * at a site this shift: paid-in-cash walk-in sunbeds + cash walk-in rentals
 * attributed to them, since their last `TillClose` (and not before today).
 * Closing snapshots that total into a `TillClose` row; the open till then reads
 * zero. Comps (free), blocks (out-of-service) and holds (no money) are excluded.
 *
 * Read-only aggregation; the caller (partner action) owns auth/ownership. Mirrors
 * the `@repo/data/analytics` pattern. Integration-tested against sunbnb_test.
 */

import prisma from '../index'
import { round } from './payment'
import { RESERVATION_PAID_IN_CASH, OP_WALKED_IN } from './reservation-status'

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

function startOfToday(): Date {
  const n = new Date()
  return new Date(n.getFullYear(), n.getMonth(), n.getDate())
}

/**
 * The worker's open till at a site: cash taken since the later of their last
 * close and the start of today (a till is a daily drawer). Walk-in sunbeds
 * (paid-in-cash / walked-in) + cash rentals (paid-in-cash); comps/blocks/holds
 * excluded.
 */
export async function getOpenTill(siteId: string, employeeId: string): Promise<OpenTill> {
  const lastClose = await prisma.tillClose.findFirst({
    where: { siteId, employeeId },
    orderBy: { closedAt: 'desc' },
    select: { closedAt: true },
  })
  const today = startOfToday()
  const since = lastClose && lastClose.closedAt > today ? lastClose.closedAt : today
  const createdGate = { createdAt: { gt: since } }

  const [res, rent] = await Promise.all([
    prisma.reservation.aggregate({
      where: { siteId, employeeId, status: RESERVATION_PAID_IN_CASH, operationalStatus: OP_WALKED_IN, ...createdGate },
      _sum: { paymentAmount: true },
      _count: true,
    }),
    prisma.rentalBooking.aggregate({
      where: { siteId, employeeId, status: RESERVATION_PAID_IN_CASH, ...createdGate },
      _sum: { paymentAmount: true },
      _count: true,
    }),
  ])

  return {
    total: round((res._sum.paymentAmount ?? 0) + (rent._sum.paymentAmount ?? 0)),
    count: res._count + rent._count,
  }
}

/**
 * Per-employee cash for a site over `[from, to]` — the manager day-breakdown.
 * Returns every roster employee of the site's account (zero rows included), plus
 * any departed/removed employee who still has attributed cash in-window.
 */
export async function getTillByEmployee(siteId: string, from: Date, to: Date): Promise<EmployeeTill[]> {
  const site = await prisma.site.findUnique({ where: { id: siteId }, select: { userId: true } })
  if (!site) return []

  const employees = await prisma.employee.findMany({
    where: { accountId: site.userId },
    select: { id: true, name: true, active: true },
    orderBy: { name: 'asc' },
  })

  const resGate = {
    siteId, status: RESERVATION_PAID_IN_CASH, operationalStatus: OP_WALKED_IN,
    employeeId: { not: null }, createdAt: { gte: from, lte: to },
  }
  const rentGate = {
    siteId, status: RESERVATION_PAID_IN_CASH,
    employeeId: { not: null }, createdAt: { gte: from, lte: to },
  }
  const [resByEmp, rentByEmp] = await Promise.all([
    prisma.reservation.groupBy({ by: ['employeeId'], where: resGate, _sum: { paymentAmount: true }, _count: true }),
    prisma.rentalBooking.groupBy({ by: ['employeeId'], where: rentGate, _sum: { paymentAmount: true }, _count: true }),
  ])

  const tally = new Map<string, { total: number; count: number }>()
  const add = (id: string | null, amount: number | null, count: number) => {
    if (!id) return
    const cur = tally.get(id) ?? { total: 0, count: 0 }
    cur.total += amount ?? 0
    cur.count += count
    tally.set(id, cur)
  }
  for (const r of resByEmp) add(r.employeeId, r._sum.paymentAmount, r._count)
  for (const r of rentByEmp) add(r.employeeId, r._sum.paymentAmount, r._count)

  // Every account employee maps to a tally (zero when no in-window sales). Deleting
  // an Employee SetNulls the FK and inactive ones stay on the roster, so there are
  // no dangling attributed ids beyond this list.
  return employees.map((e) => {
    const t = tally.get(e.id) ?? { total: 0, count: 0 }
    return { employeeId: e.id, name: e.name, active: e.active, total: round(t.total), count: t.count }
  })
}
