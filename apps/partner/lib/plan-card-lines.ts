import { PRICING_TIERS, PRICING_TIER_ORDER, type PricingTierSpec } from '@repo/data/pricing-tiers'

type T = (key: string, values?: Record<string, string | number>) => string
type Tier = keyof typeof PRICING_TIERS

export type PlanCard = {
  /** The headline term: the commission ("6%"), or "Custom" on a quote-only plan. */
  headline: string
  /** Under the headline: what the commission is taken on, or how a quote-only plan is priced. */
  headlineNote: string
  /** The monthly price ("Free" / "€29"); null on a quote-only plan. */
  price: string | null
  /** Beside the price ("no monthly fee" / "/ month"). */
  priceNote: string | null
  /** The card's lines: limits, then what the plan adds over the one below, then support. */
  features: string[]
}

const SUPPORT_KEY = {
  community: 'supportCommunity',
  priority: 'supportPriority',
  dedicated: 'supportDedicated',
} as const

/** The sites line: one venue, up to N venues, or unlimited. */
function sitesLine(spec: PricingTierSpec, t: T): string {
  if (spec.maxSites === null) return t('unlimited')
  return spec.maxSites === 1 ? t('oneVenue') : t('upToVenues', { count: spec.maxSites })
}

/**
 * Plan card content (landing page + in-app subscription view). The first plan
 * lists what it includes; each later one says "Everything in <lower plan>" and
 * lists what it adds. `t` is `useTranslations('Landing.plans')`. Every number
 * comes from PRICING_TIERS, so a card can never promise a limit or a rate the
 * app doesn't apply.
 */
export function planCard(tier: Tier, t: T): PlanCard {
  const spec: PricingTierSpec = PRICING_TIERS[tier]
  const idx = PRICING_TIER_ORDER.indexOf(tier)
  const lowerTier = idx > 0 ? PRICING_TIER_ORDER[idx - 1] : undefined
  const lower = lowerTier ? PRICING_TIERS[lowerTier] : null

  const features = [sitesLine(spec, t)]
  if (spec.maxHamacasPerSite !== null) features.push(t('hamacas', { count: spec.maxHamacasPerSite }))
  if (!lower) {
    features.push(t('starterAll'))
  } else {
    features.push(t('everythingIn', { plan: lower.name }))
    if (spec.offPlatformBilling && !lower.offPlatformBilling) features.push(t('offPlatform'))
    if (spec.brandedBookingPage && !lower.brandedBookingPage) features.push(t('branded'))
  }
  features.push(t(SUPPORT_KEY[spec.support]))

  if (spec.quoteOnly) {
    return { headline: t('quoteHeadline'), headlineNote: t('quoteNote'), price: null, priceNote: null, features }
  }
  const free = spec.monthlyPrice === 0
  return {
    headline: `${spec.commissionPercent['sunbed-rental']}%`,
    headlineNote: t('commissionLabel'),
    price: free ? t('free') : `€${spec.monthlyPrice}`,
    priceNote: free ? t('freeNote') : t('perMonth'),
    features,
  }
}
