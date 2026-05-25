/**
 * POST /api/table-reservations/[id]/deposit/mollie
 *
 * Creates a Mollie payment for a table-reservation deposit (no-show protection).
 *
 * The payment is created on the restaurant's partner Mollie account (via their
 * OAuth access token). No applicationFee is applied — deposits are a
 * consumer-to-partner guarantee; the platform no-show charge cascade (separate
 * agent, track 002 1e) handles any deductions post-no-show.
 *
 * Flow:
 * 1. Validate & authenticate request (session userId or anonId)
 * 2. Fetch table reservation — verify PENDING_PAYMENT + deposit amount from DB
 * 3. Resolve restaurant → partnerAccount Mollie credentials
 * 4. Create payment on partner's Mollie account
 * 5. Store paymentRef, return checkoutUrl for redirect
 */

import prisma from '@repo/data/PrismaCient'
import { isTestMode } from '@repo/data/env'
import { NextRequest } from 'next/server'
import { getRequestIdentity } from '@/app/api/_lib/auth'
import { getMollieClientForPartner, getValidMollieToken } from '@/app/api/_lib/mollie'
import { isValidEntityId } from '@/app/api/_lib/payment-ids'
import { TABLE_RESERVATION_STATUS, DEPOSIT_STATUS } from '@repo/table-reservations-core'
import { isFlagEnabled } from '@/app/flags'

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  if (!(await isFlagEnabled('restaurants'))) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  const tableReservationId = params.id

  if (!isValidEntityId(tableReservationId)) {
    return Response.json({ error: 'Invalid reservation id' }, { status: 400 })
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { anonId: bodyAnonId, redirectUrl } = body as {
    anonId?: string
    redirectUrl?: string
  }

  if (!redirectUrl || typeof redirectUrl !== 'string') {
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

  // Load table reservation
  const tableReservation = await prisma.tableReservation.findUnique({
    where: { id: tableReservationId },
    select: {
      id: true,
      userId: true,
      anonId: true,
      status: true,
      depositAmount: true,
      depositStatus: true,
      paymentRef: true,
      restaurantId: true,
      restaurant: {
        select: {
          id: true,
          name: true,
          partnerAccountId: true,
          partnerAccount: {
            select: {
              userId: true,
              mollieAccessToken: true,
              mollieRefreshToken: true,
              mollieProfileId: true,
            },
          },
        },
      },
    },
  })

  if (!tableReservation) {
    return Response.json({ error: 'Reservation not found' }, { status: 404 })
  }

  // Ownership check: session userId or anonId must match
  const ownerUserId = tableReservation.userId
  const ownerAnonId = tableReservation.anonId
  const isOwner =
    (identity.userId && ownerUserId && identity.userId === ownerUserId) ||
    (identity.anonId && ownerAnonId && identity.anonId === ownerAnonId)

  if (!isOwner) {
    return Response.json({ error: 'Not authorized' }, { status: 403 })
  }

  // Must be in PENDING_PAYMENT state awaiting a deposit
  if (tableReservation.status !== TABLE_RESERVATION_STATUS.PENDING_PAYMENT) {
    return Response.json(
      { error: 'Reservation is not awaiting deposit payment' },
      { status: 400 },
    )
  }

  if (tableReservation.depositStatus !== DEPOSIT_STATUS.PENDING) {
    return Response.json(
      { error: 'Deposit is not in pending state' },
      { status: 400 },
    )
  }

  // Idempotency guard — payment already created for this reservation
  if (tableReservation.paymentRef) {
    return Response.json({ error: 'Payment already created' }, { status: 400 })
  }

  // Deposit amount from DB — never trust the client
  const depositAmount = tableReservation.depositAmount ?? 0
  if (depositAmount <= 0) {
    return Response.json({ error: 'Invalid deposit amount' }, { status: 400 })
  }

  // ── Load partner's Mollie credentials ────────────────────────────────────
  const partnerAccount = tableReservation.restaurant.partnerAccount
  if (!partnerAccount?.mollieAccessToken) {
    return Response.json(
      { error: 'Partner has not connected their Mollie account' },
      { status: 400 },
    )
  }

  // ── Ensure the access token is valid (auto-refresh if expired) ───────────
  let validAccessToken: string
  try {
    validAccessToken = await getValidMollieToken(partnerAccount.userId)
  } catch (err) {
    console.error('[MollieDeposit] Token refresh failed:', err)
    return Response.json(
      {
        error:
          'Partner Mollie session has expired. Please ask the merchant to reconnect their Mollie account.',
      },
      { status: 401 },
    )
  }

  // Mollie expects amounts as strings with 2 decimal places (e.g. "10.00")
  const amountValue = depositAmount.toFixed(2)

  // Build webhook URL
  const baseUrl =
    process.env.NEXT_PUBLIC_BASE_URL ||
    `${request.headers.get('x-forwarded-proto') || 'https'}://${
      request.headers.get('x-forwarded-host') ||
      request.headers.get('host') ||
      'localhost:3002'
    }`
  const webhookUrl = new URL('/api/webhooks/mollie', baseUrl).toString()

  // Create payment on the PARTNER's Mollie account
  const mollie = getMollieClientForPartner(validAccessToken)

  // ── Resolve profile ID ───────────────────────────────────────────────────
  let profileId = partnerAccount.mollieProfileId
  if (!profileId) {
    try {
      const profiles = await mollie.profiles.page()
      const active = profiles.find(
        (p: any) => p.status === 'verified' || p.status === 'unverified',
      )
      if (!active) {
        return Response.json(
          {
            error:
              'Merchant has no active website profile. Please create one in the Mollie Dashboard.',
          },
          { status: 400 },
        )
      }
      profileId = active.id
    } catch (err) {
      console.error('[MollieDeposit] Failed to fetch profiles:', err)
      return Response.json(
        { error: 'Failed to retrieve merchant website profiles' },
        { status: 500 },
      )
    }
  }

  let payment
  try {
    payment = await mollie.payments.create({
      profileId: profileId!,
      amount: {
        value: amountValue,
        currency: 'EUR',
      },
      description: `Deposit for table reservation ${tableReservationId}`,
      redirectUrl,
      webhookUrl,
      metadata: JSON.stringify({
        type: 'table-deposit',
        entityId: tableReservationId,
        restaurantId: tableReservation.restaurantId,
      }),
      ...(isTestMode() && { testmode: true }),
    })
  } catch (error: any) {
    console.error('[MollieDeposit] Mollie error:', {
      title: error?.title,
      detail: error?.detail,
      field: error?.field,
      statusCode: error?.statusCode,
      message: error?.message,
    })

    if (error?.statusCode === 422) {
      return Response.json(
        {
          error: 'Payment could not be processed. Please try again or contact support.',
        },
        { status: 422 },
      )
    }

    return Response.json({ error: 'Failed to create payment' }, { status: 500 })
  }

  // Store paymentRef server-side before redirecting
  await prisma.tableReservation.update({
    where: { id: tableReservationId },
    data: { paymentRef: payment.id },
  })

  const checkoutUrl = payment.getCheckoutUrl()
  if (!checkoutUrl) {
    console.error('[MollieDeposit] No checkout URL returned for payment:', payment.id)
    return Response.json({ error: 'Failed to get checkout URL' }, { status: 500 })
  }

  return Response.json({
    checkoutUrl,
    paymentId: payment.id,
  })
}
