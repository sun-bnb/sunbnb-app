'use client'

import Tabs from '@mui/material/Tabs'
import { useState } from 'react'
import Tab from '@mui/material/Tab'
import { Reservation } from '@/app/sites/types'
import ReservationItem from '@/components/reservation/ReservationItem'

export default function Reservations({ reservations }: { reservations: Reservation[] }) {

  const [reservationType, setReservationType] = useState<string>('active')

  const now = new Date()
  const visibleReservations = reservationType === 'active' ?
    reservations.filter(reservation => reservation.to >= now) :
    reservations.filter(reservation => reservation.to < now)
    
  return (
    <>
      <div className="mb-4">
        <Tabs variant="fullWidth" value={reservationType} onChange={(e, value) => {
          setReservationType(value)
        }} aria-label="Reservation type">
          <Tab value="active" label="Active" />
          <Tab value="history" label="History" />
        </Tabs>
      </div> 
      <div className="px-2 py-4">
        {
          visibleReservations.map(reservation => {
            return (
              <div key={reservation.id}><ReservationItem reservation={reservation} /></div>
            )
          })
        }
      </div>
    </>
  )

}