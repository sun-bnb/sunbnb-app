/**
 * Order Payment Component
 *
 * Renders a Stripe payment form, Mollie redirect payment, or a demo payment form for orders.
 *
 * Key design decisions:
 * - Demo mode is controlled SERVER-SIDE via env var (not localStorage)
 * - paymentRef is stored server-side in the order payment-intent / create-payment route
 * - Service fee is calculated server-side (not sent from client)
 * - Demo mode uses a dedicated server action that processes immediately
 * - Mollie uses redirect-based checkout (no embedded elements)
 */

'use client'

import React, { useState, useEffect, useMemo } from 'react'
import { loadStripe } from '@stripe/stripe-js'
import { Elements } from '@stripe/react-stripe-js'
import CircularProgress from '@mui/material/CircularProgress'
import Button from '@mui/material/Button'
import { useTranslations } from 'next-intl'
import { initiateDemoOrderPayment } from './actions'
import CheckoutForm from './CheckoutForm'
import { Order } from '@/app/types/types'

const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE === 'true'


export function StripeOrderPayment({
  stripePublicKey,
  order,
  preview,
  completeUrl,
}: {
  stripePublicKey: string | undefined
  order: Order
  preview?: React.ReactNode
  completeUrl?: string
}) {
  const [clientSecret, setClientSecret] = useState('')

  if (!stripePublicKey) {
    console.error('STRIPE_PUBLIC_KEY is not set')
    return null
  }

  // Memoize Stripe instance to avoid re-loading on every render
  const stripePromise = useMemo(() => loadStripe(stripePublicKey), [stripePublicKey])

  useEffect(() => {
    if (order.paymentRef) {
      return
    }

    // Create PaymentIntent — server calculates total (product + service fee)
    // and stores paymentRef automatically. Include anonId for anonymous ownership.
    const anonId = typeof window !== 'undefined'
      ? localStorage.getItem('sunbnb-anonId')
      : null

    fetch('/api/order-payment/stripe/payment-intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId: order.id, anonId }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.error) {
          console.error('[OrderPayment] PI creation error:', data.error)
          return
        }
        setClientSecret(data.clientSecret)
      })
      .catch((error) => {
        console.error('[OrderPayment] PI creation failed:', error)
      })
  }, [order.id])

  const appearance: { theme: 'stripe' } = { theme: 'stripe' }
  const options = { clientSecret, appearance }
  const SafeElements = Elements as unknown as React.ComponentType<any>

  return (
    <div className="App" style={{ paddingLeft: '8px', paddingRight: '8px' }}>
      {clientSecret ? (
        <SafeElements options={options} stripe={stripePromise}>
          <CheckoutForm
            dpmCheckerLink=""
            reservation={undefined}
            preview={preview}
            completeUrl={completeUrl}
          />
        </SafeElements>
      ) : (
        <div className="flex justify-center mt-[24px]">
          <CircularProgress />
        </div>
      )}
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
  const [paymentRef, setPaymentRef] = useState<string | null>(order.paymentRef ?? null)

  useEffect(() => {
    if (order.paymentRef) {
      return
    }

    // Demo: process payment immediately on server, get back paymentRef
    initiateDemoOrderPayment(order.id).then((result) => {
      if (result.status === 'ok' && result.paymentRef) {
        setPaymentRef(result.paymentRef)
      }
    })
  }, [order.id])

  return (
    <div className="App" style={{ paddingLeft: '8px', paddingRight: '8px' }}>
      <CheckoutForm
        dpmCheckerLink=""
        reservation={undefined}
        preview={preview}
        completeUrl={completeUrl}
        demoMode={true}
      />
    </div>
  )
}


export function MollieOrderPayment({
  order,
  preview,
  completeUrl,
}: {
  order: Order
  preview?: React.ReactNode
  completeUrl?: string
}) {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const t = useTranslations('Payment')

  const handlePay = async () => {
    setIsLoading(true)
    setError(null)

    try {
      const anonId = typeof window !== 'undefined'
        ? localStorage.getItem('sunbnb-anonId')
        : null

      const baseUrl = `${process.env.NEXT_PUBLIC_APP_URL}${completeUrl || '/payment/complete'}`
      const separator = baseUrl.includes('?') ? '&' : '?'
      const redirectUrl = `${baseUrl}${separator}orderId=${order.id}`

      const res = await fetch('/api/order-payment/mollie/create-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: order.id,
          anonId,
          redirectUrl,
        }),
      })

      const data = await res.json()

      if (data.error) {
        setError(data.error)
        setIsLoading(false)
        return
      }

      // Redirect to Mollie's hosted checkout page
      window.location.href = data.checkoutUrl
    } catch (err) {
      console.error('[MollieOrderPayment] Error:', err)
      setError('Payment failed — please try again')
      setIsLoading(false)
    }
  }

  return (
    <div className="px-3 pt-1 pb-3">
      {preview && <div className="mb-1">{preview}</div>}
      <div className="rounded-lg border border-gray-200 bg-white px-3 py-2.5 mb-2">
        <div className="flex items-center gap-2 mb-1.5">
          <svg className="w-4 h-4 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
          <span className="text-sm font-medium text-gray-700">{t('Secure checkout')}</span>
        </div>
        <p className="text-xs text-gray-500">{t('You will be redirected to complete payment')}</p>
      </div>
      <Button
        variant="contained"
        fullWidth
        onClick={handlePay}
        disabled={isLoading || !!order.paymentRef}
        sx={{ textTransform: 'none', fontWeight: 600, py: 1.2 }}
      >
        {isLoading ? <CircularProgress size={20} color="inherit" /> : t('Pay now')}
      </Button>
      <div className="text-gray-400 text-[11px] text-center mt-1.5">
        {t('Payment confirms acceptance of')}{' '}
        <a
          className="text-[#1976d2]"
          href="/tos/reservation"
          target="_blank"
          rel="noopener noreferrer"
        >
          {t('terms of service')}
        </a>
      </div>
      {error && (
        <div className="text-red-600 text-xs text-center mt-1.5">{error}</div>
      )}
    </div>
  )
}


export default function OrderPayment({
  stripePublicKey,
  order,
  serviceFee,
  preview,
  completeUrl,
  paymentProvider,
}: {
  stripePublicKey: string | undefined
  order: Order
  serviceFee?: number
  preview?: React.ReactNode
  completeUrl?: string
  paymentProvider?: string
}) {
  if (DEMO_MODE) {
    return (
      <DemoOrderPayment
        order={order}
        preview={preview}
        completeUrl={completeUrl}
      />
    )
  }

  if (paymentProvider === 'mollie') {
    return (
      <MollieOrderPayment
        order={order}
        preview={preview}
        completeUrl={completeUrl}
      />
    )
  }

  return (
    <StripeOrderPayment
      stripePublicKey={stripePublicKey}
      order={order}
      preview={preview}
      completeUrl={completeUrl}
    />
  )
}
