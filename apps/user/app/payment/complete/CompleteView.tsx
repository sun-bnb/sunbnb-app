'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import Button from '@mui/material/Button'
import LaunchIcon from '@mui/icons-material/Launch'
import QrCode2Icon from '@mui/icons-material/QrCode2'
import CircularProgress from '@mui/material/CircularProgress'
import Alert from '@mui/material/Alert'
import Chip from '@mui/material/Chip'
import {
  useStripe,
} from '@stripe/react-stripe-js'
import { updateReservation, fetchReservation } from '@/actions/reservations'
import { Reservation } from '@/app/sites/types'
import sunbedIcon from './sunbed-icon-transparent.png'
import qrTicketImage from './qr-ticket.png'
import ReservationConfirmationView from '@/components/reservation/confirmation/view'


export default function CompleteView({
  stripeClientSecret,
  reservation
} : {
  stripeClientSecret: string
  reservation: Reservation
}) {

  const router = useRouter()
  const stripe = useStripe()

  const [status, setStatus] = useState<string | undefined>('default')
  const [intentId, setIntentId] = useState<string | null>(null)
  const [updatedReservation, setUpdatedReservation] = useState<Reservation | null>(null)

  useEffect(() => {

    if (reservation.status === 'paid') {
      setStatus(undefined)
      setIntentId(reservation.paymentRef!)
      return
    }

    if (!stripe) {
      return
    }

    stripe.retrievePaymentIntent(stripeClientSecret).then(({ paymentIntent }) => {

      console.log('PaymentIntent', paymentIntent, reservation)
      if (!paymentIntent) {
        return
      }
      
      setStatus(paymentIntent.status)
      setIntentId(paymentIntent.id)

      let reservationStatus = null
      if (paymentIntent.status === 'succeeded') {
        reservationStatus = 'confirmed'
      } else if (paymentIntent.status === 'requires_payment_method') {
        reservationStatus = 'requires_payment_method'
      } else if (paymentIntent.status === 'processing') {
        reservationStatus = 'processing_payment'
      }

      if (reservationStatus) {
        updateReservation({
          id: reservation.id,
          status: reservationStatus
        }).then((res) => {
          console.log('Reservation status saved', res)
          if (reservationStatus === 'confirmed') {
            fetchReservation(reservation.id).then((res: Reservation) => {
              console.log('Reservation fetched', res)
              if (res.status === 'paid') {
                setStatus(undefined)
                setUpdatedReservation(res)
              }
            })
          }
        })
      }

    });
  }, [stripe]);

  return (
    <div id="payment-status" className="bg-[#fff5e1]">
      <ReservationConfirmationView reservation={updatedReservation || reservation} processingStatus={status} />
      {
        status === 'succeeded' &&
          <div className="bg-[#00cef1] fixed bottom-0 h-[70px] w-full text-[#fff5e1] text-[24px] flex justify-center items-center">
            FOOD AND DRINK ORDERS
          </div>
      }
    </div>
  );

}