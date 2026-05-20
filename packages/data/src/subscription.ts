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
import { SubscriptionStatus, SubscriptionTier } from '@prisma/client'

// ─── Feature Catalog ────────────────────────────────────────────────────────

/**
 * The canonical catalog of subscription feature flags.
 * Add new features here — no migration needed (stored as JSON overrides).
 */
export const SUBSCRIPTION_FEATURES = {
  OFF_PLATFORM_BILLING: {
    key: 'OFF_PLATFORM_BILLING',
    label: 'Off-platform billing',
    description: 'Allow availability-only (unpaid) sites',
  },
} as const

export type SubscriptionFeatureKey = keyof typeof SUBSCRIPTION_FEATURES

/**
 * Per-tier default entitlements.
 * Source of truth for server-side enforcement. Marketing copy in the apps
 * is separate and should align with this map over time.
 */
export const TIER_FEATURE_DEFAULTS: Record<SubscriptionTier, Partial<Record<SubscriptionFeatureKey, boolean>>> = {
  STARTER:  { OFF_PLATFORM_BILLING: false },
  PRO:      { OFF_PLATFORM_BILLING: true },
  BUSINESS: { OFF_PLATFORM_BILLING: true },
}

/**
 * Resolve the effective feature entitlements for a partner.
 * Per-partner override wins; falls back to tier default; then false.
 *
 * Pure function — no DB access. Unit-testable without mocks.
 * `overrides` arrives as Prisma JsonValue — cast at the DB boundary before calling.
 */
export function resolveEffectiveFeatures(
  tier: SubscriptionTier | null,
  overrides: Partial<Record<SubscriptionFeatureKey, boolean>> | null,
): Record<SubscriptionFeatureKey, boolean> {
  const t = tier ?? 'STARTER'
  const out = {} as Record<SubscriptionFeatureKey, boolean>
  for (const key of Object.keys(SUBSCRIPTION_FEATURES) as SubscriptionFeatureKey[]) {
    out[key] = overrides?.[key] ?? TIER_FEATURE_DEFAULTS[t]?.[key] ?? false
  }
  return out
}

// ─── Subscription Resolver ──────────────────────────────────────────────────

/**
 * Merge a partner's base subscription plan with an optional custom-subscription
 * override record. Any non-null value on the custom override wins; unset fields
 * fall back to the base plan; hard defaults apply when neither is present.
 *
 * Pure function — no DB access. Unit-testable without mocks.
 * `custom.featureOverrides` is typed as a partial record but arrives from Prisma
 * as JsonValue — cast at the DB boundary (call site) before passing here.
 */
export function resolveEffectiveSubscription(
  plan: { tier: SubscriptionTier; name: string; monthlyPrice: number; maxSites: number } | null,
  custom: { maxSites: number | null; featureOverrides?: Partial<Record<SubscriptionFeatureKey, boolean>> | null } | null,
) {
  const tier = plan?.tier ?? ('STARTER' as SubscriptionTier)
  return {
    tier,
    name:         plan?.name         ?? 'Starter',
    monthlyPrice: plan?.monthlyPrice ?? 0,
    maxSites:     custom?.maxSites   ?? plan?.maxSites ?? 1,
    isCustom:     custom != null && custom.maxSites != null,
    features:     resolveEffectiveFeatures(tier, custom?.featureOverrides ?? null),
  }
}

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
 * Load and resolve the effective subscription (plan + custom overrides) for a partner.
 * Returns all merged fields including feature entitlements.
 */
export async function getEffectiveSubscriptionForUser(userId: string) {
  const account = await prisma.partnerAccount.findUnique({
    where: { userId },
    select: {
      customSubscription: true,
      subscription: { include: { plan: true } },
    },
  })
  return resolveEffectiveSubscription(
    account?.subscription?.plan ?? null,
    (account?.customSubscription as any) ?? null,
  )
}

/**
 * Check whether the partner is allowed to create another site.
 * Respects a CustomSubscription override when present.
 *
 * Returns { allowed, currentCount, maxSites, tier, overridden }.
 * `overridden` is true when the effective maxSites comes from a
 * CustomSubscription record rather than the base plan.
 */
export async function canCreateSite(userId: string) {
  const effective = await getEffectiveSubscriptionForUser(userId)

  const currentCount = await prisma.site.count({
    where: { userId },
  })

  return {
    allowed:      currentCount < effective.maxSites,
    currentCount,
    maxSites:     effective.maxSites,
    tier:         effective.tier,
    overridden:   effective.isCustom,
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
