'use client'

import Divider from '@mui/material/Divider'
import dayjs from 'dayjs'
import { Reservation } from '../sites/types'


export default function ReservationItem({
  reservation
} : {
  reservation: Reservation
}) {


  const dateRangeFrom = dayjs(reservation.from).format('ddd, D MMM YYYY')
  const dateRangeTo = dayjs(reservation.to).format('ddd, D MMM YYYY')

  return (
    <div className="px-1 align-center mt-2 pb-1 text-black">
      <div className="text-md">
        <div className="flex">
          <div className="mr-1">{dateRangeFrom}</div>
          <div>-</div>
          <div className="ml-1">{dateRangeTo}</div>
        </div>
      </div>
      <Divider>
      </Divider>
      <div className="text-right">
        <b>Total: {reservation.paymentAmount} €</b>
      </div>
    </div>
  )

}