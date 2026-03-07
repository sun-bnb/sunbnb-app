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
import {
  loadFeeContext,
  resolveServiceFee,
  calculateServiceFeeAmount,
  round,
} from '@repo/data/payment'
import { NextRequest } from 'next/server'
import { getRequestIdentity, verifyOwnership } from '@/app/api/_lib/auth'
import { getMollieClientForPartner } from '@/app/api/_lib/mollie'
import { isValidEntityId } from '@/app/api/_lib/stripe'

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

  if (reservation.status !== 'pending') {
    return Response.json({ error: 'Reservation is not in pending state' }, { status: 400 })
  }

  // Calculate amount from DB (don't trust client-supplied amount)
  const paymentAmount = reservation.paymentAmount ?? 0
  if (paymentAmount <= 0) {
    return Response.json({ error: 'Invalid payment amount' }, { status: 400 })
  }

  // ── Load partner's Mollie credentials ────────────────────────────────────
  const { site, partnerAccount, settings } = await loadFeeContext(
    reservation.siteId,
    'sunbed-rental'
  )

  if (!partnerAccount?.mollieAccessToken) {
    return Response.json(
      { error: 'Partner has not connected their Mollie account' },
      { status: 400 }
    )
  }

  // ── Compute application fee (our platform commission) ────────────────────
  const tier = partnerAccount.subscription?.plan?.tier ?? null
  const matchedFee = resolveServiceFee(
    site.serviceFees,
    partnerAccount.serviceFees,
    settings?.serviceFees ?? [],
    'sunbed-rental',
    tier
  )
  const applicationFeeAmount = round(calculateServiceFeeAmount(matchedFee, paymentAmount))

  // Mollie expects amounts as strings with 2 decimal places (e.g. "10.00")
  const amountValue = paymentAmount.toFixed(2)
  const feeValue = applicationFeeAmount.toFixed(2)

  // Build webhook URL
  const origin = request.headers.get('origin') || request.headers.get('x-forwarded-host')
  const protocol = request.headers.get('x-forwarded-proto') || 'https'
  const webhookUrl = origin
    ? `${protocol}://${origin.replace(/^https?:\/\//, '')}/api/webhooks/mollie`
    : `${process.env.NEXT_PUBLIC_BASE_URL}/api/webhooks/mollie`

  // Create payment on the PARTNER's Mollie account (partner = Merchant of Record)
  const mollie = getMollieClientForPartner(partnerAccount.mollieAccessToken)

  let payment
  try {
    payment = await mollie.payments.create({
      amount: {
        value: amountValue,
        currency: 'EUR',
      },
      description: `Reservation ${reservationId}`,
      redirectUrl,
      webhookUrl,
      metadata: JSON.stringify({
        type: 'reservation',
        entityId: reservationId,
        siteId: reservation.siteId,
      }),
      // Platform commission — routed to our organization automatically by Mollie
      ...(applicationFeeAmount > 0 && {
        applicationFee: {
          amount: {
            value: feeValue,
            currency: 'EUR',
          },
          description: 'Platform fee',
        },
      }),
    })
  } catch (error) {
    console.error('[MolliePayment] Mollie error:', error)
    await prisma.reservation.update({
      where: { id: reservationId },
      data: { status: 'error' },
    })
    return Response.json({ error: 'Failed to create payment' }, { status: 500 })
  }

  // Store paymentRef server-side (atomic — no client round-trip needed)
  await prisma.reservation.update({
    where: { id: reservationId },
    data: {
      paymentRef: payment.id,
      status: 'processing',
    },
  })

  // Mollie returns a checkout URL where the customer completes the payment
  const checkoutUrl = payment.getCheckoutUrl()
  if (!checkoutUrl) {
    console.error('[MolliePayment] No checkout URL returned for payment:', payment.id)
    return Response.json({ error: 'Failed to get checkout URL' }, { status: 500 })
  }

  return Response.json({
    checkoutUrl,
    paymentId: payment.id,
  })
}
