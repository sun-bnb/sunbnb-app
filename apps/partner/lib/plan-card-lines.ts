import { PRICING_TIERS, type PricingTierSpec } from '@repo/data/pricing-tiers'

type T = (key: string, values?: Record<string, string | number>) => string

/**
 * Feature lines for a plan card (landing page + in-app subscription view).
 * `t` is `useTranslations('Landing.plans')`. Every number comes from PRICING_TIERS.
 */
export function planCardLines(tier: keyof typeof PRICING_TIERS, t: T): string[] {
  const spec: PricingTierSpec = PRICING_TIERS[tier]
  const lines: string[] = []
  if (spec.maxSites === null || spec.maxHamacasPerSite === null) {
    lines.push(t('perAgreement'))
  } else {
    lines.push(t('sites', { count: spec.maxSites }))
    lines.push(t('hamacas', { count: spec.maxHamacasPerSite }))
  }
  if (spec.onlinePayments) {
    lines.push(t('onlinePayments'))
    const cap = spec.monthlyCommissionCapPerSite
    if (cap !== null) lines.push(t('cap', { cap }))
    lines.push(t('foodAndDrink', { pct: spec.commissionPercent['food-and-beverage'] }))
    lines.push(t('processing'))
  } else {
    lines.push(t('payOnSite'))
  }
  lines.push(t('includedAll'))
  return lines
}
