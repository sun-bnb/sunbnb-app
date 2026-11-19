'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { PRICING_TIERS, DEFAULT_TIER } from '@repo/data/pricing-tiers'

/**
 * Plan-aware fee notes shown under the price breakdown (site wizard + General tab).
 * Numbers come from PRICING_TIERS; the copy is translated. Card processing is its
 * own line at provider cost, never part of the Sunbnb commission, and guests never
 * pay a fee. UI only: the server enforces what each plan may do.
 */
export default function PlanFeeNotes({ tier }: { tier: string }) {
  const t = useTranslations('PlanFees')
  const spec = PRICING_TIERS[tier as keyof typeof PRICING_TIERS] ?? PRICING_TIERS[DEFAULT_TIER]
  const pct = spec.commissionPercent['sunbed-rental']
  const cap = spec.monthlyCommissionCapPerSite

  const commission = spec.quoteOnly
    ? t('commissionAgreed')
    : cap !== null && pct > 0
      ? t('commissionCapped', { pct, cap })
      : t('commission', { pct })

  return (
    <div className="mt-2 rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-xs text-gray-600 space-y-1" role="note">
      <p>{commission}</p>
      <p>{t('foodAndDrink', { pct: spec.commissionPercent['food-and-beverage'] })}</p>
      <p>{t('processing')}</p>
      <p>{t('noGuestFee')}</p>
      {!spec.onlinePayments && (
        <p className="pt-1 text-amber-700 font-medium">
          {t('gratisUpgrade', { plan: PRICING_TIERS.TEMPORADA.name })}{' '}
          <Link href="/account/subscription" className="underline underline-offset-2">
            {t('seePlans')}
          </Link>
        </p>
      )}
    </div>
  )
}
