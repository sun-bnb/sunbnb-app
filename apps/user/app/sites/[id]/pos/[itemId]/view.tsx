'use client'

import { InventoryItem } from '@/app/sites/types'
import ReservationView from './Reservation'


export default function PosView({ items, apiKey, stripePublicKey }: { items: InventoryItem[], apiKey: string, stripePublicKey: string | undefined }) {

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);

  let availabilityFrom = startOfDay.toISOString()
  let availabilityTo = endOfDay.toISOString()

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