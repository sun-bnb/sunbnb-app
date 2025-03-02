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
import { saveReservation } from './actions'
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
  site
}: {
  disabled: boolean,
  site: SiteProps
}) {

  const { data: session } = useSession()

  const dispatch = useDispatch();
  const sitesState = useSelector((state: RootState) => state.sites)
  const { reservationState, reservationMode, selectedItem } = sitesState

  let reservationDay = dayjs(sitesState.reservationDay)
  let timeRange = sitesState.timeRange ? [dayjs(sitesState.timeRange[0]), dayjs(sitesState.timeRange[1])] : []
  let dateRange = sitesState.dateRange ? [dayjs(sitesState.dateRange[0]), dayjs(sitesState.dateRange[1])] : []

  return (
    <div className="mt-[10px]">
      <Button variant="contained" 
        fullWidth={true}
        disabled={disabled}
        onClick={
          async () => {
            dispatch(setValue({ reservationState: 'saving' }))
            console.log('Reserve', timeRange, selectedItem)

            let saveResult = null
            if (reservationMode === 'hours' && reservationDay && timeRange[0] && timeRange[1]) {
              const from = reservationDay
                .hour(timeRange[0].hour())
                .minute(timeRange[0].minute())
                .second(timeRange[0].second())
                .toDate()
              const to = reservationDay
                .hour(timeRange[1].hour())
                .minute(timeRange[1].minute())
                .second(timeRange[1].second())
                .toDate()
              saveResult = await saveReservation({
                from,
                to,
                type: 'hours',
                siteId: site.id!,
                itemId: selectedItem?.id!,
                userId: session?.user?.id!
              })
            } else if (reservationMode === 'days' && dateRange[0] && dateRange[1]) {
              const from = dateRange[0].toDate()
              const to = dateRange[1].toDate()
              console.log('Save reservation', from, to)
              saveResult = await saveReservation({
                from,
                to,
                type: 'days',
                siteId: site.id!,
                itemId: selectedItem?.id!,
                userId: session?.user?.id!
              })
            }

            console.log('Save result', saveResult)
            if (saveResult?.status === 'ok' && saveResult.id) {
              dispatch(setValue({ 
                reservationState: 'processing',
                pendingReservationId: saveResult.id
              }))
            }

            /*
            refetchAvailability().then(() => {
              console.log('Refetched availability')
            })
            */

          }
        }>
          Reserve
        </Button>
    </div>
  )
}

function ItemSelection({ apiKey, site } : { apiKey: string, site: SiteProps }) {

  console.log('Item selection', apiKey, site)

  return (
    <>
      <SunbedSelectionComponent apiKey={apiKey} site={site} />
      <ReservationButton disabled={false} site={site} />
    </>
  )
}

export default function ReservationView({
  apiKey,
  stripePublicKey,
  site
} : {
  apiKey: string
  stripePublicKey: string | undefined
  site: SiteProps
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

  return (
    <>
      {
        (reservationState === 'processing' || reservationState === 'payment_in_progress') ? (
          !reservation ? (
            <div className="flex justify-center mb-[12px] mt-[12px]">
              <CircularProgress />
            </div>
          ) : <PaymentView stripePublicKey={stripePublicKey} reservation={reservation}/>
         ) : <ItemSelection apiKey={apiKey} site={site} />
      }
    </>
  )
}