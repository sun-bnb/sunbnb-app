/**
 * POST /api/stripe-connect/webhook — Stripe Connect account webhook (track 028).
 * Events: account.updated, capability.updated. Setup: register this URL as a Connect
 * webhook and set STRIPE_CONNECT_ACCOUNT_WEBHOOK_SECRET.
 */
import { NextRequest } from 'next/server'
import type Stripe from 'stripe'
import prisma from '@repo/data/PrismaCient'
import { getStripeConnectClient, snapshotFromAccount, snapshotToColumns } from '@repo/data/stripe'
import { syncEffectiveProviderSafe } from '@/app/api/_lib/sync-effective-provider'

export async function POST(request: NextRequest) {
  const secret = process.env.STRIPE_CONNECT_ACCOUNT_WEBHOOK_SECRET
  if (!secret) {
    console.error('[StripeConnectWebhook] STRIPE_CONNECT_ACCOUNT_WEBHOOK_SECRET is not configured')
    return Response.json({ error: 'Webhook not configured' }, { status: 503 })
  }

  const payload = await request.text()
  const signature = request.headers.get('stripe-signature')
  if (!signature) return Response.json({ error: 'Missing stripe-signature header' }, { status: 400 })

  const stripe = getStripeConnectClient()
  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(payload, signature, secret)
  } catch (err) {
    console.error('[StripeConnectWebhook] Signature verification failed:', err)
    return Response.json({ error: 'Invalid signature' }, { status: 400 })
  }

  if (event.type !== 'account.updated' && event.type !== 'capability.updated') {
    return Response.json({ received: true })
  }

  try {
    const object = event.data.object as Stripe.Account | Stripe.Capability
    const accountId = event.account ?? (event.type === 'account.updated' ? (object as Stripe.Account).id : undefined)
    if (!accountId) return Response.json({ received: true })

    const partner = await prisma.partnerAccount.findUnique({
      where: { stripeConnectAccountId: accountId },
      select: { userId: true },
    })
    if (!partner) return Response.json({ received: true, ignored: true })

    // account.updated carries the full account; capability.updated does not — re-retrieve.
    const account =
      event.type === 'account.updated'
        ? (object as Stripe.Account)
        : await stripe.accounts.retrieve(accountId)

    await prisma.partnerAccount.update({
      where: { userId: partner.userId },
      data: snapshotToColumns(snapshotFromAccount(account)),
    })
    await syncEffectiveProviderSafe(partner.userId)
  } catch (err) {
    console.error(`[StripeConnectWebhook] Error handling ${event.type}:`, err)
    return Response.json({ error: 'Webhook handler failed' }, { status: 500 })
  }

  return Response.json({ received: true })
}
