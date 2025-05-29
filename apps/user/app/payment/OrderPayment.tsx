'use client'

import logger from '@/utils/logger'

import React, { useState, useEffect } from 'react'
import { loadStripe } from '@stripe/stripe-js'
import { Elements } from '@stripe/react-stripe-js'
import CircularProgress from '@mui/material/CircularProgress'
import { updateOrder } from './actions'
import CheckoutForm from './CheckoutForm'
import { Order } from '@/app/types/types'


export default function OrderPayment({ 
  stripePublicKey,
  order,
  preview,
  completeUrl
} : { 
  stripePublicKey: string | undefined 
  order: Order
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
  logger.debug('Payment for order', order)

  useEffect(() => {

    if (order.paymentRef) {
      logger.debug('RESERVATION ALREADY HAS PAYMENT REF', order.paymentRef)
      return
    }

    // Create PaymentIntent as soon as the page loads
    fetch('/api/order-payment/stripe/payment-intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderId: order.id,
        paymentAmount: order.paymentAmount 
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
        return updateOrder({
          id: order.id,
          paymentRef: data.paymentIntentId
        })
      })
      .then((res) => logger.debug('Reservation updated', res));

  }, [order.id]);


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
    <div className="App" style={{ paddingLeft: '8px', paddingRight: '8px' }}>
      {
        clientSecret ? (
          <Elements options={options} stripe={stripePromise}>
            {
                <CheckoutForm dpmCheckerLink={dpmCheckerLink} 
                  reservation={undefined}
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