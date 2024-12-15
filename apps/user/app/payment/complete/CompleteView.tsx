'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Alert from '@mui/material/Alert'
import {
  useStripe,
} from '@stripe/react-stripe-js'
import { updateReservation } from '@/actions/reservations'
import { Reservation } from '@/app/sites/types'
import ReservationItem from '../ReservationItem'

const STATUS_CONTENT_MAP: {
  [key: string]: {
    text: string
    severity: 'success' | 'info' | 'error'
  }
} = {
  succeeded: {
    text: 'Payment received',
    severity: 'success'

  },
  processing: {
    text: "Your payment is processing.",
    severity: 'info'
  },
  requires_payment_method: {
    text: "Your payment was not successful, please try again.",
    severity: 'error'
  }
};

export default function CompleteView({
  stripeClientSecret,
  reservation
} : {
  stripeClientSecret: string
  reservation: Reservation
}) {

  const router = useRouter()
  const stripe = useStripe()

  const [status, setStatus] = useState<string>('default')
  const [intentId, setIntentId] = useState<string | null>(null)

  useEffect(() => {
    if (!stripe) {
      return
    }

    stripe.retrievePaymentIntent(stripeClientSecret).then(({ paymentIntent }) => {

      console.log('PaymentIntent', paymentIntent)
      if (!paymentIntent) {
        return
      }
      
      setStatus(paymentIntent.status)
      setIntentId(paymentIntent.id)

      let reaervationStatus = null
      if (paymentIntent.status === 'succeeded') {
        reaervationStatus = 'confirmed'
      } else if (paymentIntent.status === 'requires_payment_method') {
        reaervationStatus = 'requires_payment_method'
      } else if (paymentIntent.status === 'processing') {
        reaervationStatus = 'processing_payment'
      }

      if (reaervationStatus) {
        updateReservation({
          id: reservation.id,
          status: reaervationStatus
        }).then((res) => {
          console.log('Reservation status saved', res)
        })
      }

    });
  }, [stripe]);

  const statusMap = STATUS_CONTENT_MAP[status]

  return (
    <div id="payment-status" className="m-[6px]">
      <div className="mb-[6px]">
        {
          reservation &&
            <ReservationItem reservation={reservation} />
        }
      </div>
      {
        status === 'default' ? (
          <div className="flex justify-center">
            <CircularProgress />
          </div>
        ) : (
          <Alert severity={statusMap?.severity || 'info'}>
            {statusMap?.text}
          </Alert>
        )
      }
      <div className="mt-[24px] text-center">
        <Button fullWidth={true} variant="contained" onClick={() => router.push(`/reservations/${reservation.id}`)}>
          View reservation
        </Button>
      </div>
      <div className="mt-[6px] text-center">
        <Button fullWidth={true} onClick={() => router.push(`/`)}>
          Explore more beaches
        </Button>
      </div>
      {false && <a href={`https://dashboard.stripe.com/payments/${intentId}`} id="view-details" target="_blank">View details
        <svg width="15" height="14" viewBox="0 0 15 14" fill="none" xmlns="http://www.w3.org/2000/svg" style={{paddingLeft: '5px'}}>
          <path fillRule="evenodd" clipRule="evenodd" d="M3.125 3.49998C2.64175 3.49998 2.25 3.89173 2.25 4.37498V11.375C2.25 11.8582 2.64175 12.25 3.125 12.25H10.125C10.6082 12.25 11 11.8582 11 11.375V9.62498C11 9.14173 11.3918 8.74998 11.875 8.74998C12.3582 8.74998 12.75 9.14173 12.75 9.62498V11.375C12.75 12.8247 11.5747 14 10.125 14H3.125C1.67525 14 0.5 12.8247 0.5 11.375V4.37498C0.5 2.92524 1.67525 1.74998 3.125 1.74998H4.875C5.35825 1.74998 5.75 2.14173 5.75 2.62498C5.75 3.10823 5.35825 3.49998 4.875 3.49998H3.125Z" fill="#0055DE"/>
          <path d="M8.66672 0C8.18347 0 7.79172 0.391751 7.79172 0.875C7.79172 1.35825 8.18347 1.75 8.66672 1.75H11.5126L4.83967 8.42295C4.49796 8.76466 4.49796 9.31868 4.83967 9.66039C5.18138 10.0021 5.7354 10.0021 6.07711 9.66039L12.7501 2.98744V5.83333C12.7501 6.31658 13.1418 6.70833 13.6251 6.70833C14.1083 6.70833 14.5001 6.31658 14.5001 5.83333V0.875C14.5001 0.391751 14.1083 0 13.6251 0H8.66672Z" fill="#0055DE"/>
          </svg>
      </a>}
    </div>
  );
}