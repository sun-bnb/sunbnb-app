/**
 * POST /api/payment/mollie/create-payment
 *
 * Creates a Mollie payment for a reservation using Mollie for Platforms.
 *
 * The payment is created on the PARTNER's Mollie account (via their OAuth
 * access token), making the partner the Merchant of Record. Our platform
 * commission is collected as an applicationFee that Mollie routes to us.
 *
 * Flow:
 * 1. Validate & authenticate request
 * 2. Look up partner's Mollie credentials
 * 3. Compute application fee via three-tier cascade
 * 4. Create payment on partner's account with applicationFee
 * 5. Store paymentRef, return checkoutUrl for redirect
 */

import prisma from '@repo/data/PrismaCient'
import { createReservationMolliePayment } from '@repo/data/reservation-payment'
import { RESERVATION_PENDING } from '@repo/data/reservation-status'
import { NextRequest } from 'next/server'
import { getRequestIdentity, verifyOwnership } from '@/app/api/_lib/auth'
import { isValidEntityId } from '@/app/api/_lib/payment-ids'

export async function POST(request: NextRequest) {
  const body = await request.json()
  const { reservationId, anonId: bodyAnonId, redirectUrl } = body

  if (!reservationId) {
    return Response.json({ error: 'reservationId is required' }, { status: 400 })
  }

  if (!isValidEntityId(reservationId)) {
    return Response.json({ error: 'Invalid reservationId format' }, { status: 400 })
  }

  if (!redirectUrl) {
    return Response.json({ error: 'redirectUrl is required' }, { status: 400 })
  }

  // Validate redirectUrl — must be on our own domain to prevent open redirect
  const allowedOrigin = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || ''
  try {
    const parsed = new URL(redirectUrl)
    const expected = new URL(allowedOrigin)
    if (parsed.origin !== expected.origin) {
      return Response.json({ error: 'Invalid redirectUrl' }, { status: 400 })
    }
  } catch {
    return Response.json({ error: 'Invalid redirectUrl' }, { status: 400 })
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
    return Response.json({ error: 'Payment already created' }, { status: 400 })
  }

  if (reservation.status !== RESERVATION_PENDING) {
    return Response.json({ error: 'Reservation is not in pending state' }, { status: 400 })
  }

  // Build webhook URL using WHATWG URL API (avoids DEP0169 url.parse warning)
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL
    || `${request.headers.get('x-forwarded-proto') || 'https'}://${request.headers.get('x-forwarded-host') || request.headers.get('host') || 'localhost:3002'}`
  const webhookUrl = new URL('/api/webhooks/mollie', baseUrl).toString()

  // Fee calc, profile resolution, Mollie create, and paymentRef/status storage
  // all live in the shared @repo/data helper (reused by the partner QR collect
  // flow). Map its `reason` back to this route's existing HTTP status codes so
  // the consumer behavior is unchanged.
  const result = await createReservationMolliePayment(reservationId, { redirectUrl, webhookUrl })

  if (result.status === 'error') {
    const statusByReason: Record<string, number> = {
      invalid_amount: 400,
      no_mollie: 400,
      token: 401,
      no_profile: 400,
      provider_422: 422,
      provider_error: 500,
      no_checkout: 500,
    }
    return Response.json({ error: result.error }, { status: statusByReason[result.reason] ?? 500 })
  }

  return Response.json({
    checkoutUrl: result.checkoutUrl,
    paymentId: result.paymentId,
  })
}
