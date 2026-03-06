/**
 * POST /api/subscription/checkout
 *
 * Creates a Stripe Checkout Session for a subscription plan upgrade.
 * Expects JSON body: { planId: string }
 *
 * Flow:
 * 1. Authenticate partner
 * 2. Look up the target plan and its stripePriceId
 * 3. Get or create a Stripe Customer for the partner
 * 4. Create a Stripe Checkout Session in subscription mode
 * 5. Return the checkout URL
 */

import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import { getStripeClient } from '@/app/api/_lib/stripe'
import { NextRequest } from 'next/server'

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user) {
    return Response.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin

  const { planId } = await request.json()
  if (!planId) {
    return Response.json({ error: 'planId is required' }, { status: 400 })
  }

  // Look up the target plan
  const plan = await prisma.subscriptionPlan.findUnique({ where: { id: planId } })
  if (!plan || !plan.stripePriceId) {
    return Response.json({ error: 'Plan not available for purchase' }, { status: 400 })
  }

  // Don't allow purchasing the free tier
  if (plan.tier === 'STARTER') {
    return Response.json({ error: 'Cannot purchase the free plan' }, { status: 400 })
  }

  const stripe = getStripeClient()
  const userId = session.user.id!

  // Get existing subscription to check for Stripe customer
  const existingSub = await prisma.subscription.findUnique({
    where: { partnerAccountId: userId },
  })

  let stripeCustomerId = existingSub?.stripeCustomerId

  // Create Stripe Customer if needed
  if (!stripeCustomerId) {
    const partner = await prisma.partnerAccount.findUnique({
      where: { userId },
    })
    const customer = await stripe.customers.create({
      email: partner?.email ?? session.user.email!,
      name: partner ? `${partner.firstName} ${partner.lastName}` : session.user.name!,
      metadata: { partnerAccountId: userId },
    })
    stripeCustomerId = customer.id

    // Persist the customer ID
    if (existingSub) {
      await prisma.subscription.update({
        where: { partnerAccountId: userId },
        data: { stripeCustomerId },
      })
    }
  }

  // If the partner already has an active Stripe subscription, use the portal
  // for plan changes instead of checkout
  if (existingSub?.stripeSubscriptionId) {
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: stripeCustomerId,
      return_url: `${appUrl}/account/subscription`,
    })
    return Response.json({ url: portalSession.url })
  }

  // Create a new Stripe Checkout Session
  const checkoutSession = await stripe.checkout.sessions.create({
    customer: stripeCustomerId,
    mode: 'subscription',
    line_items: [{ price: plan.stripePriceId, quantity: 1 }],
    success_url: `${appUrl}/account/subscription?checkout=success`,
    cancel_url: `${appUrl}/account/subscription?checkout=canceled`,
    metadata: {
      partnerAccountId: userId,
      planId: plan.id,
    },
    subscription_data: {
      metadata: {
        partnerAccountId: userId,
        planId: plan.id,
      },
    },
  })

  return Response.json({ url: checkoutSession.url })
}
