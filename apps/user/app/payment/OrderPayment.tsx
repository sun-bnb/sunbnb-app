/**
 * Order Payment Component
 *
 * Renders either a Stripe payment form or a demo payment form for orders.
 *
 * Key design decisions:
 * - Demo mode is controlled SERVER-SIDE via env var (not localStorage)
 * - paymentRef is stored server-side in the order payment-intent route
 * - Service fee is calculated server-side (not sent from client)
 * - Demo mode uses a dedicated server action that processes immediately
 */

'use client'

import React, { useState, useEffect, useMemo } from 'react'
import { loadStripe } from '@stripe/stripe-js'
import { Elements } from '@stripe/react-stripe-js'
import CircularProgress from '@mui/material/CircularProgress'
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


export default function OrderPayment({
  stripePublicKey,
  order,
  serviceFee,
  preview,
  completeUrl,
}: {
  stripePublicKey: string | undefined
  order: Order
  serviceFee?: number
  preview?: React.ReactNode
  completeUrl?: string
}) {
  return DEMO_MODE ? (
    <DemoOrderPayment
      order={order}
      preview={preview}
      completeUrl={completeUrl}
    />
  ) : (
    <StripeOrderPayment
      stripePublicKey={stripePublicKey}
      order={order}
      preview={preview}
      completeUrl={completeUrl}
    />
  )
}
