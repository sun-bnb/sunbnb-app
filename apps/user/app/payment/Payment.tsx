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
import { RESERVATION_COMPLETE } from '@repo/data/reservation-status'
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

    // Include anonId for anonymous user ownership verification
    const anonId = typeof window !== 'undefined'
      ? localStorage.getItem('sunbnb-anonId') ?? undefined
      : undefined

    initiateDemoReservationPayment(reservation.id, anonId).then((result) => {
      if (result.status === 'ok' && result.paymentRef) {
        setCurrentReservation({
          ...reservation,
          paymentRef: result.paymentRef,
          status: RESERVATION_COMPLETE,
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
  onCancel,
}: {
  reservation: Reservation
  preview?: React.ReactNode
  completeUrl?: string
  onCancel?: () => Promise<void>
}) {
  const [isLoading, setIsLoading] = useState(false)
  const [isCancelling, setIsCancelling] = useState(false)
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
      setError(t('Payment failed — please try again'))
      setIsLoading(false)
    }
  }

  return (
    <div className="px-1.5 pt-1 pb-2">
      {preview || (
        <div className="mb-1">
          <ReservationItem reservation={reservation} />
        </div>
      )}
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
        disabled={isLoading || isCancelling || !!reservation.paymentRef}
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
      {onCancel && (
        <div className="text-center mt-2">
          <button
            type="button"
            disabled={isLoading || isCancelling}
            onClick={async () => {
              setIsCancelling(true)
              await onCancel()
              setIsCancelling(false)
            }}
            className="text-xs text-gray-400 hover:text-gray-600 disabled:opacity-50 transition-colors"
          >
            {isCancelling ? <CircularProgress size={12} color="inherit" /> : t('Cancel reservation')}
          </button>
        </div>
      )}
      {error && (
        <div className="text-red-600 text-xs text-center mt-1.5">{error}</div>
      )}
    </div>
  )
}


export default function Payment({
  reservation,
  preview,
  completeUrl,
  onCancel,
}: {
  stripePublicKey: string | undefined
  reservation: Reservation
  preview?: React.ReactNode
  completeUrl?: string
  paymentProvider?: string
  onCancel?: () => Promise<void>
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

  // Mollie is the default payment provider for reservations.
  // Stripe payment code is retained but not active for new reservations.
  return (
    <MolliePayment
      reservation={reservation}
      preview={preview}
      completeUrl={completeUrl}
      onCancel={onCancel}
    />
  )
}
