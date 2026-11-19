import { PRICING_TIERS, PRICING_TIER_ORDER, type PricingTierSpec } from '@repo/data/pricing-tiers'

type T = (key: string, values?: Record<string, string | number>) => string
type Tier = keyof typeof PRICING_TIERS

export type PlanCard = {
  /** Big line at the top of the card: a sentence on Free, the rate on Pro, "Custom" on Business. */
  headline: string
  /** Whether the headline is a figure (set large) or words. */
  headlineIsFigure: boolean
  headlineNote: string
  /** The commission's monthly ceiling, set right beside the rate ("max. €199 / site / month"); null without one. */
  headlineCap: string | null
  /** "Everything in <lower plan>, plus:" — null on the first plan. */
  inherits: string | null
  /** What this plan adds over the one below it (the whole list on the first plan). */
  features: string[]
  /** The money terms behind the headline. Empty on Free (nothing to pay) and Business (agreed per partner). */
  terms: string[]
}

/** The limits line(s) for a plan: sites and sunbeds, or unlimited. */
function limitLines(spec: PricingTierSpec, t: T): string[] {
  if (spec.maxSites === null || spec.maxHamacasPerSite === null) return [t('unlimited')]
  return [t('sites', { count: spec.maxSites }), t('hamacas', { count: spec.maxHamacasPerSite })]
}

/**
 * Plan card content (landing page + in-app subscription view), built so the cards
 * compare at a glance: the first plan lists everything it includes, each later one
 * lists only what it adds over the plan below. `t` is
 * `useTranslations('Landing.plans')`. Every number comes from PRICING_TIERS.
 */
export function planCard(tier: Tier, t: T): PlanCard {
  const spec: PricingTierSpec = PRICING_TIERS[tier]
  const idx = PRICING_TIER_ORDER.indexOf(tier)
  const lowerTier = idx > 0 ? PRICING_TIER_ORDER[idx - 1] : undefined
  const lower = lowerTier ? PRICING_TIERS[lowerTier] : null

  const features = [...limitLines(spec, t)]
  if (!lower) {
    features.push(t('sunbedMap'), t('qrBooking'), t('staffLink'), t('rentals'))
    if (!spec.onlinePayments) features.push(t('payOnSite'))
  }
  if (spec.onlinePayments && !lower?.onlinePayments) features.push(t('onlinePayments'), t('foodAndDrinkOrdering'))
  if (spec.brandedBookingPage && !lower?.brandedBookingPage) features.push(t('brandedPage'))

  const pct = spec.commissionPercent['sunbed-rental']
  const isFree = !spec.quoteOnly && spec.monthlyPrice === 0 && pct === 0
  const terms: string[] = []
  if (!spec.quoteOnly && !isFree) {
    terms.push(t('noMonthlyFee'))
    terms.push(t('foodAndDrink', { pct: spec.commissionPercent['food-and-beverage'] }))
    terms.push(t('processing'))
  }

  return {
    headline: spec.quoteOnly ? t('quoteHeadline') : isFree ? t('freeHeadline') : `${pct}%`,
    headlineIsFigure: !spec.quoteOnly && !isFree,
    headlineNote: spec.quoteOnly ? t('quoteNote') : isFree ? t('freeNote') : t('commissionLabel'),
    headlineCap:
      !spec.quoteOnly && !isFree && spec.monthlyCommissionCapPerSite !== null
        ? t('headlineCap', { cap: spec.monthlyCommissionCapPerSite })
        : null,
    inherits: lower ? t('everythingIn', { plan: lower.name }) : null,
    features,
    terms,
  }
}
