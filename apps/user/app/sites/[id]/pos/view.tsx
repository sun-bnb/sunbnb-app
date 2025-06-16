'use client'

import logger from '@/utils/logger'

import { MapBounds, SiteProps } from '@/app/sites/types'
import { RootState } from '@/store/store'
import { useSelector } from 'react-redux'
import { 
  useGetAvailabilityBySiteAndTimeRangeQuery,
  useGetReservationByIdQuery,
  useGetSiteByIdQuery
} from '@/store/features/api/apiSlice'
import ReservationView from './Reservation'
import { useRouter } from 'next/router'
import { findAnonReservation } from '../actions'


export default function PosView({ site, apiKey, stripePublicKey }: { site: SiteProps, apiKey: string, stripePublicKey: string | undefined }) {

  const sitesState = useSelector((state: RootState) => state.sites)

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  // const endOfDay = new Date();
  // endOfDay.setHours(23, 59, 59, 999);

  let availabilityFrom = startOfDay.toISOString()
  let availabilityTo = startOfDay.toISOString() // The time is adjusted in the server action

  const { data: availabilityResponse, refetch: refetchAvailability } = useGetAvailabilityBySiteAndTimeRangeQuery({ 
    siteId: site.id,
    from: availabilityFrom,
    to: availabilityTo
  })
  

  const { data: fetchedSite, refetch: refetchSite } = useGetSiteByIdQuery({ id: site.id })
  
  const displaySite = fetchedSite || site
  logger.debug('Site view POS', displaySite, availabilityResponse)

  let inventoryItems = displaySite.inventoryItems
  
  const itemLats = (inventoryItems || []).map(item => Number(item.locationLat));
  const itemLngs = (inventoryItems || []).map(item => Number(item.locationLng));
  const defaultBounds: MapBounds = {
    north: Math.max(...itemLats),
    south: Math.min(...itemLats),
    east: Math.max(...itemLngs),
    west: Math.min(...itemLngs)
  }

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

  logger.debug('Default bounds POS', defaultBounds)

  return (
    <div>
      <div>
        <div>
          <ReservationView 
            apiKey={apiKey} 
            stripePublicKey={stripePublicKey} 
            site={fetchedSite || site}
            dateRange={{ from: availabilityFrom, to: availabilityTo }}
          />
        </div>
      </div>
    </div>
  )

}