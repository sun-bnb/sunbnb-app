/**
 * POST /api/payment/mollie/create-rental-payment
 *
 * Creates a Mollie payment for one or more rental bookings.
 *
 * Same Mollie for Platforms flow as sunbed reservations:
 * 1. Validate & authenticate request
 * 2. Look up partner's Mollie credentials
 * 3. Compute application fee via three-tier cascade (using 'equipment-rental' code)
 * 4. Create payment on partner's account with applicationFee
 * 5. Store paymentRef on all bookings, return checkoutUrl
 */

import prisma from '@repo/data/PrismaCient'
import {
  loadFeeContext,
  resolveServiceFee,
  calculateServiceFeeAmount,
  round,
} from '@repo/data/payment'
import { isTestMode } from '@repo/data/env'
import { createMolliePaymentWithFeeFallback } from '@repo/data/mollie-app-fee'
import { RENTAL_PENDING, RENTAL_PROCESSING, RENTAL_PAYMENT_FAILED } from '@repo/data/reservation-status'
import { NextRequest } from 'next/server'
import { getRequestIdentity, verifyOwnership } from '@/app/api/_lib/auth'
import { getMollieClientForPartner, getValidMollieToken } from '@/app/api/_lib/mollie'
import { isValidEntityId } from '@/app/api/_lib/payment-ids'

export async function POST(request: NextRequest) {
  const body = await request.json()
  const { rentalBookingIds, anonId: bodyAnonId, redirectUrl } = body

  if (!rentalBookingIds || !Array.isArray(rentalBookingIds) || rentalBookingIds.length === 0) {
    return Response.json({ error: 'rentalBookingIds is required' }, { status: 400 })
  }

  if (rentalBookingIds.length > 20) {
    return Response.json({ error: 'Too many booking IDs' }, { status: 400 })
  }

  for (const id of rentalBookingIds) {
    if (!isValidEntityId(id)) {
      return Response.json({ error: 'Invalid booking ID format' }, { status: 400 })
    }
  }

  if (!redirectUrl) {
    return Response.json({ error: 'redirectUrl is required' }, { status: 400 })
  }

  // Validate redirectUrl — must be on our own domain
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

  // Look up all bookings and validate
  const bookings = await prisma.rentalBooking.findMany({
    where: { id: { in: rentalBookingIds } },
  })

  if (bookings.length !== rentalBookingIds.length) {
    return Response.json({ error: 'Some bookings not found' }, { status: 404 })
  }

  // Verify ownership — all bookings must belong to the requesting user.
  // Uses verifyOwnership so anon users are verified via anonId (not skipped).
  for (const booking of bookings) {
    if (!verifyOwnership(identity, booking)) {
      return Response.json({ error: 'Not authorized' }, { status: 403 })
    }
  }

  // Verify all bookings are for the same site and are in pending state
  const siteIds = new Set(bookings.map(b => b.siteId))
  if (siteIds.size > 1) {
    return Response.json({ error: 'All bookings must be for the same site' }, { status: 400 })
  }

  if (bookings.some(b => b.paymentRef)) {
    return Response.json({ error: 'Payment already created for some bookings' }, { status: 400 })
  }

  if (bookings.some(b => b.status !== RENTAL_PENDING)) {
    return Response.json({ error: 'Some bookings are not in pending state' }, { status: 400 })
  }

  // Calculate total amount from DB (don't trust client)
  const paymentAmount = round(
    bookings.reduce((sum, b) => sum + (b.paymentAmount ?? b.totalPrice ?? 0), 0)
  )
  if (paymentAmount <= 0) {
    return Response.json({ error: 'Invalid payment amount' }, { status: 400 })
  }

  const siteId = bookings[0]!.siteId

  // ── Load partner's Mollie credentials ────────────────────────────────────
  const { site, partnerAccount, settings } = await loadFeeContext(
    siteId,
    'equipment-rental'
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
    validAccessToken = await getValidMollieToken(partnerAccount.userId)
  } catch (err) {
    console.error('[MollieRentalPayment] Token refresh failed:', err)
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
    'equipment-rental',
    tier
  )
  const applicationFeeAmount = round(calculateServiceFeeAmount(matchedFee, paymentAmount))

  const amountValue = paymentAmount.toFixed(2)
  const feeValue = applicationFeeAmount.toFixed(2)

  // Build webhook URL
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL
    || `${request.headers.get('x-forwarded-proto') || 'https'}://${request.headers.get('x-forwarded-host') || request.headers.get('host') || 'localhost:3002'}`
  const webhookUrl = new URL('/api/webhooks/mollie', baseUrl).toString()

  // Create payment on the PARTNER's Mollie account
  const mollie = getMollieClientForPartner(validAccessToken)

  // ── Resolve profile ID dynamically ───────────────────────────────────────
  let profileId = partnerAccount.mollieProfileId
  if (!profileId) {
    try {
      const profiles = await mollie.profiles.page()
      const active = profiles.find((p: any) => p.status === 'verified' || p.status === 'unverified')
      if (!active) {
        return Response.json(
          { error: 'Merchant has no active website profile.' },
          { status: 400 }
        )
      }
      profileId = active.id
    } catch (err) {
      console.error('[MollieRentalPayment] Failed to fetch profiles:', err)
      return Response.json(
        { error: 'Failed to retrieve merchant website profiles' },
        { status: 500 }
      )
    }
  }

  let payment
  try {
    const result = await createMolliePaymentWithFeeFallback(
      (p) => mollie.payments.create(p),
      {
        profileId: profileId!,
        amount: {
          value: amountValue,
          currency: 'EUR',
        },
        description: `Equipment rental (${bookings.length} item${bookings.length !== 1 ? 's' : ''})`,
        redirectUrl,
        webhookUrl,
        metadata: JSON.stringify({
          type: 'rental-booking',
          entityId: rentalBookingIds[0],   // primary booking for lookup
          bookingIds: rentalBookingIds,     // all booking IDs
          siteId,
        }),
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
      },
      '[MollieRentalPayment]',
    )
    payment = result.payment
  } catch (error: any) {
    console.error('[MollieRentalPayment] Mollie error:', {
      title: error?.title,
      detail: error?.detail,
      field: error?.field,
      statusCode: error?.statusCode,
      message: error?.message,
    })

    // Mark bookings failed with the canonical terminal status (not the ad-hoc
    // 'error' string) so they're in a known state for cleanup/queries.
    await prisma.rentalBooking.updateMany({
      where: { id: { in: rentalBookingIds } },
      data: { status: RENTAL_PAYMENT_FAILED },
    })

    if (error?.statusCode === 422) {
      return Response.json(
        {
          error: 'Payment could not be processed. Please try again or contact support.',
        },
        { status: 422 }
      )
    }

    return Response.json({ error: 'Failed to create payment' }, { status: 500 })
  }

  // Store paymentRef on all bookings
  await prisma.rentalBooking.updateMany({
    where: { id: { in: rentalBookingIds } },
    data: {
      paymentRef: payment.id,
      status: RENTAL_PROCESSING,
    },
  })

  const checkoutUrl = payment.getCheckoutUrl()
  if (!checkoutUrl) {
    console.error('[MollieRentalPayment] No checkout URL returned for payment:', payment.id)
    return Response.json({ error: 'Failed to get checkout URL' }, { status: 500 })
  }

  return Response.json({
    checkoutUrl,
    paymentId: payment.id,
  })
}
