/**
 * POST /api/tab-payment/mollie/create-payment
 *
 * Creates a Mollie payment for a dine-in tab using Mollie for Platforms.
 *
 * The payment is created on the PARTNER's Mollie account (via their OAuth
 * access token), making the partner the Merchant of Record. Our platform
 * commission is collected as an applicationFee that Mollie routes to us.
 *
 * Security model: NO ownership check by design. This follows the
 * QR-URL-as-credential model — possessing the open tab's CUID (from the QR
 * URL) is the credential, exactly as getTabState. Any holder of the QR-URL
 * (i.e. anyone at the table) may initiate payment for the tab.
 *
 * Concurrency: the tab is atomically claimed (TAB_OPEN → TAB_PENDING_PAYMENT)
 * before the total is computed. This blocks concurrent second payers and
 * freezes ordering so the total cannot drift after the claim. Any failure
 * after the claim reverts it to TAB_OPEN so the tab never wedges in
 * pending_payment.
 *
 * Flow:
 * 1. Validate tabId + redirectUrl
 * 2. Atomically claim the tab (TAB_OPEN → TAB_PENDING_PAYMENT)
 * 3. Compute payableTotal via calculateTabTotal (never trust client totals)
 * 4. Load partner's Mollie credentials + resolve profile
 * 5. Create payment on partner's account with applicationFee
 * 6. Store paymentRef on tab, return checkoutUrl
 */

import prisma from '@repo/data/PrismaCient'
import {
  loadFeeContext,
  resolveServiceFee,
  calculateServiceFeeAmount,
  calculateTabTotal,
  round,
} from '@repo/data/payment'
import { isTestMode } from '@repo/data/env'
import { TAB_OPEN, TAB_PENDING_PAYMENT, TAB_TERMINAL_STATUSES } from '@repo/data/reservation-status'
import { NextRequest } from 'next/server'
import { getMollieClientForPartner, getValidMollieToken } from '@/app/api/_lib/mollie'
import { isValidEntityId } from '@/app/api/_lib/payment-ids'

