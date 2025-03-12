'use client'

import { useState, useEffect } from 'react'
import { Stripe, loadStripe } from '@stripe/stripe-js'
import { Elements } from '@stripe/react-stripe-js'

import CompleteView from './CompleteView'
import { useGetReservationByIdQuery } from '@/store/features/api/apiSlice'
import { Reservation } from '@/app/sites/types'


export default function CompletePage({ 
  stripePublicKey,
  stripeClientSecret,
  reservation
} : { 
  stripePublicKey: string
  stripeClientSecret: string
  reservation: Reservation
}) {

  if (!stripePublicKey) {
    console.error('STRIPE_PUBLIC_KEY is not set')
    return null
  }

  const stripePromise = loadStripe(stripePublicKey)

  const appearance: {
    theme: 'stripe'
  } = {
    theme: 'stripe'
  }

  const options = {
    clientSecret: stripeClientSecret,
    appearance
  };

  return (
    <div className="App">
      <Elements options={options} stripe={stripePromise}>
        <CompleteView stripeClientSecret={stripeClientSecret} reservation={reservation} />
      </Elements>
    </div>
  )

}