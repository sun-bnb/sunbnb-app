/**
 * Order Payment Component
 *
 * The payment step of the F&B order drawer: a redirect checkout via the venue's
 * provider (Mollie default; Stripe / Viva through the neutral route) or, in demo
 * mode, a simulated payment. Both render the SAME panel so the step looks one way.
 *
 * Key design decisions:
 * - Demo mode is controlled SERVER-SIDE via env var (not localStorage)
 * - paymentRef is stored server-side in the order create-payment route
 * - Service fee is calculated server-side (not sent from client)
 * - Demo mode uses a dedicated server action that processes immediately
 * - Both paths return to `completeUrl` with `orderId`, which the reservation
 *   page uses to load the order and show its confirmation. The demo path used to
 *   go through the reservation CheckoutForm, which appended a second `?` (so a
 *   guest's anonId was corrupted → "No reservation found") and a placeholder ref
 *   (so the page could never find the order it had just paid for).
 */

'use client'

import React, { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { initiateDemoOrderPayment } from './actions'
import { usesLegacyMollieEndpoint, neutralCheckoutBody } from './checkout-endpoint'
import { Order } from '@/app/types/types'
import { trackBeginCheckout } from '../analytics/track'

/** GA4 begin_checkout for an F&B order, at the amount the pay button shows. */
function trackOrderCheckout(order: Order) {
  if (order.siteId) trackBeginCheckout({ kind: 'fnb', siteId: order.siteId, value: order.totalPrice })
}

const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE === 'true'

/** `url` + `key=value`, with the right separator whether or not `url` has a query. */
function withParam(url: string, key: string, value: string): string {
  return `${url}${url.includes('?') ? '&' : '?'}${key}=${encodeURIComponent(value)}`
}

function Spinner() {
  return <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent" aria-hidden="true" />
}

/** The one payment panel — preview, how payment works, the pay button, terms. */
function PaymentPanel({
  order,
  preview,
  demo,
  busy,
  disabled,
  error,
  onPay,
}: {
  order: Order
  preview?: React.ReactNode
  demo: boolean
  busy: boolean
  disabled: boolean
  error: string | null
  onPay: () => void
}) {
  const t = useTranslations('Payment')
  return (
    <div className="pb-5">
      {preview}
      <div className="px-5">
        {demo ? (
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-snug text-amber-800">
            {t('Demo mode — no card is charged')}
          </p>
        ) : (
          <div className="flex items-start gap-3 rounded-xl bg-cream-light px-4 py-3 ring-1 ring-brand-ink/[0.07]">
            <svg className="mt-0.5 h-4 w-4 shrink-0 text-brand-ink/70" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            <div>
              <p className="text-sm font-medium text-brand-ink">{t('Secure checkout')}</p>
              <p className="mt-0.5 text-xs text-brand-ink/70">{t('You will be redirected to complete payment')}</p>
            </div>
          </div>
        )}
        <button
          onClick={onPay}
          disabled={disabled || busy}
          className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand-ink text-sm font-semibold text-cream
                     transition-colors hover:bg-brand-ink-hover active:bg-brand-ink-hover disabled:opacity-40"
        >
          {busy ? <Spinner /> : <span className="tabular-nums">{t('Pay {amount}', { amount: `€${order.totalPrice.toFixed(2)}` })}</span>}
        </button>
        <p className="mt-2.5 text-center text-[11px] text-brand-ink/60">
          {t('Payment confirms acceptance of')}{' '}
          <a className="font-medium text-brand-ink underline underline-offset-2" href="/tos/reservation" target="_blank" rel="noopener noreferrer">
            {t('terms of service')}
          </a>
        </p>
        {error && <p className="mt-2 text-center text-xs text-red-600" role="status">{error}</p>}
      </div>
    </div>
  )
}


export function DemoOrderPayment({
  order,
  preview,
  completeUrl,
}: {
  order: Order
  preview?: React.ReactNode
  completeUrl?: string
}) {
  const [ready, setReady] = useState<boolean>(!!order.paymentRef)
  const [leaving, setLeaving] = useState(false)

  useEffect(() => {
    if (order.paymentRef) return
    // Demo: process payment immediately on server. Include anonId for
    // anonymous user ownership verification.
    const anonId = typeof window !== 'undefined'
      ? localStorage.getItem('sunbnb-anonId') ?? undefined
      : undefined
    initiateDemoOrderPayment(order.id, anonId).then((result) => {
      if (result.status === 'ok' && result.paymentRef) setReady(true)
    })
  }, [order.id])

  return (
    <PaymentPanel
      order={order}
      preview={preview}
      demo
      busy={leaving || !ready}
      disabled={!ready}
      error={null}
      onPay={() => {
        trackOrderCheckout(order)
        setLeaving(true)
        window.location.assign(withParam(completeUrl || '/payment/complete', 'orderId', order.id))
      }}
    />
  )
}


export function MollieOrderPayment({
  order,
  preview,
  completeUrl,
  paymentProvider,
}: {
  order: Order
  paymentProvider?: string
  preview?: React.ReactNode
  completeUrl?: string
}) {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const t = useTranslations('Payment')

  const handlePay = async () => {
    setIsLoading(true)
    setError(null)
    trackOrderCheckout(order)

    try {
      const anonId = typeof window !== 'undefined'
        ? localStorage.getItem('sunbnb-anonId')
        : null

      const redirectUrl = withParam(`${process.env.NEXT_PUBLIC_APP_URL}${completeUrl || '/payment/complete'}`, 'orderId', order.id)

      const legacy = usesLegacyMollieEndpoint(paymentProvider)
      const res = await fetch(legacy ? '/api/order-payment/mollie/create-payment' : '/api/payment/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          legacy
            ? { orderId: order.id, anonId, redirectUrl }
            : neutralCheckoutBody('order', { orderId: order.id }, { anonId, redirectUrl }),
        ),
      })

      const data = await res.json()

      if (data.error) {
        setError(data.error)
        setIsLoading(false)
        return
      }

      // Redirect to the provider's hosted checkout page
      window.location.href = data.checkoutUrl
    } catch (err) {
      console.error('[MollieOrderPayment] Error:', err)
      setError(t('Payment failed — please try again'))
      setIsLoading(false)
    }
  }

  return (
    <PaymentPanel
      order={order}
      preview={preview}
      demo={false}
      busy={isLoading}
      disabled={!!order.paymentRef}
      error={error}
      onPay={handlePay}
    />
  )
}


export default function OrderPayment({
  order,
  preview,
  completeUrl,
  paymentProvider,
}: {
  order: Order
  serviceFee?: number
  preview?: React.ReactNode
  completeUrl?: string
  paymentProvider?: string
}) {
  if (DEMO_MODE) {
    return <DemoOrderPayment order={order} preview={preview} completeUrl={completeUrl} />
  }
  return (
    <MollieOrderPayment
      order={order}
      preview={preview}
      completeUrl={completeUrl}
      paymentProvider={paymentProvider}
    />
  )
}
