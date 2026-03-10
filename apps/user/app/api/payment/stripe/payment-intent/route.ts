/**
 * POST /api/payment/stripe/payment-intent
 *
 * Creates a Stripe PaymentIntent for a reservation.
 * - Authenticates the requesting user (session or anonId)
 * - Verifies ownership of the reservation
 * - Validates reservation exists and is in correct state
 * - Calculates amount from DB (server-side, not from client)
 * - Stores paymentRef on reservation atomically
 * - Adds metadata for webhook identification
 */

import prisma from '@repo/data/PrismaCient'
import { NextRequest } from 'next/server'
import type Stripe from 'stripe'
import { getRequestIdentity, verifyOwnership } from '@/app/api/_lib/auth'
import { getStripeClient, isValidEntityId } from '@/app/api/_lib/stripe'
import { RESERVATION_PENDING, RESERVATION_PROCESSING } from '@repo/data/reservation-status'

export async function POST(request: NextRequest) {
  const { STRIPE_SECRET_KEY } = process.env
  if (!STRIPE_SECRET_KEY) {
    return Response.json({ error: 'Payment service not configured' }, { status: 500 })
  }

  const body = await request.json()
  const { reservationId, anonId: bodyAnonId } = body

  if (!reservationId) {
    return Response.json({ error: 'reservationId is required' }, { status: 400 })
  }

  if (!isValidEntityId(reservationId)) {
    return Response.json({ error: 'Invalid reservationId format' }, { status: 400 })
  }

  // Authenticate: session user or anonymous user
  const identity = await getRequestIdentity(request, bodyAnonId)
  if (!identity) {
    return Response.json({ error: 'Authentication required' }, { status: 401 })
  }

  // Look up reservation and validate state
  const reservation = await prisma.reservation.findUnique({
    where: { id: reservationId },
  })

  if (!reservation) {
    return Response.json({ error: 'Reservation not found' }, { status: 404 })
  }

  // Verify the requesting user owns this reservation
  if (!verifyOwnership(identity, reservation)) {
    return Response.json({ error: 'Not authorized' }, { status: 403 })
  }

  if (reservation.paymentRef) {
    return Response.json({ error: 'Payment intent already created' }, { status: 400 })
  }

  if (reservation.status !== RESERVATION_PENDING) {
    return Response.json({ error: 'Reservation is not in pending state' }, { status: 400 })
  }

  // Calculate amount from DB (don't trust client-supplied amount)
  const paymentAmount = reservation.paymentAmount ?? 0
  if (paymentAmount <= 0) {
    return Response.json({ error: 'Invalid payment amount' }, { status: 400 })
  }

  const amountInCents = Math.round(paymentAmount * 100)

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
          type: 'reservation',
          entityId: reservationId,
          siteId: reservation.siteId,
        },
      },
      {
        idempotencyKey: `reservation-pi-${reservationId}`,
      }
    )
  } catch (error) {
    console.error('[PaymentIntent] Stripe error:', error)
    await prisma.reservation.update({
      where: { id: reservationId },
      data: { status: 'error' },
    })
    return Response.json({ error: 'Failed to create payment intent' }, { status: 500 })
  }

  // Store paymentRef server-side (atomic — no client round-trip needed)
  await prisma.reservation.update({
    where: { id: reservationId },
    data: {
      paymentRef: paymentIntent.id,
      status: RESERVATION_PROCESSING,
    },
  })

  return Response.json({
    clientSecret: paymentIntent.client_secret,
  })
}