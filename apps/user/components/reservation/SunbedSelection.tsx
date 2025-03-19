'use client'

import Image from 'next/image'
import { InventoryItem, MapBounds, SiteProps, WorkingHours } from '@/app/sites/types'
import { useEffect, useState } from 'react'

import { setValue } from '@/store/features/sites/sitesSlice'
import { RootState } from '@/store/store'
import { useSelector, useDispatch } from 'react-redux'
import { 
  useGetAvailabilityBySiteAndTimeRangeQuery
} from '@/store/features/api/apiSlice'
import dayjs, { Dayjs } from 'dayjs'
import { APIProvider, AdvancedMarker, Map } from '@vis.gl/react-google-maps'

import sunbedIcon from './sunbed-icon-transparent.png'

function isSiteOpen(reservationDay: Dayjs, from: Dayjs, to: Dayjs, workingHours: WorkingHours[] | undefined): boolean {

  let notWorkingHours = false
    const reservationWeekDay = reservationDay.day() === 0 ? 7 : reservationDay.day()
    const rdOpeningHours = (workingHours || [])
      .find(wh => wh.day === reservationWeekDay)
    
    const openTime = new Date(rdOpeningHours?.openTime || 0)
    const closeTime = new Date(rdOpeningHours?.closeTime || 0)
    
    const openFrom = reservationDay.hour(openTime.getHours()).minute(openTime.getMinutes())
    const openTo = reservationDay.hour(closeTime.getHours()).minute(closeTime.getMinutes())
    notWorkingHours = !rdOpeningHours || dayjs(openFrom).isAfter(from) 
      || dayjs(openTo).isBefore(to)

  return !notWorkingHours

}


