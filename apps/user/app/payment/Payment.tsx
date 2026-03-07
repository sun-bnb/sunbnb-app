/**
 * Payment Component
 *
 * Renders a Stripe payment form, Mollie redirect payment, or a demo payment form,
 * depending on site.paymentProvider and NEXT_PUBLIC_DEMO_MODE.
 *
 * Key design decisions:
 * - Demo mode is controlled SERVER-SIDE via env var (not localStorage)
 * - paymentRef is stored server-side in the payment-intent / create-payment route
 * - Demo mode uses a dedicated server action that processes immediately
 * - Mollie uses redirect-based checkout (no embedded elements)
 * - Stripe uses embedded Elements + PaymentElement
 */

'use client'

import React, { useState, useEffect, useMemo } from 'react'
import { loadStripe } from '@stripe/stripe-js'
import { Elements } from '@stripe/react-stripe-js'
import CircularProgress from '@mui/material/CircularProgress'
import Button from '@mui/material/Button'
import { useTranslations } from 'next-intl'
import { initiateDemoReservationPayment } from './actions'
import CheckoutForm from './CheckoutForm'
import ReservationItem from './ReservationItem'
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


export function MolliePayment({
  reservation,
  preview,
  completeUrl,
}: {
  reservation: Reservation
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

      const redirectUrl = `${process.env.NEXT_PUBLIC_APP_URL}${completeUrl || '/payment/complete'}?reservationId=${reservation.id}`

      const res = await fetch('/api/payment/mollie/create-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reservationId: reservation.id,
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
      console.error('[MolliePayment] Error:', err)
      setError('Payment failed — please try again')
      setIsLoading(false)
    }
  }

  return (
    <div className="App">
      <div className="mt-[6px]">
        {preview || (
          <div className="mt-[26px] mb-[12px]">
            <ReservationItem reservation={reservation} />
          </div>
        )}
      </div>
      <div className="mr-[6px] ml-[6px] mt-[6px] mb-[12px]">
        <div className="text-black text-[15px] mb-[4px] whitespace-nowrap">
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
        <Button
          variant="contained"
          fullWidth
          onClick={handlePay}
          disabled={isLoading || !!reservation.paymentRef}
        >
          {isLoading ? <CircularProgress size={24} color="inherit" /> : t('Pay now')}
        </Button>
        {error && (
          <div className="text-red-600 text-sm mt-2">{error}</div>
        )}
      </div>
    </div>
  )
}


export default function Payment({
  stripePublicKey,
  reservation,
  preview,
  completeUrl,
  paymentProvider,
}: {
  stripePublicKey: string | undefined
  reservation: Reservation
  preview?: React.ReactNode
  completeUrl?: string
  paymentProvider?: string
}) {
  if (DEMO_MODE) {
    return (
      <DemoPayment
        reservation={reservation}
        preview={preview}
        completeUrl={completeUrl}
      />
    )
  }

  if (paymentProvider === 'mollie') {
    return (
      <MolliePayment
        reservation={reservation}
        preview={preview}
        completeUrl={completeUrl}
      />
    )
  }

  return (
    <StripePayment
      stripePublicKey={stripePublicKey}
      reservation={reservation}
      preview={preview}
      completeUrl={completeUrl}
    />
  )
}
