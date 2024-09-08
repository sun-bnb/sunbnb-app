'use client'

import { Reservation } from '@/types/shared'
import ReservationComponent from '@/components/reservation/Reservation'


export default function ReservationView({ reservation }: { reservation: Reservation }) {

  return (
    <div className="py-4 px-2 container mx-auto">
      <div>
        <ReservationComponent reservation={reservation} />
      </div>
    </div>
  )

}