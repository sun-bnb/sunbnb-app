'use client'

import logger from '@/utils/logger'

import { MapBounds, SiteProps } from '@/app/sites/types'
import { RootState } from '@/store/store'
import { useSelector } from 'react-redux'
import { 
  useGetReservationByIdQuery,
  useGetSiteByIdQuery
} from '@/store/features/api/apiSlice'
import ReservationView from './Reservation'


export default function PosView({ site, apiKey }: { site: SiteProps, apiKey: string }) {

  const sitesState = useSelector((state: RootState) => state.sites)

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  // const endOfDay = new Date();
  // endOfDay.setHours(23, 59, 59, 999);

  let availabilityFrom = startOfDay.toISOString()
  // Same instant as `from` on purpose: for a 'days' booking the server action re-anchors
  // both ends to the venue's civil day (sites/[id]/actions.ts). Availability for the map is
  // fetched by SunbedSelection with its own full-day window, not here.
  let availabilityTo = startOfDay.toISOString()

  

  const { data: fetchedSite, refetch: refetchSite } = useGetSiteByIdQuery({ id: site.id })
  
  const displaySite = fetchedSite || site
  logger.debug('Site view POS', displaySite)

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
            site={fetchedSite || site}
            dateRange={{ from: availabilityFrom, to: availabilityTo }}
          />
        </div>
      </div>
    </div>
  )

}