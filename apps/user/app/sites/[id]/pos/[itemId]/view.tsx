'use client'

import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { InventoryItem, SiteProps } from '@/app/sites/types'
import ReservationView from './Reservation'
import { findAnonReservation, findUserReservation } from '../../actions'


export default function PosView({ items, site, apiKey, stripePublicKey }: { items: InventoryItem[], site: SiteProps, apiKey: string, stripePublicKey: string | undefined }) {

  const router = useRouter()

  const { data: session, status } = useSession()

  const anonId = localStorage.getItem('sunbnb-anonId')

  if (session?.user?.id) {
    findUserReservation(session?.user?.id, items[0]!.id)
      .then((reservation) => {
        if (reservation) {
          router.push(`/reservations/${reservation.id}`)
        }
      })
  } else if (anonId) {
    findAnonReservation(anonId, items[0]!.id)
      .then((reservation) => {
        if (reservation) {
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
            site={site}
            dateRange={{ from: availabilityFrom, to: availabilityTo }}
          />
        </div>
      </div>
    </div>
  )

}