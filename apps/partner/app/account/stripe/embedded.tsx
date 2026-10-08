'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { loadConnectAndInitialize } from '@stripe/connect-js'
import {
  ConnectAccountManagement,
  ConnectBalances,
  ConnectComponentsProvider,
  ConnectNotificationBanner,
  ConnectPayments,
  ConnectPayouts,
} from '@stripe/react-connect-js'

type Tab = 'account' | 'payouts' | 'payments' | 'balance'
const TABS: { id: Tab; labelKey: string }[] = [
  { id: 'account', labelKey: 'tabAccount' },
  { id: 'payouts', labelKey: 'tabPayouts' },
  { id: 'payments', labelKey: 'tabPayments' },
  { id: 'balance', labelKey: 'tabBalance' },
]

export default function EmbeddedManagement() {
  const t = useTranslations('StripeConnect')
  // The Connect platform is a different Stripe account from the subscriptions one, so its
  // publishable key differs; fall back to the shared key for single-account setups.
  const publishableKey =
    process.env.NEXT_PUBLIC_STRIPE_CONNECT_PUBLIC_KEY ?? process.env.NEXT_PUBLIC_STRIPE_PUBLIC_KEY
  const [tab, setTab] = useState<Tab>('account')
  const [instance] = useState(() =>
    publishableKey
      ? loadConnectAndInitialize({
          publishableKey,
          fetchClientSecret: () =>
            fetch('/api/stripe-connect/account-session', { method: 'POST' })
              .then((r) => r.json())
              .then((j) => j.clientSecret),
          appearance: {
            variables: {
              colorPrimary: '#111827', // accent (tailwind.config.js)
              fontFamily: 'Geist, ui-sans-serif, system-ui, sans-serif',
            },
          },
        })
      : null,
  )

  if (!instance) {
    return (
      <div role="status" className="bg-gray-50 border border-gray-200 rounded-xl p-4 text-sm text-gray-600">
        {t('keyMissing')}
      </div>
    )
  }

  return (
    <ConnectComponentsProvider connectInstance={instance}>
      <div className="mb-4">
        <ConnectNotificationBanner />
      </div>
      <div role="tablist" aria-label={t('embeddedTitle')} className="flex gap-1 border-b border-gray-200 mb-4">
        {TABS.map((x) => (
          <button
            key={x.id}
            type="button"
            role="tab"
            id={`stripe-tab-${x.id}`}
            aria-selected={tab === x.id}
            aria-controls="stripe-tabpanel"
            onClick={() => setTab(x.id)}
            className={`px-3 py-2 text-sm font-medium -mb-px border-b-2 ${
              tab === x.id
                ? 'border-accent text-gray-900'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t(x.labelKey)}
          </button>
        ))}
      </div>
      <div role="tabpanel" id="stripe-tabpanel" aria-labelledby={`stripe-tab-${tab}`}>
        {tab === 'account' && <ConnectAccountManagement />}
        {tab === 'payouts' && <ConnectPayouts />}
        {tab === 'payments' && <ConnectPayments />}
        {tab === 'balance' && <ConnectBalances />}
      </div>
    </ConnectComponentsProvider>
  )
}
