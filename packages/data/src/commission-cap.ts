/**
 * Monthly per-site commission cap (CR-002, Temporada: 2% capped at EUR 199 per site per month).
 *
 * WHY A LEDGER: the commission is computed twice, at charge creation (Mollie `applicationFee`,
 * Stripe `application_fee_amount`, Viva `isvAmount`) and again when the PLATFORM invoice is
 * written in `processConfirmed*`. A pure per-charge rule kept those equal for free; a running
 * monthly cap makes the answer depend on every other payment in the month. So the capped amount is
 * decided ONCE, at charge creation, under `pg_advisory_xact_lock(site, month)`, stored in
 * `CommissionCapEntry` keyed by the payable (`sourceKey`), and read back at invoicing. Collected
 * equals invoiced by construction, and concurrent charges cannot both spend the same headroom.
 *
 * MONTH: the Europe/Madrid calendar month in which the payment was created (founder, M-65,
 * 2026-11-19), not the confirmation month and not the site's own timezone.
 *
 * SCOPE: only plan-rate commission is capped. Negotiated site / account fees bypass the cap (the
 * caller decides via `isPlanRateFee`), and a plan with no cap (`null`) never writes the ledger.
 */
import type { ServiceFee } from '@prisma/client'
import prisma from '../index'
import { round } from './payment-math'

export const COMMISSION_CAP_TIMEZONE = 'Europe/Madrid'

export const CAP_ENTRY_STATUS = {
  RESERVED: 'reserved',
  TAKEN: 'taken',
  RELEASED: 'released',
} as const

/** 'YYYY-MM' of `date` in Europe/Madrid. PURE. */
export function capMonthKey(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: COMMISSION_CAP_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(date)
  const y = parts.find((p) => p.type === 'year')!.value
  const m = parts.find((p) => p.type === 'month')!.value
  return `${y}-${m}`
}

/** min(uncapped, cap - used), never below 0, rounded to cents. `cap = null` = uncapped. PURE. */
export function applyMonthlyCap(uncapped: number, usedThisMonth: number, cap: number | null | undefined): number {
  if (!(uncapped > 0)) return 0
  if (cap == null) return round(uncapped)
  const headroom = round(cap - usedThisMonth)
  return round(Math.max(0, Math.min(uncapped, headroom)))
}

/** True when the fee is a platform (plan-rate) row, not a negotiated site/account fee. PURE. */
export function isPlanRateFee(fee: Pick<ServiceFee, 'siteId' | 'accountId'> | undefined | null): boolean {
  return !!fee && fee.siteId == null && fee.accountId == null
}

/** Stable ledger key for a payable, e.g. `reservation:<id>` or `rental:<paymentGroupId>`. */
export function capSourceKey(kind: 'reservation' | 'rental', id: string): string {
  return `${kind}:${id}`
}

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0]

