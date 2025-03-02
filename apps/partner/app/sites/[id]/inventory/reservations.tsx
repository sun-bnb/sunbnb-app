import { useState } from 'react'
import Tabs from '@mui/material/Tabs'
import Tab from '@mui/material/Tab'
import { Reservation } from '@/types/shared'
import ReservationListItem from '@/components/reservation/ReservationListItem'

export default function Reservations({ reservations } : { reservations: Reservation[] }) {
  
  const [reservationType, setReservationType] = useState<string>('active')

  const now = new Date()
  const visibleReservations = reservationType === 'active' ?
    reservations.filter(reservation => reservation.to >= now) :
    reservations.filter(reservation => reservation.to < now)
  
  return (
    <div className="container mx-auto">
      <div className="mb-4">
        <Tabs variant="fullWidth" value={reservationType} onChange={(e, value) => {
          setReservationType(value)
        }} aria-label="Reservation type">
          <Tab value="active" label="Active" />
          <Tab value="history" label="History" />
        </Tabs>
      </div> 
      <div className="mt-6 flex flex-wrap">
        <div className="w-full mt-4 text-sm md:text-base">
          {
              (visibleReservations || []).map((reservation, i) => {
                return (
                  <div key={reservation.id} className="border-b-[1px] border-gray-200">
                    <ReservationListItem reservation={reservation} />
                  </div>
                )
              })
          }
        </div>
      </div>
    </div>
  )

}