/**
 * Subscription Service
 *
 * Provides helpers to query a partner's subscription and enforce plan limits
 * (sites per account, hamacas per site) and plan features (CR-002: Free / Pro /
 * Business, code keys GRATIS / TEMPORADA / GRUPO), and changes a partner's plan
 * (`setPartnerPlan`).
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
  UNLIMITED_SITES,
  COMMISSIONED_SERVICE_CODES,
  CAPPED_SERVICE_CODES,
  planRowMaxSites,
} from './pricing-tiers'
export type { PricingTierSpec, CommissionedServiceCode } from './pricing-tiers'
import { DEFAULT_TIER, PRICING_TIERS, UNLIMITED_SITES } from './pricing-tiers'

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
    // The catalogue name, not the row's: plans were renamed Free / Pro / Business
    // after the rows were seeded as Gratis / Temporada / Grupo.
    name:              PRICING_TIERS[tier].name,
    monthlyPrice:      plan?.monthlyPrice ?? 0,
    // A plan without a catalogue limit (Business) is unlimited until its agreement
    // sets one; the stored row value is not consulted for it.
    maxSites:
      custom?.maxSites ??
      (PRICING_TIERS[tier].maxSites === null ? UNLIMITED_SITES : (plan?.maxSites ?? fallback.maxSites ?? 1)),
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

// ─── Plan changes ───────────────────────────────────────────────────────────

/** Who is changing a partner's plan. A partner may only move between self-serve plans. */
export type PlanChangeActor = 'partner' | 'admin'

/** Where a partner is over a plan's limits: too many sites, or too many sunbeds on a site. */
export type PlanFitIssues = {
  sites: { current: number; limit: number } | null
  hamacas: { siteId: string; siteName: string; current: number; limit: number }[]
}

/**
 * Pure: does a partner with these sites fit `tier`'s catalogue limits?
 * Returns null when it fits. Used to refuse a self-serve downgrade that would
 * leave the partner over the lower plan's limits.
 */
export function planFitIssues(
  tier: SubscriptionTier,
  sites: { id: string; name: string; hamacas: number }[],
): PlanFitIssues | null {
  const spec = PRICING_TIERS[tier]
  const siteIssue =
    spec.maxSites !== null && sites.length > spec.maxSites ? { current: sites.length, limit: spec.maxSites } : null
  const limit = spec.maxHamacasPerSite
  const hamacas =
    limit === null
      ? []
      : sites.filter((s) => s.hamacas > limit).map((s) => ({ siteId: s.id, siteName: s.name, current: s.hamacas, limit }))
  return siteIssue || hamacas.length ? { sites: siteIssue, hamacas } : null
}

export type PlanChangeResult =
  | { status: 'ok'; tier: SubscriptionTier; changed: boolean }
  | {
      status: 'error'
      /** not_self_serve: Business picked by a partner · custom_agreement: a Business partner tried to leave by itself · over_limits: downgrade refused */
      code: 'no_account' | 'no_plan_row' | 'not_self_serve' | 'custom_agreement' | 'over_limits'
      errors: string[]
      issues?: PlanFitIssues
    }

/**
 * THE writer of a partner's plan (Subscription.planId), for the partner's
 * subscription page and for admin.
 *
 * - A partner may move only between self-serve plans (Free ⇄ Pro). Business is a
 *   custom agreement set up by us, so a partner can neither pick it nor leave it.
 * - A partner's move to a plan whose limits it already exceeds is refused, with
 *   the sites and sunbeds that are over (founder decision 2026-11-19: block for now).
 *   Admin may move anyone anywhere: existing sites and sunbeds are kept, the
 *   limits only stop adding more.
 * - Leaving Business drops its agreement: the CustomSubscription row (limits,
 *   feature overrides) and the partner-level ServiceFee rows (negotiated rates),
 *   so the partner falls back to the plain catalogue terms of its new plan.
 *
 * No billing: no plan has a monthly price, and Business billing is out of scope.
 */
export async function setPartnerPlan(
  partnerAccountId: string,
  tier: SubscriptionTier,
  actor: PlanChangeActor,
): Promise<PlanChangeResult> {
  const account = await prisma.partnerAccount.findUnique({
    where: { userId: partnerAccountId },
    select: { userId: true, subscription: { select: { plan: { select: { tier: true } } } } },
  })
  if (!account) return { status: 'error', code: 'no_account', errors: ['Partner account not found'] }
  const currentTier = account.subscription?.plan.tier ?? DEFAULT_TIER

  if (actor === 'partner') {
    if (!PRICING_TIERS[tier].selfServe) {
      return { status: 'error', code: 'not_self_serve', errors: [`${PRICING_TIERS[tier].name} is set up with us. Contact us to discuss it.`] }
    }
    if (!PRICING_TIERS[currentTier].selfServe) {
      return { status: 'error', code: 'custom_agreement', errors: [`Your ${PRICING_TIERS[currentTier].name} plan is set up with us. Contact us to change it.`] }
    }
    if (tier !== currentTier) {
      const sites = await prisma.site.findMany({
        where: { userId: partnerAccountId },
        select: { id: true, name: true, _count: { select: { inventoryItems: true } } },
      })
      const issues = planFitIssues(
        tier,
        sites.map((s) => ({ id: s.id, name: s.name, hamacas: s._count.inventoryItems })),
      )
      if (issues) {
        return { status: 'error', code: 'over_limits', errors: [`Your venues are over the ${PRICING_TIERS[tier].name} plan limits.`], issues }
      }
    }
  }

  if (tier === currentTier && account.subscription) return { status: 'ok', tier, changed: false }

  const plan = await prisma.subscriptionPlan.findUnique({ where: { tier }, select: { id: true } })
  if (!plan) return { status: 'error', code: 'no_plan_row', errors: [`No ${PRICING_TIERS[tier].name} plan row`] }

  const leavingAgreement = tier !== currentTier && !PRICING_TIERS[currentTier].selfServe
  await prisma.$transaction(async (tx) => {
    await tx.subscription.upsert({
      where: { partnerAccountId },
      update: { planId: plan.id, status: 'ACTIVE' },
      create: { partnerAccountId, planId: plan.id, status: 'ACTIVE' },
    })
    if (leavingAgreement) {
      await tx.customSubscription.deleteMany({ where: { partnerAccountId } })
      await tx.serviceFee.deleteMany({ where: { accountId: partnerAccountId } })
    }
  })
  return { status: 'ok', tier, changed: tier !== currentTier }
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
