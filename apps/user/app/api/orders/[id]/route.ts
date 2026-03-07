/**
 * GET /api/orders/[id]
 *
 * Fetches an order and — if it's still processing — verifies the
 * payment status (Stripe or Mollie) and triggers idempotent invoice creation.
 *
 * Security:
 * - Authenticates via session or anonId query param
 * - Verifies the requesting user owns the order
 *
 * Used by:
 * - RTK Query polling on the order payment-complete page
 * - Webhook (Stripe or Mollie) as primary confirmation, this as fallback
 * - Direct lookup for order details
 */

import prisma from '@repo/data/PrismaCient'
import { processConfirmedOrder } from '@repo/data/payment'
import { NextRequest } from 'next/server'
import { getRequestIdentity, verifyOwnership } from '@/app/api/_lib/auth'
import { isDemoPayment } from '@/app/api/_lib/stripe'
import { getPaymentStatus, isPaymentSucceeded, isPaymentFailed } from '@/app/api/_lib/payment-provider'

// ─── Route Handler ──────────────────────────────────────────────────────────

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  // Authenticate: session user or anonymous user (anonId in query param)
  const identity = await getRequestIdentity(request)
  if (!identity) {
    return Response.json(
      { status: 'error', errors: ['Authentication required'] },
      { status: 401 }
    )
  }

  let order = await prisma.order.findUnique({
    where: { id: params.id },
    include: { orderItems: true, site: true },
  })

  if (!order) {
    return Response.json(
      { status: 'error', errors: ['Order not found'] },
      { status: 404 }
    )
  }

  // Verify ownership
  if (!verifyOwnership(identity, order)) {
    return Response.json(
      { status: 'error', errors: ['Not authorized'] },
      { status: 403 }
    )
  }

  // ── Handle 'processing' state: verify Stripe and process ──────────────

  if (order.status === 'processing' && order.paymentRef) {
    try {
      if (isDemoPayment(order.paymentRef)) {
        // Demo mode: process immediately without provider verification
        await processConfirmedOrder(order.id)
      } else {
        // Real payment: verify with correct provider (Stripe or Mollie)
        const paymentStatus = await getPaymentStatus(order.paymentRef)

        if (isPaymentSucceeded(paymentStatus)) {
          await processConfirmedOrder(order.id)
        } else if (isPaymentFailed(paymentStatus)) {
          // Payment failed, canceled, or expired
          await prisma.order.update({
            where: { id: order.id },
            data: { status: 'payment_failed' },
          })
        }
        // else: still processing (Stripe 'processing', Mollie 'open'/'pending') — wait
      }

      // Re-fetch to return current state
      order = await prisma.order.findUnique({
        where: { id: params.id },
        include: { orderItems: true, site: true },
      })
    } catch (error) {
      console.error('[Order] Payment verification error:', error)
    }
  }

  // ── Handle 'paid' state without invoice (recovery from partial processing)

  if (
    order &&
    order.status === 'paid' &&
    !order.invoiceId
  ) {
    try {
      await processConfirmedOrder(order.id)
      order = await prisma.order.findUnique({
        where: { id: params.id },
        include: { orderItems: true, site: true },
      })
    } catch (error) {
      console.error('[Order] Invoice creation recovery error:', error)
    }
  }

  return Response.json(order)
}