/**
 * POST /api/reconcile
 *
 * Reconciliation endpoint for stuck payments. Finds reservations and orders
 * that have been in 'processing' state for too long and resolves them by
 * checking the actual provider (Mollie / demo) payment status.
 *
 * Can be triggered by:
 * - Vercel Cron Jobs (add to vercel.json)
 * - Manual API call with authorization
 *
 * Protected by RECONCILIATION_SECRET environment variable.
 *
 * Vercel cron config example (add to vercel.json):
 *   "crons": [{ "path": "/api/reconcile", "schedule": "0/15 * * * *" }]
 */

import prisma from '@repo/data/PrismaCient'
import {
  processConfirmedReservation,
  processConfirmedOrder,
} from '@repo/data/payment'
import {
  RESERVATION_PROCESSING,
  RESERVATION_PAYMENT_FAILED,
  ORDER_PROCESSING,
  ORDER_PAYMENT_FAILED,
} from '@repo/data/reservation-status'
import { NextRequest } from 'next/server'
import {
  getPaymentStatus,
  isPaymentSucceeded,
  isPaymentFailed,
} from '@/app/api/_lib/payment-provider'

// ─── Configuration ──────────────────────────────────────────────────────────

/** Records older than this are considered stuck. */
const STALE_THRESHOLD_MINUTES = 15

// ─── Route Handler ──────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  // Auth: always require RECONCILIATION_SECRET — never allow unauthenticated access
  const { RECONCILIATION_SECRET } = process.env
  if (!RECONCILIATION_SECRET) {
    console.error('[Reconcile] RECONCILIATION_SECRET is not configured')
    return Response.json({ error: 'Reconciliation not configured' }, { status: 503 })
  }

  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${RECONCILIATION_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const cutoff = new Date(Date.now() - STALE_THRESHOLD_MINUTES * 60 * 1000)
  const results = {
    reservations: { processed: 0, failed: 0, errors: 0 },
    orders: { processed: 0, failed: 0, errors: 0 },
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
    try {
      const status = await getPaymentStatus(reservation.paymentRef!)

      if (isPaymentSucceeded(status)) {
        await processConfirmedReservation(reservation.id)
        results.reservations.processed++
      } else if (isPaymentFailed(status)) {
        await prisma.reservation.update({
          where: { id: reservation.id },
          data: { status: RESERVATION_PAYMENT_FAILED },
        })
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

  console.log('[Reconcile] Complete:', results)

  return Response.json({
    status: 'ok',
    checked: {
      reservations: stuckReservations.length,
      orders: stuckOrders.length,
    },
    results,
  })
}
