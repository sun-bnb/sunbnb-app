/**
 * POST|GET /api/reconcile
 *
 * Reconciliation endpoint for stuck payments. Finds reservations, orders,
 * rental bookings, dine-in tabs and table-reservation deposits that have been
 * awaiting payment for too long and resolves them by checking the actual
 * provider (Mollie / demo) payment status.
 *
 * Triggered by Vercel Cron (GET, every 15 min — see vercel.json) or a manual
 * call. Authorization: `Bearer ${RECONCILIATION_SECRET}` OR `Bearer ${CRON_SECRET}`
 * (Vercel Cron sends CRON_SECRET). 503 only when neither is configured.
 */

import prisma from '@repo/data/PrismaCient'
import { applyTransition } from '@repo/data/reservation-machine-apply'
import {
  processConfirmedReservation,
  processConfirmedOrder,
} from '@repo/data/payment'
import {
  RESERVATION_PROCESSING,
  RESERVATION_PAYMENT_FAILED,
  ORDER_PROCESSING,
  ORDER_PAYMENT_FAILED,
  RENTAL_PROCESSING,
  TAB_PENDING_PAYMENT,
} from '@repo/data/reservation-status'
import { DEPOSIT_STATUS } from '@repo/table-reservations-core'
import { providerFromRef } from '@repo/data/payment-refs'
import { NextRequest } from 'next/server'
import {
  getPaymentStatus,
  isPaymentSucceeded,
  isPaymentFailed,
} from '@/app/api/_lib/payment-provider'
import { findPaymentEntity, onPaymentState } from '@/app/api/_lib/payment-events'

export const dynamic = 'force-dynamic'

// ─── Configuration ──────────────────────────────────────────────────────────

/** Records older than this are considered stuck. */
const STALE_THRESHOLD_MINUTES = 15

// ─── Route Handler ──────────────────────────────────────────────────────────

function authorize(request: NextRequest): Response | null {
  const { RECONCILIATION_SECRET, CRON_SECRET } = process.env
  if (!RECONCILIATION_SECRET && !CRON_SECRET) {
    console.error('[Reconcile] Neither RECONCILIATION_SECRET nor CRON_SECRET is configured')
    return Response.json({ error: 'Reconciliation not configured' }, { status: 503 })
  }

  const authHeader = request.headers.get('authorization')
  const ok =
    (!!RECONCILIATION_SECRET && authHeader === `Bearer ${RECONCILIATION_SECRET}`) ||
    (!!CRON_SECRET && authHeader === `Bearer ${CRON_SECRET}`)
  if (!ok) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return null
}

/** Card-present refs are confirmed by the partner floor flow, never swept here. */
function isSweepable(ref: string | null | undefined): ref is string {
  return !!ref && providerFromRef(ref) !== 'viva-terminal'
}

/** New sweep kinds skip demo refs (demo confirms synchronously; nothing to poll). */
function isSweepableLive(ref: string | null | undefined): ref is string {
  return isSweepable(ref) && providerFromRef(ref) !== 'demo'
}

type Bucket = { processed: number; failed: number; errors: number }

/** Resolve one ref against the provider and apply the domain effect via the shared handlers. */
async function reconcileRef(
  ref: string,
  bucket: Bucket,
  label: string,
  entityId: string,
  opts: { paidOnly?: boolean } = {},
) {
  try {
    const status = await getPaymentStatus(ref)
    const succeeded = isPaymentSucceeded(status)
    if (!succeeded && !isPaymentFailed(status)) return // still pending — next sweep
    // paidOnly: a failed/expired outcome is left to the webhook / poll (see rental sweep).
    if (!succeeded && opts.paidOnly) return
    const meta = await findPaymentEntity(ref)
    if (!meta) {
      console.error(`[Reconcile] No entity found for ${label} ${entityId} (ref ${ref})`)
      bucket.errors++
      return
    }
    await onPaymentState(meta, ref, succeeded ? 'paid' : 'failed')
    if (succeeded) bucket.processed++
    else bucket.failed++
  } catch (error) {
    console.error(`[Reconcile] Error processing ${label} ${entityId}:`, error)
    bucket.errors++
  }
}

export async function POST(request: NextRequest) {
  return reconcile(request)
}

/** Vercel Cron issues GET. */
export async function GET(request: NextRequest) {
  return reconcile(request)
}

