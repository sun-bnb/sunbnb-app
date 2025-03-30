'use client'

import { InventoryItem } from '@/app/sites/types'
import { RootState } from '@/store/store'
import { useSelector, useDispatch } from 'react-redux'
import { 
  useGetAvailabilityBySiteAndTimeRangeQuery
} from '@/store/features/api/apiSlice'
import ReservationView from './Reservation'


export default function PosView({ item, apiKey, stripePublicKey }: { item: InventoryItem, apiKey: string, stripePublicKey: string | undefined }) {

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
            item={item}
            dateRange={{ from: availabilityFrom, to: availabilityTo }}
          />
        </div>
      </div>
    </div>
  )

}