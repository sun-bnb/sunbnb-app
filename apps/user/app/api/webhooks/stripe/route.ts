/**
 * POST /api/webhooks/stripe
 *
 * Stripe webhook endpoint. Handles payment lifecycle events:
 * - payment_intent.succeeded  → creates invoice via shared payment service
 * - payment_intent.payment_failed → marks reservation/order as failed
 * - charge.refunded → marks reservation/order as refunded (dashboard refunds)
 *
 * This is the PRIMARY confirmation path. The polling route in
 * GET /api/reservations/[id] serves as a FALLBACK.
 *
 * Setup:
 * 1. Add STRIPE_WEBHOOK_SECRET to environment variables
 * 2. Register this URL in Stripe Dashboard → Webhooks
 *    URL: https://your-domain.com/api/webhooks/stripe
 *    Events: payment_intent.succeeded, payment_intent.payment_failed, charge.refunded
 */

import prisma from '@repo/data/PrismaCient'
import {
  processConfirmedReservation,
  processConfirmedOrder,
} from '@repo/data/payment'
import { NextRequest } from 'next/server'
import Stripe from 'stripe'
import { getStripeClient } from '@/app/api/_lib/stripe'

// ─── Helpers ────────────────────────────────────────────────────────────────

async function handlePaymentSucceeded(
  paymentIntent: Stripe.PaymentIntent
): Promise<void> {
  const { type, entityId } = paymentIntent.metadata

  if (!type || !entityId) {
    console.warn(
      '[Webhook] PaymentIntent missing metadata:',
      paymentIntent.id
    )
    return
  }

  if (type === 'reservation') {
    await processConfirmedReservation(entityId)
  } else if (type === 'order') {
    await processConfirmedOrder(entityId)
  } else {
    console.warn('[Webhook] Unknown payment type in metadata:', type)
  }
}

async function handlePaymentFailed(
  paymentIntent: Stripe.PaymentIntent
): Promise<void> {
  const { type, entityId } = paymentIntent.metadata

  if (!type || !entityId) {
    console.warn(
      '[Webhook] PaymentIntent missing metadata:',
      paymentIntent.id
    )
    return
  }

  // Use updateMany to silently succeed on 0 rows (avoids RecordNotFound
  // which would cause Stripe to retry the webhook indefinitely)
  if (type === 'reservation') {
    await prisma.reservation.updateMany({
      where: { id: entityId },
      data: { status: 'payment_failed' },
    })
  } else if (type === 'order') {
    await prisma.order.updateMany({
      where: { id: entityId },
      data: { status: 'payment_failed' },
    })
  }
}

async function handleChargeRefunded(
  charge: Stripe.Charge
): Promise<void> {
  const paymentIntentId =
    typeof charge.payment_intent === 'string'
      ? charge.payment_intent
      : charge.payment_intent?.id

  if (!paymentIntentId) {
    console.warn('[Webhook] Refund charge missing payment_intent:', charge.id)
    return
  }

  // Mark matching reservation or order as refunded
  const updatedReservations = await prisma.reservation.updateMany({
    where: { paymentRef: paymentIntentId },
    data: { status: 'refunded' },
  })

  const updatedOrders = await prisma.order.updateMany({
    where: { paymentRef: paymentIntentId },
    data: { status: 'refunded' },
  })

  if (updatedReservations.count === 0 && updatedOrders.count === 0) {
    console.warn('[Webhook] Refund: no matching entity for PI:', paymentIntentId)
  }
}

// ─── Route Handler ──────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const { STRIPE_WEBHOOK_SECRET } = process.env

  if (!STRIPE_WEBHOOK_SECRET) {
    console.error('[Webhook] STRIPE_WEBHOOK_SECRET is not configured')
    return Response.json(
      { error: 'Webhook not configured' },
      { status: 500 }
    )
  }

  // Read raw body for signature verification
  const payload = await request.text()
  const signature = request.headers.get('stripe-signature')

  if (!signature) {
    return Response.json({ error: 'Missing stripe-signature header' }, { status: 400 })
  }

  // Verify webhook signature
  const stripe = getStripeClient()
  let event: Stripe.Event

  try {
    event = stripe.webhooks.constructEvent(payload, signature, STRIPE_WEBHOOK_SECRET)
  } catch (error) {
    console.error('[Webhook] Signature verification failed:', error)
    return Response.json({ error: 'Invalid signature' }, { status: 400 })
  }

  // Handle supported event types
  try {
    switch (event.type) {
      case 'payment_intent.succeeded': {
        const paymentIntent = event.data.object as Stripe.PaymentIntent
        console.log('[Webhook] Payment succeeded:', paymentIntent.id)
        await handlePaymentSucceeded(paymentIntent)
        break
      }

      case 'payment_intent.payment_failed': {
        const paymentIntent = event.data.object as Stripe.PaymentIntent
        console.log('[Webhook] Payment failed:', paymentIntent.id)
        await handlePaymentFailed(paymentIntent)
        break
      }

      case 'charge.refunded': {
        const charge = event.data.object as Stripe.Charge
        console.log('[Webhook] Charge refunded:', charge.id)
        await handleChargeRefunded(charge)
        break
      }

      default:
        // Ignore unhandled event types
        console.log('[Webhook] Unhandled event type:', event.type)
    }
  } catch (error) {
    console.error(`[Webhook] Error handling ${event.type}:`, error)
    // Return 500 so Stripe retries the webhook
    return Response.json(
      { error: 'Webhook handler failed' },
      { status: 500 }
    )
  }

  // Acknowledge receipt — Stripe won't retry if we return 200
  return Response.json({ received: true })
}
