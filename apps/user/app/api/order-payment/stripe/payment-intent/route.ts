/**
 * POST /api/order-payment/stripe/payment-intent
 *
 * Creates a Stripe PaymentIntent for an order.
 * - Authenticates the requesting user (session or anonId)
 * - Verifies ownership of the order
 * - Validates order exists and is in correct state
 * - Calculates amount from DB including service fee (server-side)
 * - Stores paymentRef on order atomically
 * - Adds metadata for webhook identification
 */

import prisma from '@repo/data/PrismaCient'
import { calculateOrderServiceFee } from '@repo/data/payment'
import { NextRequest } from 'next/server'
import type Stripe from 'stripe'
import { getRequestIdentity, verifyOwnership } from '@/app/api/_lib/auth'
import { getStripeClient, isValidEntityId } from '@/app/api/_lib/stripe'

export async function POST(request: NextRequest) {
  const { STRIPE_SECRET_KEY } = process.env
  if (!STRIPE_SECRET_KEY) {
    return Response.json({ error: 'Payment service not configured' }, { status: 500 })
  }

  const body = await request.json()
  const { orderId, anonId: bodyAnonId } = body

  if (!orderId) {
    return Response.json({ error: 'orderId is required' }, { status: 400 })
  }

  if (!isValidEntityId(orderId)) {
    return Response.json({ error: 'Invalid orderId format' }, { status: 400 })
  }

  // Authenticate: session user or anonymous user
  const identity = await getRequestIdentity(request, bodyAnonId)
  if (!identity) {
    return Response.json({ error: 'Authentication required' }, { status: 401 })
  }

  // Look up order and validate state
  const order = await prisma.order.findUnique({
    where: { id: orderId },
  })

  if (!order) {
    return Response.json({ error: 'Order not found' }, { status: 404 })
  }

  // Verify the requesting user owns this order
  if (!verifyOwnership(identity, order)) {
    return Response.json({ error: 'Not authorized' }, { status: 403 })
  }

  if (order.paymentRef) {
    return Response.json({ error: 'Payment intent already created' }, { status: 400 })
  }

  // Calculate total amount from DB: product total + service fee
  const productAmount = order.paymentAmount ?? 0
  if (productAmount <= 0) {
    return Response.json({ error: 'Invalid payment amount' }, { status: 400 })
  }

  const serviceFee = await calculateOrderServiceFee(orderId)
  const totalAmount = productAmount + serviceFee
  const amountInCents = Math.round(totalAmount * 100)

  // Create Stripe PaymentIntent with metadata for webhook identification
  const stripe = getStripeClient()

  let paymentIntent: Stripe.PaymentIntent
  try {
    paymentIntent = await stripe.paymentIntents.create(
      {
        amount: amountInCents,
        currency: 'eur',
        automatic_payment_methods: { enabled: true },
        metadata: {
          type: 'order',
          entityId: orderId,
          siteId: order.siteId,
        },
      },
      {
        idempotencyKey: `order-pi-${orderId}`,
      }
    )
  } catch (error) {
    console.error('[PaymentIntent] Stripe error:', error)
    await prisma.order.update({
      where: { id: orderId },
      data: { status: 'error' },
    })
    return Response.json({ error: 'Failed to create payment intent' }, { status: 500 })
  }
  

  // Store paymentRef server-side (atomic — no client round-trip needed)
  await prisma.order.update({
    where: { id: orderId },
    data: {
      paymentRef: paymentIntent.id,
      status: 'processing',
    },
  })

  return Response.json({
    clientSecret: paymentIntent.client_secret,
  })
}