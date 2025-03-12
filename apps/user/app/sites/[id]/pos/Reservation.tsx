'use client'

import { SiteProps } from '@/app/sites/types'
import Button from '@mui/material/Button'
import InputLabel from '@mui/material/InputLabel'
import MenuItem from '@mui/material/MenuItem'
import FormControl from '@mui/material/FormControl'
import Select from '@mui/material/Select'
import CircularProgress from '@mui/material/CircularProgress'
import React, { useState } from 'react'
import { useSession } from 'next-auth/react'

import { setValue } from '@/store/features/sites/sitesSlice'
import { RootState } from '@/store/store'
import { useDispatch, useSelector } from 'react-redux'
import {
  useGetReservationByIdQuery
} from '@/store/features/api/apiSlice'
import dayjs, { Dayjs } from 'dayjs'
import SunbedSelectionComponent from './SunbedSelection'
import { saveReservation, saveReservationForMultipleItems } from '../actions'
import PaymentView from '@/app/payment/Payment'

function PaymentMethodSelection() {


  const [ paymentMethod, setPaymentMethod ] = useState('0001')

  return (
    <div className="w-full mt-4">
      <FormControl size="medium" fullWidth={true}>
        <InputLabel>Payment method</InputLabel>
        <Select
          labelId="demo-select-small-label"
          id="demo-select-small"
          value={paymentMethod}
          label="Payment method"
          onChange={(...args) => {
            console.log('Payment method', args)
          }}
          MenuProps={{
            sx: {
              transform: "translateX(-8px)", // Move the dropdown 10px to the left
            }
          }}
          sx={{
            '& .MuiSelect-select': {
              display: 'flex',
              justifyContent: 'center'
            }
            }}
        >
          
          <MenuItem value={'0001'} sx={{ display: 'flex', justifyContent: 'center' }}>VISA 4398 1206 7404 9258</MenuItem>
          <MenuItem value="" sx={{ display: 'flex', justifyContent: 'center' }}>
            <em>+ Add payment method</em>
          </MenuItem>
        </Select>
      </FormControl>
    </div>
  )

}

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
            console.log('Reserve', selectedItems)

            let saveResult = null
            
            console.log('Save reservation', dateRange)
            saveResult = await saveReservationForMultipleItems({
              from: dateRange.from,
              to: dateRange.to,
              type: 'days',
              siteId: site.id!,
              itemIds: selectedItems.map((item: { id: string}) => item.id),
              userId: session?.user?.id
            })

            console.log('Save result', saveResult)
            if (saveResult?.status === 'ok' && saveResult.id) {
              dispatch(setValue({ 
                reservationState: 'processing',
                pendingReservationId: saveResult.id
              }))
            }

          }
        }>
          PAY
        </Button>
    </div>
  )
}

function ItemSelection({ apiKey, site } : { apiKey: string, site: SiteProps }) {

  console.log('Item selection', apiKey, site)

  return (
    <>
      <SunbedSelectionComponent apiKey={apiKey} site={site} />
    </>
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

  const sitesState = useSelector((state: RootState) => state.sites)
  const { reservationState, pendingReservationId } = sitesState

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

  console.log('Reservation By Id', pendingReservationId, reservation)

  let selectedItems = sitesState.selectedItems || []

  const totalPrice = selectedItems.reduce((acc: number, item: { price: number }) => {
    return acc + site.price! || 0
  }, 0)

  const paymentElem =
    (reservationState === 'processing' || reservationState === 'payment_in_progress') ? (
      !reservation ? (
        <div className="flex justify-center mb-[12px] mt-[12px]">
          <CircularProgress />
        </div>
      ) : <PaymentView stripePublicKey={stripePublicKey} reservation={reservation} completeUrl="/payment/complete/pos"/>

    ) : (
      <div className="mx-[4px] mt-[8px]">
        {
          selectedItems.length > 0 ? (
            <div>
              <div className="flex justify-between">
                <div>
                  QUANTITY: <b>{selectedItems.length}</b>
                </div>
              </div>
              <div className="text-center text-[96px]">
                {totalPrice} €
              </div>
            </div>
          ) : (
            <div className="text-center my-[12px]">
              SELECT SUNBEDS AND PAY
            </div>
          )

        }
        
        <div>
          <ReservationButton disabled={selectedItems.length === 0} site={site} dateRange={dateRange} />
        </div>
      </div>
    )

  return (
    <>
      <ItemSelection apiKey={apiKey} site={site} />
      { paymentElem}
    </>
  )
}