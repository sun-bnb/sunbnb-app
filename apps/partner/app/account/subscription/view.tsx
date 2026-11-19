'use client'

import { useState } from 'react'
import { SubscriptionPlan, Subscription } from '@prisma/client'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { PRICING_TIERS, FEATURED_TIER } from '@repo/data/pricing-tiers'
import { planCardLines } from '@/lib/plan-card-lines'

interface SubscriptionWithPlan extends Subscription {
  plan: SubscriptionPlan
}

interface SubscriptionData {
  subscription: SubscriptionWithPlan | null
  plans: SubscriptionPlan[]
  siteCount: number
  effectiveMaxSites: number
  isCustomMaxSites: boolean
}

const DEFAULT_COLORS = {
  ring: 'ring-gray-200',
  badge: 'bg-gray-100 text-gray-700',
}

const TIER_COLORS: Record<string, typeof DEFAULT_COLORS> = {
  GRATIS: DEFAULT_COLORS,
  TEMPORADA: { ring: 'ring-blue-500 ring-2', badge: 'bg-blue-100 text-blue-700' },
  GRUPO: { ring: 'ring-amber-500 ring-2', badge: 'bg-amber-100 text-amber-700' },
}

export default function SubscriptionView({ data }: { data: SubscriptionData }) {
  const { subscription, plans, siteCount, effectiveMaxSites, isCustomMaxSites } = data
  const t = useTranslations('Subscription')
  const tp = useTranslations('Landing.plans')
  const currentTier = subscription?.plan?.tier ?? 'GRATIS'
  const [loading, setLoading] = useState<string | null>(null)

  const hasStripeSubscription = !!subscription?.stripeSubscriptionId

  async function handleManageBilling() {
    setLoading('portal')
    try {
      const res = await fetch('/api/subscription/portal', {
        method: 'POST',
      })
      const data = await res.json()
      if (data.url) {
        window.location.href = data.url
      }
    } catch (e) {
      console.error('Portal error:', e)
    } finally {
      setLoading(null)
    }
  }

  return (
    <div className="page-container py-6">

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-lg font-semibold text-gray-900">{t('title')}</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          {t('subtitle')}
        </p>
      </div>

      {/* Current plan summary */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{t('currentPlan')}</p>
            <p className="text-xl font-bold text-gray-900 mt-1">{subscription?.plan?.name ?? PRICING_TIERS.GRATIS.name}</p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{t('sitesUsed')}</p>
            <p className="text-xl font-bold text-gray-900 mt-1">
              {siteCount} / {effectiveMaxSites >= 999 ? '∞' : effectiveMaxSites}
              {isCustomMaxSites && (
                <span className="ml-1.5 text-xs font-normal text-indigo-500">{t('custom')}</span>
              )}
            </p>
          </div>
        </div>
        {subscription?.status === 'PAST_DUE' && (
          <div className="mt-4 bg-red-50 border border-red-200 rounded-lg p-3 flex items-center gap-2">
            <svg className="w-4 h-4 text-red-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
            </svg>
            <p className="text-sm text-red-700">{t('pastDue')}</p>
          </div>
        )}
      </div>

      {/* Plan cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 lg:gap-6">
        {plans.map((plan) => {
          const isCurrent = plan.tier === currentTier
          const colors = TIER_COLORS[plan.tier] ?? DEFAULT_COLORS
          const spec = PRICING_TIERS[plan.tier]
          const features = planCardLines(plan.tier, tp)
          return (
            <div
              key={plan.id}
              className={`relative bg-white rounded-xl border p-5 flex flex-col ring-1 ${isCurrent ? colors.ring : 'ring-gray-200'}`}
            >
              {/* Badge */}
              <div className="flex items-center justify-between mb-3">
                <span className={`text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${colors.badge}`}>
                  {plan.tier === FEATURED_TIER ? tp('mostChosen') : spec.quoteOnly ? t('badgeGrupo') : t('badgeGratis')}
                </span>
                {isCurrent && (
                  <span className="text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-green-100 text-green-700">
                    {t('current')}
                  </span>
                )}
              </div>

              {/* Plan name & price */}
              <h3 className="text-base font-bold text-gray-900">{spec.name}</h3>
              <div className="mt-2 mb-4">
                <span className="text-2xl font-bold text-gray-900">
                  {spec.quoteOnly ? tp('quoteHeadline') : `${spec.commissionPercent['sunbed-rental']}%`}
                </span>
                <span className="block text-xs text-gray-500 mt-0.5">
                  {spec.quoteOnly ? tp('quoteNote') : tp('commissionLabel')}
                </span>
                {!spec.quoteOnly && <span className="block text-xs font-medium text-gray-700 mt-1">{tp('noMonthlyFee')}</span>}
              </div>

              {/* Features */}
              <ul className="space-y-2 mb-6 flex-1">
                {features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2 text-sm text-gray-600">
                    <svg className="w-4 h-4 text-green-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                    </svg>
                    {feature}
                  </li>
                ))}
              </ul>

              {/* CTA: no checkout on any plan (nothing bills monthly). Grupo is a quote request. */}
              {isCurrent ? (
                <div className="text-center py-2 text-sm font-medium text-gray-400 bg-gray-50 rounded-lg">
                  {t('currentButton')}
                </div>
              ) : spec.quoteOnly ? (
                <a
                  href={`mailto:partners@sunbnb.app?subject=${encodeURIComponent(tp('quoteSubject'))}`}
                  className="block w-full py-2.5 sm:py-2 text-center text-sm font-medium rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  {tp('quote')}
                </a>
              ) : spec.onlinePayments ? (
                <Link
                  href="/account/payments"
                  className="block w-full py-2.5 sm:py-2 text-center text-sm font-medium rounded-lg bg-accent text-white hover:bg-accent-hover transition-colors"
                >
                  {t('enableOnline')}
                </Link>
              ) : (
                <div className="text-center py-2 text-sm font-medium text-gray-400 bg-gray-50 rounded-lg">
                  {t('freePlan')}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Manage billing / info */}
      {hasStripeSubscription ? (
        <div className="mt-6 flex justify-end">
          <button
            onClick={handleManageBilling}
            disabled={loading !== null}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 sm:py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-40 transition-colors"
          >
            {loading === 'portal' ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-gray-400/30 border-t-gray-600 rounded-full animate-spin" />
                {t('opening')}
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 0 0 2.25-2.25V6.75A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25v10.5A2.25 2.25 0 0 0 4.5 19.5Z" />
                </svg>
                {t('manageBilling')}
              </>
            )}
          </button>
        </div>
      ) : (
        <div className="mt-6 bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-start gap-3">
          <svg className="w-5 h-5 text-blue-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="m11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z" />
          </svg>
          <div>
            <p className="text-sm font-medium text-blue-800">{t('infoTitle')}</p>
            <p className="text-sm text-blue-600 mt-0.5">{t('infoBody')}</p>
          </div>
        </div>
      )}
    </div>
  )
}
