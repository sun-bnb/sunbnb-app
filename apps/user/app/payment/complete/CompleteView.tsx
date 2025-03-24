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

    if (reservation.status === 'paid') {
      setStatus('succeeded')
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
        })
      }

    });
  }, [stripe]);

  const statusMap = STATUS_CONTENT_MAP[status]
  const dateStr = reservation.from.toISOString().substring(0, 10)
  const itemCount = reservation.items?.length || 0
  const item = reservation.items?.[0]

  const validFrom = reservation.from.toISOString().substring(0, 10)
  const validTo = reservation.to.toISOString().substring(0, 10)

  const validity = validFrom === validTo ? validFrom : `${validFrom} - ${validTo}`

  const ticket = (  
    <div className="relative h-screen">
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
        <div className="text-center text-2xl h-[80px] w-full flex justify-center">
          <div className="text-[#303030] mt-[22px]">
            Chiringuito La Cepa Playa
          </div>
        </div>
        <div className="flex ml-[12px] mr-[12px]">
          <div className="flex justify-center -mt-[8px]">
            <Image src={sunbedIcon} alt="Sunbed icon" width={200} />
          </div>
          <div className="w-full">
            <div>
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
                    <div className="flex">
                      <div style={{
                        height: '38px',
                        paddingTop: '5px'
                      }} className="flex text-[rgb(142,114,49)]">
                        <Chip label={"RESERVED"} sx={{ color: 'rgb(142,114,49)' }} />
                      </div>
                    </div>
                )
              }
            </div>
            <div className="text-[rgb(142,114,49)] pl-[8px]">
              SEATS: <b>{reservation.items?.map(item => String(item.number)).join(', ')}</b>
            </div>
          </div>
          <div className="relative text-[rgb(142,114,49)] cursor-pointer" 
            onClick={() => window.open(`/reservations/${reservation.id}/pass`, '_blank')}>
            <QrCode2Icon style={{
              fontSize: '84px'
            }}>
            </QrCode2Icon>
            <LaunchIcon className="absolute bg-[#00cef1] top-[27px] left-[27px] border border-[#fff5e1] text-[#fff5e1] border-[2px]" sx={{ 
              width: '30px',
              height: '30px' 
            }}/>
          </div>
        </div>
        <div className="w-full flex justify-center mt-[12px]">
          <div className="border border-[rgb(142,114,49)] cursor-pointer px-[6px] flex"
            style={{
              borderRadius: '6px'
            }}
            onClick={() => window.open(`/reservations/${reservation.id}/receipt`, '_blank')}>
            <div className="text-[rgb(142,114,49)] mr-[4px]">Open receipt</div>
            <LaunchIcon className="bg-[#fff5e1] text-[rgb(142,114,49)] mt-[2px]" sx={{ 
              width: '20px',
              height: '20px' 
            }}/>
          </div>
        </div>
        <div className="flex justify-between mt-[12px] text-[rgb(142,114,49)] border border-[rgb(142,114,49)] m-[24px]">
          <div className="bg-[#fff5e1] text-[rgb(142,114,49)] pl-[6px]">
            VALID:
          </div>
          <div className="bg-[rgb(142,114,49)] text-[#fff5e1] pr-[6px] pl-[6px]">
            <b>{validity}</b>
          </div>
        </div>
      </div>
    </div>
  )

  return (
    <div id="payment-status" className="bg-[#fff5e1]">
      { ticket }
      {
        status === 'succeeded' &&
          <div className="bg-[#00cef1] fixed bottom-0 h-[70px] w-full text-[#fff5e1] text-[24px] flex justify-center items-center">
            FOOD AND DRINK ORDERS
          </div>
      }
    </div>
  );

}