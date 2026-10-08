'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import type { SelectableProvider } from '@repo/data/payment-refs'
import type { ProviderAvailability } from '@repo/data/payment-providers/availability'
import type { ProviderReadiness, ReadinessStatus } from '@repo/data/payment-providers/readiness'
import { selectPaymentProvider } from './actions'

export interface ProviderCardData {
  provider: SelectableProvider
  readiness: ProviderReadiness
  availability: ProviderAvailability
}

const NAMES: Record<SelectableProvider, string> = { mollie: 'Mollie', viva: 'Viva', stripe: 'Stripe' }

const STATUS_STYLE: Record<ReadinessStatus, string> = {
  ready: 'bg-green-50 text-green-700',
  in_progress: 'bg-amber-50 text-amber-700',
  in_review: 'bg-amber-50 text-amber-700',
  needs_data: 'bg-amber-50 text-amber-700',
  restricted: 'bg-red-50 text-red-700',
  not_connected: 'bg-gray-100 text-gray-600',
}

const STATUS_KEY: Record<ReadinessStatus, string> = {
  ready: 'statusReady',
  in_progress: 'statusInProgress',
  in_review: 'statusInReview',
  needs_data: 'statusNeedsData',
  restricted: 'statusRestricted',
  not_connected: 'statusNotConnected',
}

export default function PaymentsView({
  providers,
  selected: initialSelected,
  effective,
  country,
}: {
  providers: ProviderCardData[]
  selected: SelectableProvider
  effective: SelectableProvider | null
  country: string | null
}) {
  const t = useTranslations('Payments')
  const [selected, setSelected] = useState(initialSelected)
  const [eff, setEff] = useState(effective)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const readinessOf = (p: SelectableProvider) => providers.find((c) => c.provider === p)?.readiness
  const effectiveReady = eff ? !!readinessOf(eff)?.ready : false
  const selectedReady = !!readinessOf(selected)?.ready

  function select(p: SelectableProvider) {
    setError(null)
    startTransition(async () => {
      const res = await selectPaymentProvider(p)
      if (res.status === 'ok') {
        setSelected(res.selected)
        setEff(res.effective)
      } else {
        setError(res.errors.join(', '))
      }
    })
  }

  const connectLabel = (r: ProviderReadiness) => {
    switch (r.nextStep) {
      case 'connect': return t('connect')
      case 'complete_onboarding':
      case 'fix_requirements': return t('continueSetup')
      case 'wait_review': return t('viewStatus')
      default: return t('manage')
    }
  }

  const cardPresentLabel = (a: ProviderAvailability) =>
    a.cardPresent === 'terminal-app' ? t('cardTerminalApp')
      : a.cardPresent === 'tap-to-pay' ? t('cardTapToPay')
      : t('cardNone')

  return (
    <div className="container mx-auto px-4 py-6 max-w-5xl">
      <div className="mb-6">
        <h1 className="text-lg font-semibold text-gray-900">{t('title')}</h1>
        <p className="text-sm text-gray-500 mt-0.5">{t('subtitle')}</p>
      </div>

      {!country && (
        <div role="status" className="mb-4 bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
          {t('countryMissing')}{' '}
          <Link href="/account" className="font-medium underline">{t('setCountry')}</Link>
        </div>
      )}

      {eff && selected !== eff && (
        <div role="status" className="mb-4 bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
          {t('switchPending', { selected: NAMES[selected], effective: NAMES[eff] })}
        </div>
      )}
      {!selectedReady && !effectiveReady && (
        <div role="status" className="mb-4 bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
          {t('finishSetup', { selected: NAMES[selected] })}
        </div>
      )}
      {error && (
        <div role="status" className="mb-4 bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        {providers.map(({ provider, readiness, availability }) => {
          const isSelected = provider === selected
          const isEffective = provider === eff
          const note = availability.note && availability.note !== 'country-unknown' && availability.note !== 'not-available'
            ? availability.note
            : null
          return (
            <div key={provider} className={`card flex flex-col ${isSelected ? 'ring-2 ring-accent' : ''}`}>
              <div className="flex items-start justify-between gap-2 mb-3">
                <h2 className="text-sm font-semibold text-gray-900">{NAMES[provider]}</h2>
                <span className={`badge ${STATUS_STYLE[readiness.status]}`}>{t(STATUS_KEY[readiness.status] as any)}</span>
              </div>

              <div className="flex flex-wrap gap-1.5 mb-3">
                {isSelected && <span className="badge bg-blue-50 text-blue-700">{t('selected')}</span>}
                {isEffective && <span className="badge bg-green-50 text-green-700">{t('guestsPayWithThis')}</span>}
              </div>

              <dl className="text-sm text-gray-700 space-y-2 mb-4 flex-1">
                <div className="flex justify-between gap-2">
                  <dt className="text-gray-500">{t('onlineCheckout')}</dt>
                  <dd className={availability.online ? 'text-green-700' : 'text-red-600'}>
                    {availability.online ? '✓' : '✗'}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-gray-500">{t('cardAtLounger')}</dt>
                  <dd className="text-right">{cardPresentLabel(availability)}</dd>
                </div>
                {note && <p className="text-xs text-gray-500">{note}</p>}
              </dl>

              {!availability.online && !isSelected && (
                <p className="text-xs text-gray-500 mb-2">{t('notAvailableInCountry')}</p>
              )}

              <div className="flex gap-2">
                {!isSelected && (
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={!availability.online || pending}
                    onClick={() => select(provider)}
                  >
                    {t('select')}
                  </button>
                )}
                <Link href={readiness.connectPath} className="btn-ghost">
                  {connectLabel(readiness)}
                </Link>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
