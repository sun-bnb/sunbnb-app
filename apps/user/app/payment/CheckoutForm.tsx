'use client'

import logger from '@/utils/logger'

import React from 'react'
import Button from '@mui/material/Button'
import { useTranslations } from 'next-intl'
import ReservationItem from './ReservationItem'
import { Reservation } from '../sites/types'

export function DemoCheckoutForm({
  reservation,
  completeUrl,
  preview,
}: {
  reservation: Reservation | undefined
  completeUrl: string | undefined
  preview?: React.ReactNode
}) {
  const t = useTranslations('Payment')

  logger.debug('demo reservation (checkout)', reservation)

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
      <form id="payment-form" className="mr-[6px] ml-[6px] mt-[6px] mb-[12px]">
        <div className="text-[#1976d2] text-[15px] font-bold">{t('Demo mode — click Pay now to simulate payment')}</div>
        <div className="mt-[18px]">
          <Button variant="contained" fullWidth={true} onClick={() => {
            const returnUrl = `${process.env.NEXT_PUBLIC_APP_URL}${completeUrl || '/payment/complete'}`
            const payment_intent = reservation?.paymentRef || 'pi_demo12345'
            const payment_intent_client_secret = 'pi_client_secret_demo_12345_secret_67890'
            const paymentCompleteUrl = `${returnUrl}?payment_intent=${payment_intent}&payment_intent_client_secret=${payment_intent_client_secret}`
            window.location.assign(paymentCompleteUrl)
          }}>
            { t('Pay now') }
          </Button>
        </div>
      </form>
    </>
  );
}

export default function CheckoutForm({
  reservation,
  completeUrl,
  preview,
}: {
  reservation: Reservation | undefined
  completeUrl: string | undefined
  preview?: React.ReactNode
}) {
  return (
    <DemoCheckoutForm
      reservation={reservation}
      completeUrl={completeUrl}
      preview={preview}
    />
  )
}
