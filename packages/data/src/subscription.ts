/**
 * Subscription Service
 *
 * Provides helpers to query a partner's subscription and enforce plan limits
 * (sites per account, hamacas per site) and plan features (Starter / Pro /
 * Business), and changes a partner's plan (`setPartnerPlan`, Stripe webhooks).
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
 * Per-tier default entitlements, read from the catalogue (PRICING_TIERS).
 * Source of truth for server-side enforcement; a CustomSubscription's
 * `featureOverrides` wins per partner.
 */
export const TIER_FEATURE_DEFAULTS: Record<SubscriptionTier, Record<SubscriptionFeatureKey, boolean>> =
  Object.fromEntries(
    (Object.keys(PRICING_TIERS) as SubscriptionTier[]).map((tier) => [
      tier,
      {
        OFF_PLATFORM_BILLING: PRICING_TIERS[tier].offPlatformBilling,
        ONLINE_PAYMENTS: PRICING_TIERS[tier].onlinePayments,
        FOOD_AND_BEVERAGE: PRICING_TIERS[tier].foodAndBeverage,
      },
    ]),
  ) as Record<SubscriptionTier, Record<SubscriptionFeatureKey, boolean>>

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
  // `undefined` (column not selected) falls back to the catalogue. A NULL
  // hamaca limit on a seeded row means "no limit".
  const planHamacas = plan
    ? plan.maxHamacasPerSite !== undefined ? plan.maxHamacasPerSite : PRICING_TIERS[plan.tier].maxHamacasPerSite
    : fallback.maxHamacasPerSite
  return {
    tier,
    // The catalogue name, not the row's, so a stale row name never shows.
    name:              PRICING_TIERS[tier].name,
    monthlyPrice:      plan?.monthlyPrice ?? 0,
    // A plan without a catalogue limit is unlimited until an agreement sets one;
    // the stored row value is not consulted for it.
    maxSites:
      custom?.maxSites ??
      (PRICING_TIERS[tier].maxSites === null ? UNLIMITED_SITES : (plan?.maxSites ?? fallback.maxSites ?? 1)),
    /** null = no limit. A custom agreement wins over the plan. */
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
      /**
       * not_self_serve: an admin-only plan picked by a partner · custom_agreement: a partner on an admin-only
       * plan tried to leave by itself · needs_checkout: a paid plan, bought through Stripe Checkout ·
       * manage_billing: the partner pays for its plan, so it changes or cancels it in the Stripe billing
       * portal · over_limits: downgrade refused
       */
      code: 'no_account' | 'no_plan_row' | 'not_self_serve' | 'custom_agreement' | 'needs_checkout' | 'manage_billing' | 'over_limits'
      errors: string[]
      issues?: PlanFitIssues
    }

/**
 * THE writer of a partner's plan (Subscription.planId), for the partner's
 * subscription page and for admin.
 *
 * - A partner moves itself here only onto a FREE self-serve plan (Starter), and only
 *   while it has no paid Stripe subscription. A paid plan is bought through Stripe
 *   Checkout (`syncStripeSubscription` sets it from the webhook); a paying partner
 *   changes or cancels through the Stripe billing portal (cancel → back to Starter
 *   in `handleSubscriptionCanceled`).
 * - Plans with `selfServe: false` (none today) are custom agreements set up by us:
 *   a partner can neither pick nor leave one, and leaving one drops its agreement —
 *   the CustomSubscription row and the partner-level ServiceFee rows.
 * - A partner's move to a plan whose limits it already exceeds is refused, with
 *   the sites and sunbeds that are over. Admin may move anyone anywhere without
 *   billing (a complimentary plan): existing sites and sunbeds are kept, the
 *   limits only stop adding more.
 */
export async function setPartnerPlan(
  partnerAccountId: string,
  tier: SubscriptionTier,
  actor: PlanChangeActor,
): Promise<PlanChangeResult> {
  const account = await prisma.partnerAccount.findUnique({
    where: { userId: partnerAccountId },
    select: {
      userId: true,
      subscription: { select: { stripeSubscriptionId: true, plan: { select: { tier: true } } } },
    },
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
    if (tier !== currentTier && PRICING_TIERS[tier].monthlyPrice > 0) {
      return { status: 'error', code: 'needs_checkout', errors: [`${PRICING_TIERS[tier].name} is a paid plan. Subscribe through checkout.`] }
    }
    if (tier !== currentTier && account.subscription?.stripeSubscriptionId) {
      return { status: 'error', code: 'manage_billing', errors: ['You pay for your plan. Change or cancel it in billing.'] }
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
 * Handle subscription cancellation from Stripe: the partner goes back to the
 * default free plan (Starter) and the Stripe linkage is cleared.
 */
export async function handleSubscriptionCanceled(partnerAccountId: string) {
  const defaultPlan = await prisma.subscriptionPlan.findUnique({ where: { tier: DEFAULT_TIER } })
  if (!defaultPlan) {
    console.error(`[Subscription] ${DEFAULT_TIER} plan not found for downgrade`)
    return
  }

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
      planId: defaultPlan.id,
      status: 'ACTIVE',
      stripeSubscriptionId: null,
      stripeCustomerId: null,
      currentPeriodStart: null,
      currentPeriodEnd: null,
    },
  })

  console.log(`[Subscription] Canceled & downgraded ${partnerAccountId} → ${DEFAULT_TIER}`)
}
