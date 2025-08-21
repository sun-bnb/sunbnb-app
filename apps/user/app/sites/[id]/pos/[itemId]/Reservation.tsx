'use client'

import logger from '@/utils/logger'

import { v4 as uuidv4 } from 'uuid'
import Image from 'next/image'
import { InventoryItem, SiteProps } from '@/app/sites/types'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import CheckIcon from '@mui/icons-material/Check'
import BlockIcon from '@mui/icons-material/Block'
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
import { saveReservationForMultipleItems } from '../../actions'
import PaymentView from '@/app/payment/Payment'
import sunbedIcon from './sunbed-icon-transparent.png'
import sunbedPerfIcon from '@/components/reservation/sunbed-perforated-transparent.png'
import sunshadeIcon from '@/components/reservation/sunshade-transparent.png'
import { useRouter } from 'next/navigation'

// A helper function that checks if an item is free for the current day
function isItemAvailableToday(item: InventoryItem): boolean {

  if (item.status !== 'active') return false
  
  if (!item.reservations || item.reservations.length === 0) {
    // No reservations, so definitely available
    return true;
  }

  // We'll consider "today" from midnight to midnight (ignoring times)
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // If there's at least one reservation whose from <= today <= to, the item is NOT available
  return !item.reservations.some((res) => {
    const fromDate = new Date(res.from);
    const toDate = new Date(res.to);

    // Zero out hours if ignoring time portion
    fromDate.setHours(0, 0, 0, 0);
    toDate.setHours(0, 0, 0, 0);

    return today >= fromDate && today <= toDate;
  });
}


function ReservationButton({
  disabled,
  items,
  site,
  dateRange
}: {
  disabled: boolean,
  items: InventoryItem[],
  site: SiteProps,
  dateRange: { from: string, to: string }
}) {

  const { data: session } = useSession()

  const dispatch = useDispatch();
  const router = useRouter()
  const sitesState = useSelector((state: RootState) => state.sites)

  let selectedItems = items

  return (
    <div className="mt-[8px]">
      <Button style={{
        backgroundColor: disabled ? '#bbbbbb' : 'white',
        color: disabled ? '#888888' : '#1976d2',
        height: '45px'
      }} variant="contained"
        fullWidth={true}
        disabled={disabled}
        onClick={
          async () => {
            dispatch(setValue({ reservationState: 'saving' }))
            logger.debug('Reserve ITEM', selectedItems, dateRange)

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
              siteId: items[0]!.site?.id!,
              items: selectedItems,
              status: site.type === 'unpaid' ? 'complete' : 'pending',
              userId: session?.user?.id,
              anonId
            })

            logger.debug('Save result ITEM', saveResult)
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
          RESERVE
        </Button>
    </div>
  )
}

export default function ReservationView({
  apiKey,
  stripePublicKey,
  items,
  site,
  dateRange
} : {
  apiKey: string
  stripePublicKey: string | undefined
  items: InventoryItem[],
  site: SiteProps,
  dateRange: { from: string, to: string }
}) {

  const dispatch = useDispatch()

  const sitesState = useSelector((state: RootState) => state.sites)
  const { reservationState, pendingReservationId } = sitesState

  let focused = sitesState.focused
  let panelBottom = sitesState.panelBottom || '-bottom-[364px]'

  if (!stripePublicKey) {
    return (
      <div className="flex flex-col items-center justify-center">
        <div>Payment gateway unavailable</div>
      </div>
    )
  }

  const { data: reservation } = useGetReservationByIdQuery({ id: pendingReservationId }, {
    skip: !pendingReservationId
  })

  logger.debug('Reservation By Id ITEM', pendingReservationId, reservation)

  let selectedItems = items

  let totalPrice = 0
  for (let item of selectedItems) {
    totalPrice += item.price! || 0
  }

  const dateStr = new Date().toISOString().substring(0, 10)

  let isAvailable = true
  for (let item of selectedItems) {
    if (!isItemAvailableToday(item)) {
      isAvailable = false
      break
    }
  }

  const previewElem = (
    <div>
      <div className={`flex justify-between ${!reservation ? 'text-white' : 'text-black'}`}>
        <div className="flex justify-center">
          {
            !reservation ? 
              <div className="w-[200px]">
                <ReservationButton disabled={!isAvailable || selectedItems.length === 0} items={items} site={site} dateRange={dateRange} /> 
              </div>:
              <div className="block mt-[6px] ml-[6px]">
                <div className="text-left">DATE: <b>{dateStr}</b></div>
                {
                  items.length === 1 ? 
                    <div className="text-left">SEAT NUMBER: <b>{items[0]!.number}</b></div> :
                    <div className="text-left">SEAT NUMBERS: <b>{items.map(item => item.number).join(', ')}</b></div>
                }
                
              </div>
          }
          
        </div>
        <div className="text-center text-[64px] -mt-[20px]">
          {totalPrice} €
        </div>
      </div>
    </div>
  )

  const paymentElem =
    (reservationState === 'processing' || reservationState === 'payment_in_progress') ? (
      !reservation ? (
        <div className="flex justify-center mb-[12px] mt-[24px]">
          <CircularProgress />
        </div>
      ) : <PaymentView 
            stripePublicKey={stripePublicKey}
            preview={previewElem}
            reservation={reservation} />

    ) : (
      <div className="mx-[4px] mt-[8px] h-[420px]">
        {
          selectedItems.length > 0 && <div className="mt-[10px]">
            {previewElem}
          </div>

        }
      </div>
    )
  
  const bgColor = !reservation ? 'bg-[#1976d2]' : 'bg-white'

  return (
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
          {
            items.length === 1 ?
              <div className="text-[rgb(142,114,49)] ">
                SEAT {items[0]!.number}
              </div> :
              <div className="text-[rgb(142,114,49)] ">
                SEATS {items.map(item => item.number).join(', ')}
              </div>
          }
          
        </div>
        <div className="flex justify-center mt-[16px]">
          {
            items.length === 1 ?
              <Image src={sunbedIcon} alt="Sunbed icon" width={300} /> :
              <div className="relative h-[300px] w-[300px] ml-[16px] mt-[8px]">
                <Image src={sunbedPerfIcon} alt="Sunbed icon" width={150} style={{
                  position: 'absolute',
                  top: '0px',
                  left: '0px'
                }} />
                <Image src={sunbedPerfIcon} alt="Sunbed icon" width={150} style={{
                  position: 'absolute',
                  top: '0px',
                  right: '0px'
                }} />
                <Image src={sunshadeIcon} alt="Sunshade icon" width={200} style={{
                  position: 'absolute',
                  top: '-25px',
                  left: '50px'
                }}/>
              </div>
          }
          
        </div>
        <div className="flex justify-center mt-[6px]">
          <Alert className="w-[200px] flex justify-center" icon={
            isAvailable ? 
              <CheckIcon fontSize="inherit" /> :
              <BlockIcon fontSize="inherit" />
            } severity={ isAvailable ? 'success' : 'error' }>
            { isAvailable ? 'Available' : 'Reserved' }
          </Alert>
        </div>
      </div>
      {
        selectedItems.length > 0 && <div style={{ zIndex: 11 }} className={`fixed left-0 w-full ${bgColor} text-white text-center px-2 pb-4
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