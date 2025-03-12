'use client'

import { InventoryItem, MapBounds, SiteProps } from '@/app/sites/types'
import Image from 'next/image'
import { setValue } from '@/store/features/sites/sitesSlice'
import { RootState } from '@/store/store'
import { useSelector, useDispatch } from 'react-redux'
import { 
  useGetAvailabilityBySiteAndTimeRangeQuery,
  useGetReservationByIdQuery,
  useGetSiteByIdQuery
} from '@/store/features/api/apiSlice'
import { APIProvider, AdvancedMarker, Map } from '@vis.gl/react-google-maps'
import sunbedIcon from './sunbed-icon-transparent.png'
import { useState } from 'react'

export default function PosView({ site, apiKey }: { site: SiteProps, apiKey: string }) {

  const dispatch = useDispatch()
  const sitesState = useSelector((state: RootState) => state.sites)

  const [zoom, setZoom] = useState<number>(20)

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
  
  function getScaledSize(zoom: number): number {
    const baseZoom = 20
    const baseSize = 45
    // Adjust scale factor as you like (linear or exponential)
    return baseSize * Math.pow(2, (zoom - baseZoom) / 2)
  }

  function isAvailable(item: InventoryItem): boolean {
    if (!availabilityResponse) return false
    return !!availabilityResponse.availability.find(a => a.itemId === item.id && a.available)
  }
  
  const itemLats = (inventoryItems || []).map(item => Number(item.locationLat));
  const itemLngs = (inventoryItems || []).map(item => Number(item.locationLng));
  const defaultBounds: MapBounds = {
    north: Math.max(...itemLats),
    south: Math.min(...itemLats),
    east: Math.max(...itemLngs),
    west: Math.min(...itemLngs)
  }

  console.log('Def bounds', defaultBounds)

  const dynamicSize = getScaledSize(zoom)

  console.log('Dynamic size', dynamicSize)

  return (
    <div className="relative">
      
      <div className="
        absolute
        bottom-[10px]
        right-[10px]
        z-[1]
        bg-white/60
        py-[6px]
        px-[8px]
        border
        border-black
        rounded-[8px]
        text-lg
        font-bold
      ">{ site.name }</div>
      <div className="w-full h-screen">
        <APIProvider apiKey={apiKey}>
          <Map mapId={'7a0196a7ba317ea5'}
            defaultZoom={defaultBounds ? undefined : 20}
            defaultCenter={{ lat: Number(displaySite.locationLat), lng: Number(displaySite.locationLng) }}
            defaultBounds={defaultBounds}
            gestureHandling={'greedy'}
            disableDefaultUI={true}
            onZoomChanged={(mapInstance) => {
              const newZoom = mapInstance.map.getZoom()
              console.log('Zoom changed', newZoom)
              setZoom(newZoom || 20)
            }}
            onClick={(e) => {
              console.log('Map click', e)
            }}
          >
            {
              ((inventoryItems || []).map(item => {

                let bgColor = 'bg-gray-200'
                let borderStyle = ''
                let size = 40
                const itemAvailable = isAvailable(item)
                if (itemAvailable) {
                  bgColor = ''
                  if (selectedItems?.some((selected: { id: string }) => selected.id === item.id)) {
                    bgColor = ''
                    borderStyle = 'border border-[4px] border-red-800'
                    size = dynamicSize
                  }
                }
                
                
                return (
                  <AdvancedMarker key={item.id}
                    position={{ lat: Number(item.locationLat), lng: Number(item.locationLng) }}
                    onClick={() => {

                      if (itemAvailable) {
                        const alreadySelected = selectedItems?.some(
                          (selected: { id: string }) => selected.id === item.id
                        )
                    
                        let updatedItems;
                        if (alreadySelected) {
                          updatedItems = selectedItems.filter(
                            (selected: { id: string }) => selected.id !== item.id
                          )
                        } else {
                          updatedItems = selectedItems ? [...selectedItems, item] : [item]
                        }
                    
                        dispatch(
                          setValue({
                            selectedItems: updatedItems,
                          })
                        )
                      }
                    }}>
                    
                    <div className={`w-[${size}px] h-[${size}px] ${bgColor} ${borderStyle} rounded-full flex justify-center items-center`}>
                      <Image style={ item.rotation ? {
                        transform: `rotate(${item.rotation}deg)`,
                        transformOrigin: 'center',
                        display: 'block',
                        maxWidth: 'none',
                        height: 'auto',
                        width: `${dynamicSize}px`,
                        marginTop: `-${(dynamicSize - 40) / 2}px`
                      } : {}} src={sunbedIcon} alt="Item" />
                    </div>
                  </AdvancedMarker>
                )}))
            }
          </Map>
        </APIProvider>
      </div>
    </div>
  )

}
