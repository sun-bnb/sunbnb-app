'use client'

import logger from '@/utils/logger'

import React, { useState, useEffect, FormEvent } from 'react'
import Button from '@mui/material/Button'
import Divider from '@mui/material/Divider'
import {
  PaymentElement,
  useStripe,
  useElements
} from '@stripe/react-stripe-js'
import { useTranslations } from 'next-intl'
import ReservationItem from './ReservationItem'
import { Reservation } from '../sites/types'

export default function CheckoutForm({
  reservation,
  completeUrl,
  preview
}: { 
  dpmCheckerLink: string
  reservation: Reservation | undefined
  completeUrl: string | undefined
  preview?: React.ReactNode
}) {
  
  const stripe = useStripe()
  const elements = useElements()

  const t = useTranslations('Payment')

  const [message, setMessage] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const handleSubmit = async (e: FormEvent) => {

    e.preventDefault()

    if (!stripe || !elements) {
      // Stripe.js hasn't yet loaded.
      // Make sure to disable form submission until Stripe.js has loaded.
      return
    }

    setIsLoading(true)

    const returnUrl = `${process.env.NEXT_PUBLIC_APP_URL}${completeUrl || '/payment/complete'}`

    const { error } = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: returnUrl
      },
    })

    if (error.type === "card_error" || error.type === "validation_error") {
      setMessage(error.message || null)
    } else {
      setMessage("An unexpected error occurred.")
    }

    setIsLoading(false)
  }

  const paymentElementOptions: { layout: 'tabs' } = {
    layout: 'tabs'
  }

  logger.debug('reservation (checkout)', reservation)

  return (
    <>
      <div className="mt-[6px]">
        { 
          preview || (reservation &&
            <div className="mt-[26px] mb-[12px]">
              <ReservationItem reservation={reservation} />
            </div>
          )
        }
      </div>
      <form id="payment-form" onSubmit={handleSubmit} className="mr-[6px] ml-[6px] mt-[6px] mb-[12px]">
        <PaymentElement id="payment-element" options={paymentElementOptions} />
        <div className="mt-[18px]">
          <Button variant="contained" fullWidth={true} id="submit" type="submit" disabled={isLoading}>
            { isLoading ? <div className="spinner" id="spinner"></div> : t('Pay now') }
          </Button>
        </div>
        {/* Show any error or success messages */}
        {message && <div id="payment-message">{message}</div>}
      </form>
    </>
  );
}