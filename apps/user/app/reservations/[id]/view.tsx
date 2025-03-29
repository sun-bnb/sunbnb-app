'use client'

import { Reservation, SiteProps } from '@/app/sites/types'
import dayjs, { Dayjs } from 'dayjs'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import { cancelReservation } from './actions'
import RservationConfirmationView from '@/components/reservation/confirmation/view'
import ReservationConfirmationView from '@/components/reservation/confirmation/view'

export default function ReservationView({ reservation }: { reservation: Reservation }) {

  return (
    <div className="py-4 px-2">
      <ReservationConfirmationView reservation={reservation} />
    </div>
  )

}