export async function POST(request: NextRequest) {
  const body = await request.json()
  const { tabId, redirectUrl } = body

  // ── Validate inputs ──────────────────────────────────────────────────────

  if (!tabId) {
    return Response.json({ error: 'tabId is required' }, { status: 400 })
  }

  if (!isValidEntityId(tabId)) {
    return Response.json({ error: 'Invalid tabId format' }, { status: 400 })
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

  // ── Claim the tab atomically (TAB_OPEN → TAB_PENDING_PAYMENT) ───────────
  // This blocks concurrent second payers and freezes ordering so the total
  // computed next cannot drift.
  const claimResult = await prisma.tableTab.updateMany({
    where: { id: tabId, status: TAB_OPEN },
    data: { status: TAB_PENDING_PAYMENT },
  })

  if (claimResult.count === 0) {
    // Claim failed — find out why
    const tab = await prisma.tableTab.findUnique({
      where: { id: tabId },
      select: { id: true, status: true },
    })

    if (!tab) {
      return Response.json({ error: 'Tab not found' }, { status: 404 })
    }

    if (tab.status === TAB_PENDING_PAYMENT) {
      return Response.json({ error: 'Payment already in progress' }, { status: 409 })
    }

    if ((TAB_TERMINAL_STATUSES as readonly string[]).includes(tab.status)) {
      return Response.json({ error: 'Tab is already closed' }, { status: 409 })
    }

    // Unknown state — safe fallback
    return Response.json({ error: 'Tab cannot be paid in its current state' }, { status: 409 })
  }

  // Helper to revert the claim on any failure after this point
  const revertClaim = async () => {
    await prisma.tableTab.updateMany({
      where: { id: tabId, status: TAB_PENDING_PAYMENT },
      data: { status: TAB_OPEN, paymentRef: null },
    })
  }

  // ── Compute payableTotal (NEVER from client) ─────────────────────────────
  const totals = await calculateTabTotal(tabId)

  if (totals.payableTotal <= 0) {
    await revertClaim()
    return Response.json({ error: 'Invalid payment amount' }, { status: 400 })
  }

  // Load the tab to get siteId for fee context
  const tab = await prisma.tableTab.findUnique({
    where: { id: tabId },
    select: { id: true, siteId: true },
  })

  if (!tab) {
    await revertClaim()
    return Response.json({ error: 'Tab not found' }, { status: 404 })
  }

  // ── Load partner's Mollie credentials ────────────────────────────────────
  let site: Awaited<ReturnType<typeof loadFeeContext>>['site']
  let partnerAccount: Awaited<ReturnType<typeof loadFeeContext>>['partnerAccount']
  let settings: Awaited<ReturnType<typeof loadFeeContext>>['settings']

  try {
    // Transitional (dine-in v2 phase 3 replaces this with loadTabFeeContext).
    if (!tab.siteId) {
      throw new Error(`Tab ${tab.id} has no siteId — standalone fee context not yet wired`)
    }
    const ctx = await loadFeeContext(tab.siteId, 'food-and-beverage')
    site = ctx.site
    partnerAccount = ctx.partnerAccount
    settings = ctx.settings
  } catch (err) {
    await revertClaim()
    console.error('[TabPayment] Failed to load fee context:', err)
    return Response.json({ error: 'Failed to load payment configuration' }, { status: 500 })
  }

  if (!partnerAccount?.mollieAccessToken) {
    await revertClaim()
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
    await revertClaim()
    console.error('[TabPayment] Token refresh failed:', err)
    return Response.json(
      {
        error:
          'Partner Mollie session has expired. Please ask the merchant to reconnect their Mollie account.',
      },
      { status: 401 },
    )
  }

  // ── Compute application fee (our platform commission) ────────────────────
  const tier = partnerAccount.subscription?.plan?.tier ?? null
  const matchedFee = resolveServiceFee(
    site.serviceFees,
    partnerAccount.serviceFees,
    settings?.serviceFees ?? [],
    'food-and-beverage',
    tier,
  )
  const applicationFeeAmount = round(calculateServiceFeeAmount(matchedFee, totals.payableTotal))

  const amountValue = totals.payableTotal.toFixed(2)
  const feeValue = applicationFeeAmount.toFixed(2)

  // Build webhook URL
  const baseUrl =
    process.env.NEXT_PUBLIC_BASE_URL ||
    `${request.headers.get('x-forwarded-proto') || 'https'}://${request.headers.get('x-forwarded-host') || request.headers.get('host') || 'localhost:3002'}`
  const webhookUrl = new URL('/api/webhooks/mollie', baseUrl).toString()

  const mollie = getMollieClientForPartner(validAccessToken)

  // ── Resolve profile ID dynamically ───────────────────────────────────────
  let profileId = partnerAccount.mollieProfileId
  if (!profileId) {
    try {
      const profiles = await mollie.profiles.page()
      const active = profiles.find(
        (p: any) => p.status === 'verified' || p.status === 'unverified',
      )
      if (!active) {
        await revertClaim()
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
      await revertClaim()
      console.error('[TabPayment] Failed to fetch profiles:', err)
      return Response.json({ error: 'Failed to retrieve merchant website profiles' }, { status: 500 })
    }
  }

  // ── Create payment on the partner's Mollie account ───────────────────────
  let payment
  try {
    payment = await mollie.payments.create({
      profileId: profileId!,
      amount: {
        value: amountValue,
        currency: 'EUR',
      },
      description: `Tab ${tabId}`,
      redirectUrl,
      webhookUrl,
      metadata: JSON.stringify({
        type: 'tab',
        entityId: tabId,
        siteId: tab.siteId,
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
    })
  } catch (error: any) {
    await revertClaim()
    console.error('[TabPayment] Mollie error:', {
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

  // Store paymentRef on the tab (keep status TAB_PENDING_PAYMENT)
  await prisma.tableTab.update({
    where: { id: tabId },
    data: { paymentRef: payment.id },
  })

  const checkoutUrl = payment.getCheckoutUrl()
  if (!checkoutUrl) {
    // Revert is not critical here — the paymentRef is already set. But we should
    // inform the caller so they can poll.
    console.error('[TabPayment] No checkout URL returned for payment:', payment.id)
    return Response.json({ error: 'Failed to get checkout URL' }, { status: 500 })
  }

  return Response.json({
    checkoutUrl,
    paymentId: payment.id,
  })
}
