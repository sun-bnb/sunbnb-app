/**
 * Payment Component
 *
 * Renders a Mollie redirect payment or a demo payment form, depending on
 * NEXT_PUBLIC_DEMO_MODE.
 *
 * Key design decisions:
 * - Demo mode is controlled SERVER-SIDE via env var (not localStorage)
 * - paymentRef is stored server-side in the create-payment route
 * - Demo mode uses a dedicated server action that processes immediately
 * - Mollie uses redirect-based checkout (no embedded elements)
 */

'use client'

import React, { useState, useEffect } from 'react'
import CircularProgress from '@mui/material/CircularProgress'
import Button from '@mui/material/Button'
import { useTranslations } from 'next-intl'
import { initiateDemoReservationPayment } from './actions'
import { RESERVATION_COMPLETE } from '@repo/data/reservation-status'
import CheckoutForm from './CheckoutForm'
import ReservationItem from './ReservationItem'
import { Reservation } from '../sites/types'

const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE === 'true'


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
        reservation={currentReservation}
        preview={preview}
        completeUrl={completeUrl}
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

      const baseUrl = `${process.env.NEXT_PUBLIC_APP_URL}${completeUrl || '/payment/complete'}`
      const separator = baseUrl.includes('?') ? '&' : '?'
      const anonSuffix = anonId ? `&anonId=${anonId}` : ''
      const redirectUrl = `${baseUrl}${separator}reservationId=${reservation.id}${anonSuffix}`

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

  // Consumer reservations are paid via Mollie (redirect checkout).
  return (
    <MolliePayment
      reservation={reservation}
      preview={preview}
      completeUrl={completeUrl}
      onCancel={onCancel}
    />
  )
}
