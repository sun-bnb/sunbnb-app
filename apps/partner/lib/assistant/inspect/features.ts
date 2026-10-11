/**
 * `features` aspect: the account's plan, what that plan allows (entitlements: what is locked, why and
 * which plan unlocks it), the feature flags resolved for this account, and the site's own
 * `features[]` / layout mode. Account and site come from the route-bound ctx. Read-only; no Stripe
 * ids, customer ids or admin notes are selected.
 */
import prisma from '@repo/data/PrismaCient'
import { FLAG_REGISTRY, getFlagStates } from '@repo/data/flags'
import { PRICING_TIERS, PRICING_TIER_ORDER } from '@repo/data/pricing-tiers'
import { getEffectiveSubscriptionForUser, SUBSCRIPTION_FEATURES, TIER_FEATURE_DEFAULTS } from '@repo/data/subscription'
import type { InspectProvider } from './types'

const SITE_FEATURE_MEANING: Record<string, string> = {
  sunbeds: 'sunbed reservations (the core product)',
  rentals: 'equipment rentals (surfboards, kayaks...) with the Rentals tab',
}

const firstSentence = (s: string) => (/^.*?[.!?](?=\s|$)/.exec(s)?.[0] ?? s).slice(0, 160)

export const featuresProvider: InspectProvider = {
  name: 'features',
  summary: 'The account plan and subscription, entitlements (what is locked, why, which plan unlocks it), feature flags for this account, and the site features[] / layout mode.',
  examples: ['Which plan am I on and what does it include?', 'Why can I not switch the site to off-platform billing?', 'Is the devices feature enabled for me?', 'Is rentals enabled on this site?'],
  async describe(ctx) {
    const [effective, sub, siteCount, flags, site] = await Promise.all([
      getEffectiveSubscriptionForUser(ctx.accountId),
      prisma.subscription.findUnique({ where: { partnerAccountId: ctx.accountId }, select: { status: true, currentPeriodEnd: true } }),
      prisma.site.count({ where: { userId: ctx.accountId } }),
      getFlagStates({ accountId: ctx.accountId }),
      prisma.site.findUnique({
        where: { id: ctx.siteId },
        select: { features: true, layoutMode: true, type: true, status: true, appSalesEnabled: true, orderPaymentType: true, rentalPaymentType: true, partialGroupBookingEnabled: true },
      }),
    ])

    const tierInfo = PRICING_TIERS[effective.tier]
    const entitlements = (Object.keys(SUBSCRIPTION_FEATURES) as (keyof typeof SUBSCRIPTION_FEATURES)[]).map((key) => {
      const def = SUBSCRIPTION_FEATURES[key]
      const enabled = Boolean(effective.features[key])
      const unlockedBy = PRICING_TIER_ORDER.filter((t) => TIER_FEATURE_DEFAULTS[t]?.[key]).map((t) => PRICING_TIERS[t].name)
      return {
        key,
        label: def.label,
        allows: def.description,
        enabled,
        ...(enabled ? {} : { whyLocked: `the ${effective.name} plan does not include it`, unlockedBy: [...unlockedBy, 'or an admin override'] }),
      }
    })

    return {
      ok: true,
      plan: {
        tier: effective.tier,
        name: effective.name,
        monthlyPriceEur: effective.monthlyPrice,
        commissionPercent: tierInfo?.commissionPercent ?? null,
        maxSites: effective.maxSites,
        sitesUsed: siteCount,
        canAddSite: siteCount < effective.maxSites,
        customDeal: effective.isCustom,
        subscriptionStatus: sub?.status ?? null,
        currentPeriodEnd: sub?.currentPeriodEnd ? sub.currentPeriodEnd.toISOString().slice(0, 10) : null,
      },
      ladder: PRICING_TIER_ORDER.map((t) => ({ tier: t, name: PRICING_TIERS[t].name, monthlyPriceEur: PRICING_TIERS[t].monthlyPrice, maxSites: PRICING_TIERS[t].maxSites, commissionPercent: PRICING_TIERS[t].commissionPercent })),
      entitlements,
      flags: Object.values(FLAG_REGISTRY).map((def) => {
        const st = flags[def.name as keyof typeof flags]
        return { name: def.name, enabled: st?.enabled ?? false, source: st?.source ?? 'default', about: firstSentence(def.description) }
      }),
      site: site
        ? {
            features: (site.features ?? []).map((f) => ({ feature: f, meaning: SITE_FEATURE_MEANING[f] ?? null })),
            layoutMode: site.layoutMode,
            billing: site.type === 'unpaid' ? 'off-platform (availability only)' : 'integrated payments',
            status: site.status,
            appOrders: site.appSalesEnabled ?? false,
            orderPayment: site.orderPaymentType ?? null,
            rentalPayment: site.rentalPaymentType ?? null,
            partialGroupBooking: site.partialGroupBookingEnabled ?? false,
          }
        : null,
      howToChange: 'Plan changes: Account > Subscription. Site features and layout mode: the site General tab. Flags are set by Sunbnb staff.',
    }
  },
}