export default function SunbedSelection({
  apiKey,
  site
}: {
  apiKey: string
  site: SiteProps
}) {

  const dispatch = useDispatch()
  const sitesState = useSelector((state: RootState) => state.sites)
  const { reservationState, reservationMode } = sitesState

  const [zoom, setZoom] = useState<number>(20)

  console.log('Sites state', sitesState)

  let reservationDay = sitesState.reservationDay || dayjs().toDate()
  let timeRange = sitesState.timeRange || [
    dayjs().add(2, 'hour').toDate().toISOString(),
    dayjs().add(4, 'hour').toDate().toISOString()
  ]

  let dateRange = sitesState.dateRange || [
    dayjs().startOf('day').toISOString(),
    dayjs().add(1, 'day').endOf('day').toISOString().substring(0, 10)
  ]

  let availabilityFrom = dateRange[0]
  let availabilityTo = dateRange[1]
  if (reservationMode === 'hours') {
    console.log('Time range', timeRange)
    availabilityFrom = dayjs(reservationDay)
      .hour(timeRange[0].getHours())
      .minute(timeRange[0].getMinutes())
      .second(timeRange[0].getSeconds()).toISOString()
    availabilityTo = dayjs(reservationDay)
      .hour(timeRange[1].getHours())
      .minute(timeRange[1].getMinutes())
      .second(timeRange[1].getSeconds()).toISOString()
  }


  console.log("site.id:", site?.id);
  console.log("availabilityFrom:", availabilityFrom);
  console.log("availabilityTo:", availabilityTo);
  
  const { 
    data: availabilityResponse, 
    refetch: refetchAvailability,
    status: availabilityStatus 
  } = useGetAvailabilityBySiteAndTimeRangeQuery({
    siteId: site.id,
    from: availabilityFrom,
    to: availabilityTo
  })

  console.log('Availability response updated', availabilityResponse, availabilityStatus)

  
  function isAvailable(item: InventoryItem): boolean {
    if (!availabilityResponse) return false
    return !!availabilityResponse.availability.find(a => a.itemId === item.id && a.available)
  }

  let inventoryItems = site.inventoryItems
  const firstAvailableItem = inventoryItems?.find(item => isAvailable(item))
  let selectedItems = sitesState.selectedItems || []

  useEffect(() => {

    if (!availabilityResponse) return;
  
    // Filter out any items that are no longer available
    const filteredSelection = (selectedItems ?? []).filter((item: InventoryItem) => isAvailable(item))
  
    // If nothing remains, you could automatically select the first available item (or multiple)
    if (!filteredSelection.length) {
      //const firstAvailableItem = inventoryItems?.find(item => isAvailable(item));
      //if (firstAvailableItem) {
      //  dispatch(setValue({ selectedItems: [firstAvailableItem] }));
      //} else {
        // Or dispatch an empty array if no items are available
        dispatch(setValue({ selectedItems: [] }));
      //}
    } else {
      // Keep the valid filtered list
      dispatch(setValue({ selectedItems: filteredSelection }));
    }
   
    if (!sitesState.dateRange) {
      dispatch(setValue({ dateRange: [availabilityFrom, availabilityTo] }))
    }
  
  }, [availabilityResponse]);

  const itemLats = (inventoryItems || []).map(item => Number(item.locationLat));
  const itemLngs = (inventoryItems || []).map(item => Number(item.locationLng));

  const defaultBounds: MapBounds = {
    north: Math.max(...itemLats),
    south: Math.min(...itemLats),
    east: Math.max(...itemLngs),
    west: Math.min(...itemLngs)
  };

  let notWorkingHours = false
  
  if (reservationMode === 'hours' && 
    reservationDay && availabilityFrom && availabilityTo) {
    notWorkingHours = !isSiteOpen(dayjs(reservationDay), dayjs(availabilityFrom), dayjs(availabilityTo), site.workingHours)
  }

  function getScaledSize(zoom: number): number {
    const baseZoom = 20
    const baseSize = 35
    // Adjust scale factor as you like (linear or exponential)
    // return baseSize * Math.pow(1, (zoom - baseZoom) / 2)

    const zoomDiff = zoom - baseZoom
    if (zoomDiff < 0) return baseSize * Math.pow(4, (zoom - baseZoom) / 2)
    else return baseSize * Math.pow(3, (zoom - baseZoom) / 2)

  }
  
  const dynamicSize = getScaledSize(zoom)
  console.log('Dynamic size', dynamicSize)

  return (
    <>
      <APIProvider apiKey={apiKey}>
        <Map mapId={'7a0196a7ba317ea5'}
          defaultZoom={defaultBounds ? undefined : 20}
          defaultCenter={{ lat: Number(site.locationLat), lng: Number(site.locationLng) }}
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

              let bgColor = '' // 'bg-[#ff0000]'
              let borderStyle = 'border border-[1px] border-[#ff0000]'
              let size = dynamicSize
              const itemAvailable = isAvailable(item)
              if (itemAvailable) {
                bgColor = '' // 'bg-[#00ff00]'
                borderStyle = 'border border-[1px] border-[#00ff00]'
                if (selectedItems?.some((selected: { id: string }) => selected.id === item.id)) {
                  bgColor = '' // 'bg-[#0000ff]'
                  borderStyle = 'border border-[4px] border-[#0000ff]'
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
                  
                  <div className={`w-[${size}px] h-[${size}px] flex justify-center items-center`}>
                    
                    <div className={`block ${bgColor} ${borderStyle}`} style={{
                      maxWidth: 'none',
                      height: `${dynamicSize}px`,
                      width: `${dynamicSize}px`,
                      marginTop: `-${(dynamicSize - 40) / 2}px`,
                      ...(item.rotation ? {
                        transform: `rotate(${item.rotation}deg)`,
                        transformOrigin: 'center'
                      } : {})
                    }}>
                      <Image style={{
                        width: '100%'
                      }} src={sunbedIcon} alt="Item" />
                    </div>                
                  </div>
                </AdvancedMarker>
              )}))
          }
        </Map>
      </APIProvider>
    </>
  )

}
