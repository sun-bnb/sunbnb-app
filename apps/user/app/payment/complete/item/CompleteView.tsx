'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import Button from '@mui/material/Button'
import QrCode2Icon from '@mui/icons-material/QrCode2'
import CircularProgress from '@mui/material/CircularProgress'
import Alert from '@mui/material/Alert'
import {
  useStripe,
} from '@stripe/react-stripe-js'
import { updateReservation } from '@/actions/reservations'
import { Reservation } from '@/app/sites/types'
import sunbedIcon from './sunbed-icon-transparent.png'

import qrTicketImage from './qr-ticket.png'

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
}


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

      console.log('PaymentIntent', paymentIntent, reservation)
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
  const dateStr = reservation.from.toISOString().substring(0, 10)
  const itemCount = reservation.items?.length || 0
  const item = reservation.items?.[0]

  const ticket = (
    
      <div className="relative bg-[rgb(255,231,156)] h-screen">
        {
          
            !reservation &&
              <div className="
                  absolute
                  top-[6px]
                  left-1/2
                  -translate-x-1/2
                  inline-block
                  z-[1]
                  py-[6px]
                  px-[8px]
                  w-[80%]
              ">
                
              </div>
        }
        <div className="w-full">
          <div className="text-center text-2xl h-[80px] w-full flex justify-center border-b-[2px] border-[rgb(142,114,49)]">
            <div className="text-[rgb(142,114,49)] mt-[22px]">
              Chiringuito La Cepa Playa
            </div>
          </div>
          <div className="w-full flex justify-center mt-[24px]">
            <div className="text-[rgb(142,114,49)] ">
              SEAT {item?.number}
            </div>
          </div>
          <div className="flex justify-center mt-[16px]">
            <Image src={sunbedIcon} alt="Sunbed icon" width={300} />
          </div>
          <div className="flex justify-center mt-[6px]">
          {
            status === 'default' ? (
              <div className="flex justify-center">
                <CircularProgress />
              </div>
            ) : (
              status !== 'succeeded' ?
                <Alert severity={statusMap?.severity || 'info'}>
                  {statusMap?.text}
                </Alert> :
                <div className="flex justify-center">
                  <div style={{
                    height: '38px',
                    paddingTop: '5px'
                  }} className="w-[200px] flex justify-center border-[1px] border-[rgb(142,114,49)] text-[rgb(142,114,49)]">
                    RESERVED
                  </div>
                  <div style={{
                    height: '38px',
                    marginTop: '-4px'
                  }} className="text-[rgb(142,114,49)]">
                   <QrCode2Icon style={{
                    fontSize: '46px'
                   }} />
                  </div>
                </div>
            )
              
            
          }
            
          </div>
        </div>
      </div>
  )

  return (
    <div id="payment-status" className="">
      { ticket }
      {
        status === 'succeeded' &&
          <div className="bg-[#1976d2] text-black fixed bottom-0 h-[100px] w-full text-white text-[24px] flex justify-center items-center">
            FOOD AND DRINK ORDERS
          </div>
      }
    </div>
  );
}