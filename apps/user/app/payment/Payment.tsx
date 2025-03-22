'use client'

import React, { useState, useEffect } from 'react'
import { Stripe, loadStripe } from '@stripe/stripe-js'
import { Elements } from '@stripe/react-stripe-js'
import CircularProgress from '@mui/material/CircularProgress'
import { updateReservation } from './actions'
import CheckoutForm from './CheckoutForm'
import CompletePage from './complete/ok/CompletePage'
import { useGetReservationByIdQuery } from '@/store/features/api/apiSlice'
import { Reservation } from '../sites/types'


export default function Payment({ 
  stripePublicKey,
  reservation,
  preview,
  completeUrl
} : { 
  stripePublicKey: string | undefined 
  reservation: Reservation
  preview?: React.ReactNode
  completeUrl?: string
}) {


  const [clientSecret, setClientSecret] = useState("");
  const [dpmCheckerLink, setDpmCheckerLink] = useState("");

  if (!stripePublicKey) {
    console.error('STRIPE_PUBLIC_KEY is not set')
    return null
  }

  const stripePromise = loadStripe(stripePublicKey)
  console.log('render Payment', reservation)

  useEffect(() => {

    if (reservation.paymentRef) {
      console.log('RESERVATION ALREADY HAS PAYMENT REF', reservation.paymentRef)
      return
    }

    // Create PaymentIntent as soon as the page loads
    fetch('/api/payment/stripe/payment-intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reservationId: reservation.id,
        paymentAmount: reservation.paymentAmount 
      }),
    })
      .then((res) => res.json())
      .then((data) => {
        console.log('RECEIVED DATA', data)
        if (data.error) {
          console.error('ERROR', data.error)
          return
        }
        setClientSecret(data.clientSecret)
        // [DEV] For demo purposes only
        setDpmCheckerLink(data.dpmCheckerLink)
        return updateReservation({
          id: reservation.id,
          paymentRef: data.paymentIntentId
        })
      })
      .then((res) => console.log('RESERVATION UPDATED', res));

  }, [reservation.id]);


  const appearance: {
    theme: 'stripe'
  } = {
    theme: 'stripe'
  }

  const options = {
    clientSecret,
    appearance
  };

  return (
    <div className="App">
      {
        clientSecret ? (
          <Elements options={options} stripe={stripePromise}>
            {
                <CheckoutForm dpmCheckerLink={dpmCheckerLink} 
                  reservation={reservation}
                  preview={preview}
                  completeUrl={completeUrl} />
            }
          </Elements>
        ) : (
          <div className="flex justify-center mt-[24px]">
            <CircularProgress />
          </div>
        )
      }
    </div>
  );
}