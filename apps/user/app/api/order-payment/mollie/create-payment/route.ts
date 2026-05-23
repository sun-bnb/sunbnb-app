/**
 * POST /api/order-payment/mollie/create-payment
 *
 * Creates a Mollie payment for an order using Mollie for Platforms.
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
import { ORDER_PROCESSING } from '@repo/data/reservation-status'
import { NextRequest } from 'next/server'
import { getRequestIdentity, verifyOwnership } from '@/app/api/_lib/auth'
import { getMollieClientForPartner, getValidMollieToken } from '@/app/api/_lib/mollie'
import { isValidEntityId } from '@/app/api/_lib/payment-ids'

export async function POST(request: NextRequest) {
  const body = await request.json()
  const { orderId, anonId: bodyAnonId, redirectUrl } = body

  if (!orderId) {
    return Response.json({ error: 'orderId is required' }, { status: 400 })
  }

  if (!isValidEntityId(orderId)) {
    return Response.json({ error: 'Invalid orderId format' }, { status: 400 })
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
    return Response.json({ error: 'Payment already created' }, { status: 400 })
  }

  // Fees are included in the product price — customer pays exactly productAmount.
  // Service fee + processing fee are deducted from the merchant's share at settlement.
  const productAmount = order.paymentAmount ?? 0
  if (productAmount <= 0) {
    return Response.json({ error: 'Invalid payment amount' }, { status: 400 })
  }

  // ── Load partner's Mollie credentials ────────────────────────────────────
  const { site, partnerAccount, settings } = await loadFeeContext(
    order.siteId,
    'food-and-beverage'
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
    'food-and-beverage',
    tier
  )
  const applicationFeeAmount = round(calculateServiceFeeAmount(matchedFee, productAmount))

  // Mollie expects amounts as strings with 2 decimal places (e.g. "10.00")
  const amountValue = productAmount.toFixed(2)
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
      description: `Order ${orderId}`,
      redirectUrl,
      webhookUrl,
      metadata: JSON.stringify({
        type: 'order',
        entityId: orderId,
        siteId: order.siteId,
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
    await prisma.order.update({
      where: { id: orderId },
      data: { status: 'error' },
    })

    // 422 — typically "payment method not activated" or missing profile
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

  // Store paymentRef server-side (atomic — no client round-trip needed)
  await prisma.order.update({
    where: { id: orderId },
    data: {
      paymentRef: payment.id,
      status: ORDER_PROCESSING,
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
