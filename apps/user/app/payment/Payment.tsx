/**
 * Payment Component
 *
 * Renders either a Stripe payment form or a demo payment form,
 * depending on the NEXT_PUBLIC_DEMO_MODE environment variable.
 *
 * Key design decisions:
 * - Demo mode is controlled SERVER-SIDE via env var (not localStorage)
 * - paymentRef is stored server-side in the payment-intent route
 * - Demo mode uses a dedicated server action that processes immediately
 */

'use client'

import React, { useState, useEffect, useMemo } from 'react'
import { loadStripe } from '@stripe/stripe-js'
import { Elements } from '@stripe/react-stripe-js'
import CircularProgress from '@mui/material/CircularProgress'
import { initiateDemoReservationPayment } from './actions'
import CheckoutForm from './CheckoutForm'
import { Reservation } from '../sites/types'

const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE === 'true'


export function StripePayment({
  stripePublicKey,
  reservation,
  preview,
  completeUrl,
}: {
  stripePublicKey: string | undefined
  reservation: Reservation
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
    if (reservation.paymentRef) {
      return
    }

    // Include anonId for anonymous user ownership verification
    const anonId = typeof window !== 'undefined'
      ? localStorage.getItem('sunbnb-anonId')
      : null

    fetch('/api/payment/stripe/payment-intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reservationId: reservation.id, anonId }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.error) {
          console.error('[Payment] PI creation error:', data.error)
          return
        }
        setClientSecret(data.clientSecret)
      })
      .catch((error) => {
        console.error('[Payment] PI creation failed:', error)
      })
  }, [reservation.id])

  const appearance: { theme: 'stripe' } = { theme: 'stripe' }
  const options = { clientSecret, appearance }
  const SafeElements = Elements as unknown as React.ComponentType<any>

  return (
    <div className="App">
      {clientSecret ? (
        <SafeElements options={options} stripe={stripePromise}>
          <CheckoutForm
            dpmCheckerLink=""
            reservation={reservation}
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


export function DemoPayment({
  reservation,
  preview,
  completeUrl,
}: {
  reservation: Reservation
  preview?: React.ReactNode
  completeUrl?: string
}) {
  const [currentReservation, setCurrentReservation] = useState<Reservation>(reservation)

  useEffect(() => {
    if (reservation.paymentRef) {
      return
    }

    initiateDemoReservationPayment(reservation.id).then((result) => {
      if (result.status === 'ok' && result.paymentRef) {
        setCurrentReservation({
          ...reservation,
          paymentRef: result.paymentRef,
          status: 'complete',
        })
      }
    })
  }, [reservation.id])

  return (
    <div className="App">
      <CheckoutForm
        dpmCheckerLink=""
        reservation={currentReservation}
        preview={preview}
        completeUrl={completeUrl}
        demoMode={true}
      />
    </div>
  )
}


export default function Payment({
  stripePublicKey,
  reservation,
  preview,
  completeUrl,
}: {
  stripePublicKey: string | undefined
  reservation: Reservation
  preview?: React.ReactNode
  completeUrl?: string
}) {
  return DEMO_MODE ? (
    <DemoPayment
      reservation={reservation}
      preview={preview}
      completeUrl={completeUrl}
    />
  ) : (
    <StripePayment
      stripePublicKey={stripePublicKey}
      reservation={reservation}
      preview={preview}
      completeUrl={completeUrl}
    />
  )
}
