'use client'

import { InventoryItem, MapBounds, SiteProps } from '@/app/sites/types'
import { useEffect } from 'react'

import { setValue } from '@/store/features/sites/sitesSlice'
import { RootState } from '@/store/store'
import { useSelector, useDispatch } from 'react-redux'
import { 
  useGetAvailabilityBySiteAndTimeRangeQuery,
  useGetReservationByIdQuery,
  useGetSiteByIdQuery
} from '@/store/features/api/apiSlice'
import PaymentView from '@/app/payment/Payment'
import { APIProvider, AdvancedMarker, Map } from '@vis.gl/react-google-maps'
import ReservationView from './Reservation'
import CircularProgress from '@mui/material/CircularProgress'


export default function PosView({ site, apiKey, stripePublicKey }: { site: SiteProps, apiKey: string, stripePublicKey: string | undefined }) {

  const dispatch = useDispatch()
  const sitesState = useSelector((state: RootState) => state.sites)

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);

  console.log(startOfDay); // e.g. 2025-03-11T00:00:00.000Z
  console.log(endOfDay);   // e.g. 2025-03-11T23:59:59.999Z

  let availabilityFrom = startOfDay.toISOString()
  let availabilityTo = endOfDay.toISOString()

  const { data: availabilityResponse, refetch: refetchAvailability } = useGetAvailabilityBySiteAndTimeRangeQuery({ 
    siteId: site.id,
    from: availabilityFrom,
    to: availabilityTo
  })
  

  const { data: fetchedSite, refetch: refetchSite } = useGetSiteByIdQuery({ id: site.id })
  
  const displaySite = fetchedSite || site
  console.log('Site', displaySite)

  let inventoryItems = displaySite.inventoryItems
  let selectedItems = sitesState.selectedItems || []

  console.log('Availability response', availabilityResponse)
  
  
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

  console.log('Def bounds', defaultBounds)

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