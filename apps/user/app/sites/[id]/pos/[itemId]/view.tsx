'use client'

import { useRouter } from 'next/navigation'
import { InventoryItem } from '@/app/sites/types'
import ReservationView from './Reservation'
import { findAnonReservation } from '../../actions'


export default function PosView({ items, apiKey, stripePublicKey }: { items: InventoryItem[], apiKey: string, stripePublicKey: string | undefined }) {

  const router = useRouter()

  const anonId = localStorage.getItem('sunbnb-anonId')

  if (anonId) {
    findAnonReservation(anonId, items[0]!.id)
      .then((reservation) => {
        if (reservation) {
          console.log('Found reservation', reservation)
          router.push(`/reservations/${reservation.id}?anonId=${anonId}`)
        }
      })
  }

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  // const endOfDay = new Date();
  // endOfDay.setHours(23, 59, 59, 999);

  let availabilityFrom = startOfDay.toISOString()
  let availabilityTo = startOfDay.toISOString() // The time is adjusted in the server action

  if (!stripePublicKey) {
    return (
      <div className="flex flex-col items-center justify-center">
        <div>Payment gateway unavailable</div>
      </div>
    )
  }

  return (
    <div>
      <div>
        <div>
          <ReservationView 
            apiKey={apiKey} 
            stripePublicKey={stripePublicKey} 
            items={items}
            dateRange={{ from: availabilityFrom, to: availabilityTo }}
          />
        </div>
      </div>
    </div>
  )

}