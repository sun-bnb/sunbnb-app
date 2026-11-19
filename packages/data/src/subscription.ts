/**
 * Subscription Service
 *
 * Provides helpers to query a partner's subscription and enforce plan limits
 * (sites per account, hamacas per site) and plan features (CR-002: Gratis /
 * Temporada / Grupo).
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

// ─── Pricing Tier Catalog ───────────────────────────────────────────────────
// Lives in ./pricing-tiers so client components (the landing page, the plan
// cards) can read the ladder without dragging prisma into the browser bundle.
// Re-exported here so server callers keep a single import site.

export {
  PRICING_TIERS,
  PRICING_TIER_ORDER,
  FEATURED_TIER,
  DEFAULT_TIER,
  GRUPO_DEFAULT_MAX_SITES,
  COMMISSIONED_SERVICE_CODES,
  CAPPED_SERVICE_CODES,
  planRowMaxSites,
} from './pricing-tiers'
export type { PricingTierSpec, CommissionedServiceCode } from './pricing-tiers'
import { DEFAULT_TIER, PRICING_TIERS } from './pricing-tiers'

// ─── Feature Catalog ────────────────────────────────────────────────────────

/**
 * The canonical catalog of subscription feature flags.
 * Add new features here — no migration needed (stored as JSON overrides).
 */
export const SUBSCRIPTION_FEATURES = {
  OFF_PLATFORM_BILLING: {
    key: 'OFF_PLATFORM_BILLING',
    label: 'Off-platform billing',
    description: 'Allow availability-only (unpaid) sites — guests pay on site',
  },
  ONLINE_PAYMENTS: {
    key: 'ONLINE_PAYMENTS',
    label: 'Online card payments',
    description: 'Guests can pay sunbed bookings and rentals online by card',
  },
  FOOD_AND_BEVERAGE: {
    key: 'FOOD_AND_BEVERAGE',
    label: 'Food and drink ordering',
    description: 'Menu, orders, tabs and card-paid table deposits',
  },
} as const

export type SubscriptionFeatureKey = keyof typeof SUBSCRIPTION_FEATURES

/**
 * Per-tier default entitlements.
 * Source of truth for server-side enforcement. Marketing copy in the apps
 * is separate and should align with this map over time.
 */
export const TIER_FEATURE_DEFAULTS: Record<SubscriptionTier, Record<SubscriptionFeatureKey, boolean>> = {
  // Gratis: "pay on site" is the normal mode, so off-platform is always allowed.
  GRATIS:    { OFF_PLATFORM_BILLING: true, ONLINE_PAYMENTS: false, FOOD_AND_BEVERAGE: false },
  TEMPORADA: { OFF_PLATFORM_BILLING: true, ONLINE_PAYMENTS: true,  FOOD_AND_BEVERAGE: true },
  GRUPO:     { OFF_PLATFORM_BILLING: true, ONLINE_PAYMENTS: true,  FOOD_AND_BEVERAGE: true },
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
  const t = tier ?? DEFAULT_TIER
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
  plan: {
    tier: SubscriptionTier
    name: string
    monthlyPrice: number
    maxSites: number
    maxHamacasPerSite?: number | null
    monthlyCommissionCapPerSite?: number | null
  } | null,
  custom: {
    maxSites: number | null
    maxHamacasPerSite?: number | null
    featureOverrides?: Partial<Record<SubscriptionFeatureKey, boolean>> | null
  } | null,
) {
  const tier = plan?.tier ?? DEFAULT_TIER
  const fallback = PRICING_TIERS[DEFAULT_TIER]
  // A plan row written before the CR-002 expand migration has NULL limits;
  // `undefined` (column not selected) falls back to the catalogue too. A NULL
  // hamaca limit on a seeded row means "no limit" (Grupo without agreement).
  const planHamacas = plan
    ? plan.maxHamacasPerSite !== undefined ? plan.maxHamacasPerSite : PRICING_TIERS[plan.tier].maxHamacasPerSite
    : fallback.maxHamacasPerSite
  return {
    tier,
    name:              plan?.name         ?? fallback.name,
    monthlyPrice:      plan?.monthlyPrice ?? 0,
    maxSites:          custom?.maxSites   ?? plan?.maxSites ?? fallback.maxSites ?? 1,
    /** null = no limit. Custom (Grupo agreement) wins over the plan. */
    maxHamacasPerSite: custom?.maxHamacasPerSite ?? planHamacas,
    /** null = uncapped. Read by the commission-cap ledger for plan-rate fees only. */
    monthlyCommissionCapPerSite: plan
      ? plan.monthlyCommissionCapPerSite !== undefined
        ? plan.monthlyCommissionCapPerSite
        : PRICING_TIERS[plan.tier].monthlyCommissionCapPerSite
      : fallback.monthlyCommissionCapPerSite,
    isCustom:          custom != null && (custom.maxSites != null || custom.maxHamacasPerSite != null),
    features:          resolveEffectiveFeatures(tier, custom?.featureOverrides ?? null),
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
 *
 * CR-002: no plan bills a monthly price any more, so the legacy Pro/Business
 * Stripe subscriptions are cancelled at period end (no refund, founder decision
 * M-65) and the partner STAYS on its current plan (Temporada after the data
 * move). Only the Stripe linkage is cleared — never a downgrade to Gratis.
 */
export async function handleSubscriptionCanceled(partnerAccountId: string) {
  const existing = await prisma.subscription.findUnique({
    where: { partnerAccountId },
    select: { id: true },
  })
  if (!existing) {
    console.error(`[Subscription] No subscription for ${partnerAccountId} on cancel`)
    return
  }

  await prisma.subscription.update({
    where: { partnerAccountId },
    data: {
      status: 'ACTIVE',
      stripeSubscriptionId: null,
      stripeCustomerId: null,
      currentPeriodStart: null,
      currentPeriodEnd: null,
    },
  })

  console.log(`[Subscription] Stripe subscription ended for ${partnerAccountId}; plan kept`)
}
