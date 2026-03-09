/**
 * Subscription Service
 *
 * Provides helpers to query a partner's subscription and enforce plan limits
 * (currently: max number of sites).
 *
 * SECURITY / TRUST BOUNDARY:
 *   `syncStripeSubscription` and `handleSubscriptionCanceled` mutate
 *   subscription state and MUST only be called from Stripe webhook handlers
 *   that have already verified the webhook signature via
 *   `stripe.webhooks.constructEvent()`. Never call these from user-facing
 *   API routes directly.
 */

import prisma from '../index'
import { SubscriptionStatus } from '@prisma/client'

/**
 * Fetch the partner's current subscription with plan details.
 * Returns null if the partner has no subscription record.
 */
export async function getPartnerSubscription(partnerAccountId: string) {
  return prisma.subscription.findUnique({
    where: { partnerAccountId },
    include: { plan: true },
  })
}

/**
 * Check whether the partner is allowed to create another site
 * based on their subscription plan's maxSites limit.
 *
 * Returns { allowed, currentCount, maxSites, tier }.
 */
export async function canCreateSite(userId: string) {
  const subscription = await getPartnerSubscription(userId)

  // No subscription → treat as Starter (1 site max)
  const maxSites = subscription?.plan?.maxSites ?? 1
  const tier = subscription?.plan?.tier ?? 'STARTER'

  const currentCount = await prisma.site.count({
    where: { userId },
  })

  return {
    allowed: currentCount < maxSites,
    currentCount,
    maxSites,
    tier,
  }
}

/**
 * Sync subscription state from a Stripe subscription object.
 * Called from the webhook handler on subscription lifecycle events.
 */
export async function syncStripeSubscription(
  stripeSubscriptionId: string,
  stripeCustomerId: string,
  stripePriceId: string,
  status: SubscriptionStatus,
  currentPeriodStart: Date,
  currentPeriodEnd: Date,
  partnerAccountId: string,
) {
  // Resolve the plan from the Stripe Price ID
  const plan = await prisma.subscriptionPlan.findFirst({
    where: { stripePriceId },
  })

  if (!plan) {
    console.error(`[Subscription] No plan found for Stripe Price: ${stripePriceId}`)
    return
  }

  await prisma.subscription.upsert({
    where: { partnerAccountId },
    update: {
      planId: plan.id,
      status,
      stripeSubscriptionId,
      stripeCustomerId,
      currentPeriodStart,
      currentPeriodEnd,
    },
    create: {
      partnerAccountId,
      planId: plan.id,
      status,
      stripeSubscriptionId,
      stripeCustomerId,
      currentPeriodStart,
      currentPeriodEnd,
    },
  })

  console.log(`[Subscription] Synced ${partnerAccountId} → ${plan.tier} (${status})`)
}

/**
 * Handle subscription cancellation from Stripe.
 * Downgrades the partner back to the STARTER plan.
 */
export async function handleSubscriptionCanceled(partnerAccountId: string) {
  const starterPlan = await prisma.subscriptionPlan.findUnique({
    where: { tier: 'STARTER' },
  })

  if (!starterPlan) {
    console.error('[Subscription] STARTER plan not found for downgrade')
    return
  }

  await prisma.subscription.update({
    where: { partnerAccountId },
    data: {
      planId: starterPlan.id,
      status: 'ACTIVE',
      stripeSubscriptionId: null,
      stripeCustomerId: null,
      currentPeriodStart: null,
      currentPeriodEnd: null,
    },
  })

  console.log(`[Subscription] Canceled & downgraded ${partnerAccountId} → STARTER`)
}
