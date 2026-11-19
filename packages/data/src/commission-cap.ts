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
import { providerFromRef, type PaymentProviderId } from './payment-refs'

export const COMMISSION_CAP_TIMEZONE = 'Europe/Madrid'

export const CAP_ENTRY_STATUS = {
  RESERVED: 'reserved',
  TAKEN: 'taken',
  RELEASED: 'released',
  /** A refund that gave commission back: its own row, NEGATIVE amount, in the original entry's month. */
  REVERSAL: 'reversal',
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

/** Ledger key for a rental payment group: the lowest booking id, identical at charge, invoice and refund. PURE. */
export function rentalCapSourceKey(bookingIds: string[]): string {
  return capSourceKey('rental', [...bookingIds].sort()[0] ?? '')
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
      status: { in: [CAP_ENTRY_STATUS.RESERVED, CAP_ENTRY_STATUS.TAKEN, CAP_ENTRY_STATUS.REVERSAL] },
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
 * Does a refund on this rail give Sunbnb's commission back? PURE.
 * - Stripe (online + terminal): `refundPaymentIntent` passes `refund_application_fee: true`, and
 *   Stripe returns the application fee pro rata to the refunded amount.
 * - Viva (online + terminal): Viva reverses the ISV fee itself on a refund (`VivaRefundRequest`).
 * - Mollie: NO. Mollie application fees are non-refundable; the full refund comes out of the
 *   venue's balance and the fee stays with the platform (docs.mollie.com, "Application fees").
 *   The commission was collected and stays collected, so it keeps counting toward the cap.
 * - Demo: no money moved and no fee was reversed.
 */
export function refundReversesCommission(provider: PaymentProviderId | null | undefined): boolean {
  return provider === 'stripe' || provider === 'stripe-terminal' || provider === 'viva' || provider === 'viva-terminal'
}

export interface CapReversalInput {
  /** The payable's ledger key (`reservation:<id>` / `rental:<lowest booking id>`). */
  sourceKey: string
  /** One reversal per refund: a retry with the same key is a no-op. Full refunds use `'full'`. */
  refundKey: string
  /** Refunded share of the payment, (0, 1]. The provider reverses the fee pro rata. */
  fraction: number
}

/**
 * A refund that reverses commission lowers the month's counted total by the commission actually
 * reversed: `fraction` x the amount decided for the payable, never more than what is left of it
 * after earlier reversals, so the month never drops below zero. Returns the amount reversed.
 *
 * The reversal is its own ledger row (negative amount, status `reversal`) in the ORIGINAL entry's
 * month, so a refund in July lowers June only. The payable's own entry keeps the amount that was
 * collected and invoiced; the PLATFORM invoice is never rewritten here. Idempotent per
 * `(sourceKey, refundKey)` through the unique `sourceKey` of the reversal row.
 */
export async function reverseCappedCommission(input: CapReversalInput): Promise<number> {
  const fraction = Math.min(1, input.fraction)
  if (!(fraction > 0)) return 0
  const reversalKey = `reversal:${input.sourceKey}:${input.refundKey}`
  return prisma.$transaction(async (tx) => {
    const entry = await tx.commissionCapEntry.findUnique({ where: { sourceKey: input.sourceKey } })
    if (!entry || entry.status === CAP_ENTRY_STATUS.RELEASED || entry.status === CAP_ENTRY_STATUS.REVERSAL) return 0
    await lockSiteMonth(tx, entry.siteId, entry.month)
    const done = await tx.commissionCapEntry.findUnique({ where: { sourceKey: reversalKey } })
    if (done) return round(-done.amount)
    const prior = await tx.commissionCapEntry.aggregate({
      _sum: { amount: true },
      where: { sourceKey: { startsWith: `reversal:${input.sourceKey}:` }, status: CAP_ENTRY_STATUS.REVERSAL },
    })
    const remaining = round(entry.amount + (prior._sum.amount ?? 0))
    const reversed = round(Math.max(0, Math.min(remaining, entry.amount * fraction)))
    if (reversed <= 0) return 0
    await tx.commissionCapEntry.create({
      data: {
        siteId: entry.siteId,
        month: entry.month,
        sourceKey: reversalKey,
        uncappedAmount: 0,
        amount: -reversed,
        status: CAP_ENTRY_STATUS.REVERSAL,
      },
    })
    return reversed
  })
}

/**
 * Refund hook for the refund dispatchers (`refund.ts` `issueReservationRefund`, user app
 * `issueRefund`): after the provider accepted a refund of `paymentRef`, give the reversed commission
 * back to the month. Resolves the payable from the ref (a sunbed reservation, else a rental group);
 * any other payable (order, tab, deposit) has no capped commission and is a no-op. Never throws: the
 * money already moved, so a ledger failure is logged and leaves the month over-counted (the venue
 * pays less, never more). Returns the amount reversed.
 */
export async function reverseCapForRefundedPayment(
  paymentRef: string | null | undefined,
  opts: { refundKey?: string; fraction?: number } = {},
): Promise<number> {
  if (!paymentRef || !refundReversesCommission(providerFromRef(paymentRef))) return 0
  try {
    const reservation = await prisma.reservation.findFirst({ where: { paymentRef }, select: { id: true } })
    let sourceKey: string | null = reservation ? capSourceKey('reservation', reservation.id) : null
    if (!sourceKey) {
      const bookings = await prisma.rentalBooking.findMany({ where: { paymentRef }, select: { id: true } })
      if (bookings.length) sourceKey = rentalCapSourceKey(bookings.map((b) => b.id))
    }
    if (!sourceKey) return 0
    return await reverseCappedCommission({
      sourceKey,
      refundKey: opts.refundKey ?? 'full',
      fraction: opts.fraction ?? 1,
    })
  } catch (err) {
    console.error('[commission-cap] refund reversal failed', paymentRef, err)
    return 0
  }
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