async function lockSiteMonth(tx: Tx, siteId: string, month: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'commission-cap:' + siteId + ':' + month}))`
}

async function usedInMonth(tx: Tx, siteId: string, month: string, excludeKey?: string): Promise<number> {
  const agg = await tx.commissionCapEntry.aggregate({
    _sum: { amount: true },
    where: {
      siteId,
      month,
      status: { in: [CAP_ENTRY_STATUS.RESERVED, CAP_ENTRY_STATUS.TAKEN] },
      ...(excludeKey ? { sourceKey: { not: excludeKey } } : {}),
    },
  })
  return agg._sum.amount ?? 0
}

export interface CapInput {
  siteId: string
  sourceKey: string
  /** The plan-rate commission before the cap (`serviceFeeForUnits`). */
  uncapped: number
  /** `SubscriptionPlan.monthlyCommissionCapPerSite`; null/undefined = uncapped, no ledger. */
  cap: number | null | undefined
  /** When the payment is created; defaults to now. Fixes the month. */
  at?: Date
}

/**
 * Charge creation: decide the capped commission for a payable and reserve it. Idempotent per
 * `sourceKey`: a retry for the same payable reuses the live entry's amount (it never re-spends
 * headroom); a released entry is re-decided against the current headroom.
 */
export async function reserveCappedCommission(input: CapInput): Promise<number> {
  if (input.cap == null) return round(Math.max(0, input.uncapped))
  return decide(input, CAP_ENTRY_STATUS.RESERVED)
}

/**
 * Invoicing (`processConfirmed*`): the amount to put on the PLATFORM invoice. Reads the amount
 * decided at charge time and marks it taken. A payable with no live entry (created before this
 * ledger existed, or released and then confirmed late) is decided now under the same lock.
 */
export async function takeCappedCommission(input: CapInput): Promise<number> {
  if (input.cap == null) return round(Math.max(0, input.uncapped))
  return decide(input, CAP_ENTRY_STATUS.TAKEN)
}

async function decide(input: CapInput, status: 'reserved' | 'taken'): Promise<number> {
  const month = capMonthKey(input.at ?? new Date())
  return prisma.$transaction(async (tx) => {
    const existing = await tx.commissionCapEntry.findUnique({ where: { sourceKey: input.sourceKey } })
    if (existing && existing.status !== CAP_ENTRY_STATUS.RELEASED) {
      if (status === CAP_ENTRY_STATUS.TAKEN && existing.status !== CAP_ENTRY_STATUS.TAKEN) {
        await tx.commissionCapEntry.update({ where: { id: existing.id }, data: { status } })
      }
      return existing.amount
    }
    // Lock on the entry's own month when re-deciding a released row, so it stays in that month.
    const entryMonth = existing?.month ?? month
    await lockSiteMonth(tx, input.siteId, entryMonth)
    const used = await usedInMonth(tx, input.siteId, entryMonth, input.sourceKey)
    const amount = applyMonthlyCap(input.uncapped, used, input.cap)
    await tx.commissionCapEntry.upsert({
      where: { sourceKey: input.sourceKey },
      create: {
        siteId: input.siteId,
        month: entryMonth,
        sourceKey: input.sourceKey,
        uncappedAmount: round(input.uncapped),
        amount,
        status,
      },
      update: { uncappedAmount: round(input.uncapped), amount, status },
    })
    return amount
  })
}

/** A failed / expired / cancelled-before-payment charge gives its headroom back. Idempotent. */
export async function releaseCappedCommission(sourceKey: string): Promise<void> {
  await prisma.commissionCapEntry.updateMany({
    where: { sourceKey, status: CAP_ENTRY_STATUS.RESERVED },
    data: { status: CAP_ENTRY_STATUS.RELEASED },
  })
}

/**
 * A refund that reverses commission lowers the month's usage by the reversed amount (never below
 * zero), so later bookings that month can take commission again up to the cap.
 */
export async function reverseCappedCommission(sourceKey: string, reversed: number): Promise<void> {
  if (!(reversed > 0)) return
  await prisma.$transaction(async (tx) => {
    const entry = await tx.commissionCapEntry.findUnique({ where: { sourceKey } })
    if (!entry) return
    await lockSiteMonth(tx, entry.siteId, entry.month)
    await tx.commissionCapEntry.update({
      where: { id: entry.id },
      data: { amount: round(Math.max(0, entry.amount - reversed)) },
    })
  })
}

const DEAD_PAYABLE_STATUSES = ['payment_failed', 'canceled'] // RESERVATION_/RENTAL_ PAYMENT_FAILED, CANCELED

/**
 * Sweep: release RESERVED entries whose payable is gone (the stale-booking cron deletes
 * abandoned reservations) or ended without payment (`payment_failed` / `canceled`). Called from
 * `/api/reservations-cleanup`; one place instead of a release call in every failure webhook.
 * Entries younger than `minAgeMs` are left alone so an in-flight charge is never released.
 * Returns the number of entries released. Idempotent.
 */
export async function releaseAbandonedCapEntries(minAgeMs = 30 * 60 * 1000, limit = 500): Promise<number> {
  const entries = await prisma.commissionCapEntry.findMany({
    where: { status: CAP_ENTRY_STATUS.RESERVED, createdAt: { lt: new Date(Date.now() - minAgeMs) } },
    select: { sourceKey: true },
    take: limit,
  })
  const ids = (prefix: string) =>
    entries.filter((e) => e.sourceKey.startsWith(prefix)).map((e) => e.sourceKey.slice(prefix.length))
  const resIds = ids('reservation:')
  const rentalIds = ids('rental:')
  const [reservations, rentals] = await Promise.all([
    resIds.length
      ? prisma.reservation.findMany({ where: { id: { in: resIds } }, select: { id: true, status: true } })
      : [],
    rentalIds.length
      ? prisma.rentalBooking.findMany({ where: { id: { in: rentalIds } }, select: { id: true, status: true } })
      : [],
  ])
  const alive = new Set<string>(
    [
      ...reservations.map((r) => [`reservation:${r.id}`, r.status] as const),
      ...rentals.map((r) => [`rental:${r.id}`, r.status] as const),
    ]
      .filter(([, status]) => !DEAD_PAYABLE_STATUSES.includes(status))
      .map(([key]) => key),
  )
  const dead = entries.map((e) => e.sourceKey).filter((k) => !alive.has(k))
  if (dead.length === 0) return 0
  const res = await prisma.commissionCapEntry.updateMany({
    where: { sourceKey: { in: dead }, status: CAP_ENTRY_STATUS.RESERVED },
    data: { status: CAP_ENTRY_STATUS.RELEASED },
  })
  return res.count
}
