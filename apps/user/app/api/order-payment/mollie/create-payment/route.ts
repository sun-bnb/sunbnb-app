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
import { NextRequest } from 'next/server'
import { getRequestIdentity, verifyOwnership } from '@/app/api/_lib/auth'
import { getMollieClientForPartner } from '@/app/api/_lib/mollie'
import { isValidEntityId } from '@/app/api/_lib/stripe'

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
    })
  } catch (error) {
    console.error('[MolliePayment] Mollie error:', error)
    await prisma.order.update({
      where: { id: orderId },
      data: { status: 'error' },
    })
    return Response.json({ error: 'Failed to create payment' }, { status: 500 })
  }

  // Store paymentRef server-side (atomic — no client round-trip needed)
  await prisma.order.update({
    where: { id: orderId },
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
