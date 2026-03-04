/**
 * POST /api/reconcile
 *
 * Reconciliation endpoint for stuck payments. Finds reservations and orders
 * that have been in 'processing' state for too long and resolves them by
 * checking the actual Stripe PaymentIntent status.
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
import { NextRequest } from 'next/server'
import { getStripeClient, isDemoPayment } from '@/app/api/_lib/stripe'

// ─── Configuration ──────────────────────────────────────────────────────────

/** Records older than this are considered stuck. */
const STALE_THRESHOLD_MINUTES = 15

// ─── Stripe Helper ──────────────────────────────────────────────────────────

async function getStripePaymentStatus(paymentRef: string): Promise<string> {
  const stripe = getStripeClient()
  const paymentIntent = await stripe.paymentIntents.retrieve(paymentRef)
  return paymentIntent.status
}

// ─── Route Handler ──────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  // Auth: check secret (supports both cron and manual calls)
  const { RECONCILIATION_SECRET } = process.env
  if (RECONCILIATION_SECRET) {
    const authHeader = request.headers.get('authorization')
    if (authHeader !== `Bearer ${RECONCILIATION_SECRET}`) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const cutoff = new Date(Date.now() - STALE_THRESHOLD_MINUTES * 60 * 1000)
  const results = {
    reservations: { processed: 0, failed: 0, errors: 0 },
    orders: { processed: 0, failed: 0, errors: 0 },
  }

  // ── Reconcile stuck reservations ──────────────────────────────────────

  const stuckReservations = await prisma.reservation.findMany({
    where: {
      status: 'processing',
      paymentRef: { not: null },
      updatedAt: { lt: cutoff },
    },
  })

  for (const reservation of stuckReservations) {
    try {
      if (isDemoPayment(reservation.paymentRef)) {
        await processConfirmedReservation(reservation.id)
        results.reservations.processed++
        continue
      }

      const status = await getStripePaymentStatus(reservation.paymentRef!)

      if (status === 'succeeded') {
        await processConfirmedReservation(reservation.id)
        results.reservations.processed++
      } else if (status !== 'processing' && status !== 'requires_action') {
        await prisma.reservation.update({
          where: { id: reservation.id },
          data: { status: 'payment_failed' },
        })
        results.reservations.failed++
      }
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
      status: 'processing',
      paymentRef: { not: null },
      updatedAt: { lt: cutoff },
    },
  })

  for (const order of stuckOrders) {
    try {
      if (isDemoPayment(order.paymentRef)) {
        await processConfirmedOrder(order.id)
        results.orders.processed++
        continue
      }

      const status = await getStripePaymentStatus(order.paymentRef!)

      if (status === 'succeeded') {
        await processConfirmedOrder(order.id)
        results.orders.processed++
      } else if (status !== 'processing' && status !== 'requires_action') {
        await prisma.order.update({
          where: { id: order.id },
          data: { status: 'payment_failed' },
        })
        results.orders.failed++
      }
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
