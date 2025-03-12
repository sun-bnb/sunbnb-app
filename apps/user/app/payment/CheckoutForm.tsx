'use client'

import { useState, useEffect, FormEvent } from 'react'
import Button from '@mui/material/Button'
import Divider from '@mui/material/Divider'
import {
  PaymentElement,
  useStripe,
  useElements
} from '@stripe/react-stripe-js'
import ReservationItem from './ReservationItem'
import { Reservation } from '../sites/types'

export default function CheckoutForm({ 
  dpmCheckerLink,
  reservation,
  completeUrl
}: { 
  dpmCheckerLink: string
  reservation: Reservation | undefined
  completeUrl: string | undefined
}) {
  
  const stripe = useStripe()
  const elements = useElements()

  const [message, setMessage] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  console.log('CLIENT APP URL2', process.env.NEXT_PUBLIC_APP_URL)

  const handleSubmit = async (e: FormEvent) => {

    e.preventDefault();

    console.log('stripe', stripe)
    console.log('elements', elements)

    if (!stripe || !elements) {
      // Stripe.js hasn't yet loaded.
      // Make sure to disable form submission until Stripe.js has loaded.
      return;
    }

    setIsLoading(true)

    console.log('APP URL FOR CHECKOUT', process.env.NEXT_PUBLIC_APP_URL)

    const returnUrl = `${process.env.NEXT_PUBLIC_APP_URL}${completeUrl || '/payment/complete'}`

    const { error } = await stripe.confirmPayment({
      elements,
      confirmParams: {
        // Make sure to change this to your payment completion page
        return_url: returnUrl
      },
    });

    // This point will only be reached if there is an immediate error when
    // confirming the payment. Otherwise, your customer will be redirected to
    // your `return_url`. For some payment methods like iDEAL, your customer will
    // be redirected to an intermediate site first to authorize the payment, then
    // redirected to the `return_url`.
    if (error.type === "card_error" || error.type === "validation_error") {
      setMessage(error.message || null)
    } else {
      setMessage("An unexpected error occurred.");
    }

    setIsLoading(false);
  };

  const paymentElementOptions: { layout: 'tabs' } = {
    layout: 'tabs'
  }

  console.log('reservation', reservation)

  return (
    <>
      <div className="mt-[32px] mb-[12px]">
        { 
          reservation &&
            <ReservationItem reservation={reservation} />
        }
      </div>
      <form id="payment-form" onSubmit={handleSubmit} className="mr-[6px] ml-[6px] mt-[6px]">
        <PaymentElement id="payment-element" options={paymentElementOptions} />
        <div className="mt-[18px]">
          <Button variant="contained" fullWidth={true} id="submit" type="submit" disabled={isLoading}>
            { isLoading ? <div className="spinner" id="spinner"></div> : "Pay now" }
          </Button>
        </div>
        {/* Show any error or success messages */}
        {message && <div id="payment-message">{message}</div>}
      </form>
    </>
  );
}