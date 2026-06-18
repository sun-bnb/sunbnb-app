'use client'

import { useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { requestReceipt } from './actions'

export default function ThankYouView({ reservationId }: { reservationId: string }) {
  const t = useTranslations('PaymentThankYou')
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      const res = await requestReceipt(reservationId, email)
      if (res.status === 'ok') setSent(true)
      else setError(res.errors?.[0] ?? t('error'))
    })
  }

  return (
    <main className="min-h-[100dvh] flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-sm border border-gray-200 p-6 text-center">
        <div className="text-5xl">✅</div>
        <h1 className="mt-3 text-2xl font-bold text-gray-900">{t('title')}</h1>
        <p className="mt-1 text-gray-500">{t('subtitle')}</p>

        {reservationId && (
          sent ? (
            <div className="mt-6 rounded-xl border-2 border-green-200 bg-green-50 text-green-700 font-semibold px-4 py-4">
              {t('sent')}
            </div>
          ) : (
            <form onSubmit={submit} className="mt-6 text-left">
              <label htmlFor="receipt-email" className="block text-sm font-semibold text-gray-700">
                {t('receiptLabel')}
              </label>
              <input
                id="receipt-email"
                type="email"
                inputMode="email"
                autoComplete="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder={t('emailPlaceholder')}
                className="mt-1 w-full rounded-xl border-2 border-gray-200 px-4 py-3 text-base focus:border-gray-400 focus:outline-none"
              />
              {error && <p className="mt-2 text-sm font-medium text-red-600" role="status">{error}</p>}
              <button
                type="submit"
                disabled={isPending || email.trim().length === 0}
                className="mt-3 w-full rounded-xl bg-gray-900 py-3 text-base font-bold text-white active:bg-gray-700 disabled:opacity-50"
              >
                {isPending ? '…' : t('sendReceipt')}
              </button>
            </form>
          )
        )}
      </div>
    </main>
  )
}
