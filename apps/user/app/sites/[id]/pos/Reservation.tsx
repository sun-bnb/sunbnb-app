'use client'

import logger from '@/utils/logger'

import { v4 as uuidv4 } from 'uuid'
import { SiteProps } from '@/app/sites/types'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import React, { useState } from 'react'
import { useSession } from 'next-auth/react'
import KeyboardDoubleArrowDownIcon from '@mui/icons-material/KeyboardDoubleArrowDown'
import { setValue } from '@/store/features/sites/sitesSlice'
import { RootState } from '@/store/store'
import { useDispatch, useSelector } from 'react-redux'
import {
  useGetReservationByIdQuery
} from '@/store/features/api/apiSlice'
import dayjs, { Dayjs } from 'dayjs'
import SunbedSelection from '@/components/reservation/SunbedSelection'
import { saveReservationForMultipleItems } from '../actions'
import { RESERVATION_PROCESSING } from '@repo/data/reservation-status'
import PaymentView from '@/app/payment/Payment'
import { useRouter } from 'next/navigation'


function ReservationButton({
  disabled,
  site,
  dateRange
}: {
  disabled: boolean,
  site: SiteProps,
  dateRange: { from: string, to: string }
}) {

  const { data: session } = useSession()

  const dispatch = useDispatch();
  const router = useRouter()
  const sitesState = useSelector((state: RootState) => state.sites)
  const { reservationState, reservationMode, selectedItems } = sitesState

  let reservationDay = dayjs(sitesState.reservationDay)

  return (
    <div className="mt-[8px]">
      <Button variant="contained" 
        fullWidth={true}
        disabled={disabled}
        onClick={
          async () => {
            dispatch(setValue({ reservationState: 'saving' }))
            logger.debug('Reserve POS', selectedItems, dateRange)

            let saveResult = null
            
            let anonId = undefined
            if (!(session?.user?.id)) {
              anonId = localStorage.getItem('sunbnb-anonId')
              if (!anonId) {
                anonId = uuidv4()
                localStorage.setItem('sunbnb-anonId', anonId)
              }
            }

            saveResult = await saveReservationForMultipleItems({
              from: dateRange.from,
              to: dateRange.to,
              type: 'days',
              siteId: site.id!,
              items: selectedItems,
              userId: session?.user?.id,
              anonId
            })

            logger.debug('Save result POS', saveResult)
            if (saveResult?.status === 'ok' && saveResult.id) {
              dispatch(setValue({ 
                reservationState: site.type === 'unpaid' ? 'complete' : 'processing',
                pendingReservationId: saveResult.id,
                panelBottom: 'bottom-[0px]'
              }))
              if (site.type === 'unpaid') {
                router.push(`/reservations/${saveResult.id}`)
              }
            }

          }
        }>
          PAY
        </Button>
    </div>
  )
}

export default function ReservationView({
  apiKey,
  stripePublicKey,
  site,
  dateRange
} : {
  apiKey: string
  stripePublicKey: string | undefined
  site: SiteProps,
  dateRange: { from: string, to: string }
}) {

  const dispatch = useDispatch()

  const sitesState = useSelector((state: RootState) => state.sites)
  const { reservationState, pendingReservationId } = sitesState

  let focused = sitesState.focused
  let panelBottom = sitesState.panelBottom || '-bottom-[364px]'

  if (!stripePublicKey && site.paymentProvider !== 'mollie') {
    return (
      <div className="flex flex-col items-center justify-center">
        <div>Payment gateway unavailable</div>
      </div>
    )
  }

  const { data: reservation } = useGetReservationByIdQuery({ id: pendingReservationId }, {
    skip: !pendingReservationId
  })

  logger.debug('Reservation By Id POS', pendingReservationId, reservation)

  let selectedItems = sitesState.selectedItems || []

  const totalPrice = selectedItems.reduce((acc: number, item: { price?: number }) => {
    return acc + item.price! || site.price! || 0
  }, 0)

  const previewElem = (
    <div>
      <div className="flex justify-between text-black">
        <div>
          QUANTITY: <b>{selectedItems.length}</b>
        </div>
        <div className="text-center text-[64px] -mt-[20px]">
          {totalPrice} €
        </div>
      </div>
    </div>
  )

  const paymentElem =
    (reservationState === RESERVATION_PROCESSING || reservationState === 'payment_in_progress') ? (
      !reservation ? (
        <div className="flex justify-center mb-[12px] mt-[24px]">
          <CircularProgress />
        </div>
      ) : <PaymentView 
            stripePublicKey={stripePublicKey}
            preview={previewElem}
            reservation={reservation}
            paymentProvider={site.paymentProvider} />

    ) : (
      <div className="mx-[4px] mt-[8px] h-[420px]">
        {
          selectedItems.length > 0 && <div className="mt-[10px]">
            {previewElem}
          </div>

        }
      </div>
    )

  return (
    <div className="relative">
      {
        selectedItems.length === 0 ? (
          <div className="
              absolute
              top-[10px]
              left-1/2
              -translate-x-1/2
              inline-block
              whitespace-nowrap
              z-[1]
              bg-white/60
              py-[6px]
              px-[8px]
              border
              border-blue-400
              rounded-[8px]
              text-md
              text-blue-400
              font-bold
          ">
            Select one or more sunbeds
          </div>
        ) : (
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
              <ReservationButton disabled={selectedItems.length === 0} site={site} dateRange={dateRange} />
            </div>
        )
      }
      <div className="relative"> 
        <div className="
          absolute
          bottom-[10px]
          right-[10px]
          z-[1]
          bg-white/60
          py-[6px]
          px-[8px]
          border
          border-black
          rounded-[8px]
          text-lg
          font-bold
        ">{ site.name }</div>
        <div className="w-full h-screen">
          <SunbedSelection apiKey={apiKey} site={site} />
        </div>
      </div>
      {
        selectedItems.length > 0 && <div style={{ zIndex: 11 }} className={`fixed left-0 w-full bg-white text-white text-center px-2 pb-4
          ${panelBottom} border-t transition-bottom duration-500`}>
          {
            focused ?
              <div className="text-black absolute w-[100px] bg-white rounded-md border" style={{
                left: 'calc(50% - 50px)',
                top: '-15px',
                zIndex: 2
              }}
              onClick={() => {
                dispatch(setValue({ focused: false }))
              }}>
                <KeyboardDoubleArrowDownIcon />
              </div> : null
          }
            { paymentElem }
        </div>
      }
      
      
    </div>
  )
}