async function reconcile(request: NextRequest) {
  const denied = authorize(request)
  if (denied) return denied

  const cutoff = new Date(Date.now() - STALE_THRESHOLD_MINUTES * 60 * 1000)
  const results = {
    reservations: { processed: 0, failed: 0, errors: 0 },
    orders: { processed: 0, failed: 0, errors: 0 },
    rentals: { processed: 0, failed: 0, errors: 0 },
    tabs: { processed: 0, failed: 0, errors: 0 },
    deposits: { processed: 0, failed: 0, errors: 0 },
  }

  // ── Reconcile stuck reservations ──────────────────────────────────────

  const stuckReservations = await prisma.reservation.findMany({
    where: {
      status: RESERVATION_PROCESSING,
      paymentRef: { not: null },
      updatedAt: { lt: cutoff },
    },
  })

  for (const reservation of stuckReservations) {
    if (!isSweepable(reservation.paymentRef)) continue
    try {
      const status = await getPaymentStatus(reservation.paymentRef!)

      if (isPaymentSucceeded(status)) {
        await processConfirmedReservation(reservation.id)
        results.reservations.processed++
      } else if (isPaymentFailed(status)) {
        await applyTransition(reservation.id, 'pay.fail') // machine revert (track 018)
        results.reservations.failed++
      }
      // else: still pending — leave it for the next sweep
    } catch (error) {
      console.error(
        `[Reconcile] Error processing reservation ${reservation.id}:`,
        error
      )
      results.reservations.errors++
    }
  }

  // ── Reconcile stuck orders ────────────────────────────────────────────

  const stuckOrders = await prisma.order.findMany({
    where: {
      status: ORDER_PROCESSING,
      paymentRef: { not: null },
      updatedAt: { lt: cutoff },
    },
  })

  for (const order of stuckOrders) {
    if (!isSweepable(order.paymentRef)) continue
    try {
      const status = await getPaymentStatus(order.paymentRef!)

      if (isPaymentSucceeded(status)) {
        await processConfirmedOrder(order.id)
        results.orders.processed++
      } else if (isPaymentFailed(status)) {
        await prisma.order.update({
          where: { id: order.id },
          data: { status: ORDER_PAYMENT_FAILED },
        })
        results.orders.failed++
      }
      // else: still pending — leave it for the next sweep
    } catch (error) {
      console.error(
        `[Reconcile] Error processing order ${order.id}:`,
        error
      )
      results.orders.errors++
    }
  }

  // ── Reconcile stuck rental bookings (one payment per booking group) ───

  const stuckRentals = await prisma.rentalBooking.findMany({
    where: {
      status: RENTAL_PROCESSING,
      paymentRef: { not: null },
      updatedAt: { lt: cutoff },
    },
  })
  const seenRentalRefs = new Set<string>()
  for (const rental of stuckRentals) {
    const ref = rental.paymentRef
    if (!isSweepableLive(ref) || seenRentalRefs.has(ref)) continue
    seenRentalRefs.add(ref)
    // paidOnly: `findPaymentEntity` cannot tell whether a rental was a partner QR collect
    // (Mollie metadata `collect`), and a failed collect must revert to paid-in-cash while a
    // failed online payment goes to payment_failed. Only the webhook and the
    // `api/rental-bookings/[id]` poll carry that context, so a failed/expired rental is left to them.
    await reconcileRef(ref, results.rentals, 'rental booking', rental.id, { paidOnly: true })
  }

  // ── Reconcile stuck dine-in tabs ──────────────────────────────────────

  const stuckTabs = await prisma.tableTab.findMany({
    where: {
      status: TAB_PENDING_PAYMENT,
      paymentRef: { not: null },
      updatedAt: { lt: cutoff },
    },
  })
  for (const tab of stuckTabs) {
    if (!isSweepableLive(tab.paymentRef)) continue
    await reconcileRef(tab.paymentRef, results.tabs, 'tab', tab.id)
  }

  // ── Reconcile stuck table-reservation deposits ────────────────────────

  const stuckDeposits = await prisma.tableReservation.findMany({
    where: {
      depositStatus: DEPOSIT_STATUS.PENDING,
      paymentRef: { not: null },
      updatedAt: { lt: cutoff },
    },
  })
  for (const deposit of stuckDeposits) {
    if (!isSweepableLive(deposit.paymentRef)) continue
    await reconcileRef(deposit.paymentRef, results.deposits, 'table deposit', deposit.id)
  }

  console.log('[Reconcile] Complete:', results)

  return Response.json({
    status: 'ok',
    checked: {
      reservations: stuckReservations.length,
      orders: stuckOrders.length,
      rentals: stuckRentals.length,
      tabs: stuckTabs.length,
      deposits: stuckDeposits.length,
    },
    results,
  })
}
