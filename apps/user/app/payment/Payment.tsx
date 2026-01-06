'use client'

import logger from '@/utils/logger'

import React, { useState, useEffect, use } from 'react'
import { loadStripe } from '@stripe/stripe-js'
import { Elements } from '@stripe/react-stripe-js'
import CircularProgress from '@mui/material/CircularProgress'
import { updateReservation, getReservationById } from './actions'
import { setValue } from '@/store/features/sites/sitesSlice'
import { RootState } from '@/store/store'
import { useDispatch, useSelector } from 'react-redux'
import CheckoutForm from './CheckoutForm'
import { Reservation } from '../sites/types'


export function StripePayment({ 
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
  logger.debug('Payment for reservation', reservation)

  useEffect(() => {

    if (reservation.paymentRef) {
      logger.debug('RESERVATION ALREADY HAS PAYMENT REF', reservation.paymentRef)
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
        logger.debug('Payment intent result', data)
        if (data.error) {
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
      .then((res) => logger.debug('Reservation updated', res));

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
  const SafeElements = Elements as unknown as React.ComponentType<any>

  return (
    <div className="App">
      {
        clientSecret ? (
          <SafeElements options={options} stripe={stripePromise}>
            {
                <CheckoutForm dpmCheckerLink={dpmCheckerLink} 
                  reservation={reservation}
                  preview={preview}
                  completeUrl={completeUrl} />
            }
          </SafeElements>
        ) : (
          <div className="flex justify-center mt-[24px]">
            <CircularProgress />
          </div>
        )
      }
    </div>
  );
}


export function DemoPayment({
  reservation,
  preview,
  completeUrl
} : {
  reservation: Reservation
  preview?: React.ReactNode
  completeUrl?: string
}) {

  const [currentReservation, setCurrentReservation] = useState<Reservation>(reservation)

  logger.debug('Demo Payment for reservation', reservation)

  useEffect(() => {

    if (reservation.paymentRef) {
      logger.debug('RESERVATION ALREADY HAS PAYMENT REF', reservation.paymentRef)
      return
    }

    updateReservation({
      id: reservation.id,
      paymentRef: `pi_demo_${Date.now()}`,
      status: 'paid'
    })
    .then((res) => {
      logger.debug('Reservation updated', res)
      return getReservationById({ id: reservation.id })
    }).then((res) => {
      if (res && res.reservation) {
        setCurrentReservation(res.reservation)
      }
    })

  }, [reservation.id]);

  return (
    <div className="App">
      <CheckoutForm dpmCheckerLink={'httpd://demo-link'} 
        reservation={currentReservation}
        preview={preview}
        completeUrl={completeUrl} demoMode={true} />
    </div>
  );
}

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


  const dispatch = useDispatch()
  const sitesState = useSelector((state: RootState) => state.sites)
  //const { demoMode } = sitesState
  const demoMode = window.localStorage.getItem('demoMode') === 'true'
  
  return demoMode ?
    <DemoPayment
      reservation={reservation}
      preview={preview}
      completeUrl={completeUrl} /> :
    <StripePayment 
      stripePublicKey={stripePublicKey} 
      reservation={reservation}
      preview={preview}
      completeUrl={completeUrl} />
}
