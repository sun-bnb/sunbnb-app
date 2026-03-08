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
import { isTestMode } from '@repo/data/env'
import { NextRequest } from 'next/server'
import { getRequestIdentity, verifyOwnership } from '@/app/api/_lib/auth'
import { getMollieClientForPartner, getValidMollieToken } from '@/app/api/_lib/mollie'
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

  // ── Ensure the access token is valid (auto-refresh if expired) ───────────
  let validAccessToken: string
  try {
    validAccessToken = await getValidMollieToken(
      partnerAccount.userId,
      partnerAccount.mollieAccessToken,
      partnerAccount.mollieRefreshToken,
    )
  } catch (err) {
    console.error('[MolliePayment] Token refresh failed:', err)
    return Response.json(
      { error: 'Partner Mollie session has expired. Please ask the merchant to reconnect their Mollie account.' },
      { status: 401 }
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

  // Build webhook URL using WHATWG URL API (avoids DEP0169 url.parse warning)
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL
    || `${request.headers.get('x-forwarded-proto') || 'https'}://${request.headers.get('x-forwarded-host') || request.headers.get('host') || 'localhost:3002'}`
  const webhookUrl = new URL('/api/webhooks/mollie', baseUrl).toString()

  // Create payment on the PARTNER's Mollie account (partner = Merchant of Record)
  const mollie = getMollieClientForPartner(validAccessToken)

  // ── Resolve profile ID dynamically ───────────────────────────────────────
  let profileId = partnerAccount.mollieProfileId
  if (!profileId) {
    try {
      const profiles = await mollie.profiles.page()
      const active = profiles.find((p: any) => p.status === 'verified' || p.status === 'unverified')
      if (!active) {
        return Response.json(
          { error: 'Merchant has no active website profile. Please create one in the Mollie Dashboard.' },
          { status: 400 }
        )
      }
      profileId = active.id
    } catch (err) {
      console.error('[MolliePayment] Failed to fetch profiles:', err)
      return Response.json(
        { error: 'Failed to retrieve merchant website profiles' },
        { status: 500 }
      )
    }
  }

  // When using OAuth tokens, Mollie defaults to live mode. In development/test
  // environments we must pass testmode: true so that pending-boarding methods work.

  let payment
  try {
    payment = await mollie.payments.create({
      profileId: profileId!,
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
      ...(isTestMode() && { testmode: true }),
    })
  } catch (error: any) {
    console.error('[MolliePayment] Mollie error:', {
      title: error?.title,
      detail: error?.detail,
      field: error?.field,
      statusCode: error?.statusCode,
      message: error?.message,
    })
    await prisma.reservation.update({
      where: { id: reservationId },
      data: { status: 'error' },
    })

    // 422 — typically "payment method not activated" or missing profile
    if (error?.statusCode === 422) {
      return Response.json(
        {
          error: 'Payment could not be processed. The merchant may need to activate payment methods in their Mollie Dashboard.',
          detail: error?.detail || error?.message,
          field: error?.field,
        },
        { status: 422 }
      )
    }

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
