'use client'

import Image from 'next/image'
import { useEffect, useState } from 'react'
import { InventoryItem, MapBounds, SiteProps, WorkingHours } from '@/app/sites/types'
import { useSelector, useDispatch } from 'react-redux'
import { setValue } from '@/store/features/sites/sitesSlice'
import { RootState } from '@/store/store'
import { useGetAvailabilityBySiteAndTimeRangeQuery } from '@/store/features/api/apiSlice'
import dayjs, { Dayjs } from 'dayjs'
import { APIProvider, AdvancedMarker, Map } from '@vis.gl/react-google-maps'
import sunbedIcon from './sunbed-perforated-transparent.png'
import sunshadeIcon from './sunshade-transparent.png'
import beachTowelIcon from './beach-towel-transparent.png'

/** Helper: Check if the site is open on a given day and time range */
function isSiteOpen(
  reservationDay: Dayjs,
  from: Dayjs,
  to: Dayjs,
  workingHours: WorkingHours[] | undefined
): boolean {
  const reservationWeekDay = reservationDay.day() === 0 ? 7 : reservationDay.day()
  const rdOpeningHours = (workingHours || []).find(wh => wh.day === reservationWeekDay)
  const openTime = new Date(rdOpeningHours?.openTime || 0)
  const closeTime = new Date(rdOpeningHours?.closeTime || 0)
  const openFrom = reservationDay.hour(openTime.getHours()).minute(openTime.getMinutes())
  const openTo = reservationDay.hour(closeTime.getHours()).minute(closeTime.getMinutes())
  const notWorkingHours = !rdOpeningHours || dayjs(openFrom).isAfter(from) || dayjs(openTo).isBefore(to)
  return !notWorkingHours
}

/** Helper: Return the paired InventoryItem, if any */
const getPairedItem = (item: InventoryItem): { id: string; } | null | undefined =>
  item.pair || item.pairedBy

/** Scaling function: Adjust the marker size based on the physical length of the sunbed.
 *  We assume a physical sunbed length of 2 meters.
 *  The Google Maps resolution (meters per pixel) at a given zoom level is approximated by:
 *      resolution = 156543.03392 / (2^zoom)
 *  Thus, the marker size (in pixels) is:
 *      size = physicalLength / resolution
 */
function getScaledSize(zoom: number): number {
  const physicalLength = 3.5; // in meters; adjust if needed for your actual sunbed size
  const metersPerPixel = 156543.03392 / Math.pow(2, zoom);
  return physicalLength / metersPerPixel;
}

/** Reusable marker component for rendering a sunbed on the map */
interface SiteSunbedMarkerProps {
  item: InventoryItem
  dynamicSize: number
  zoom: number
  isSelected: boolean
  available: boolean
  onClick: () => void
}


const SiteSunbedMarker: React.FC<SiteSunbedMarkerProps> = ({
  item,
  dynamicSize,
  zoom,
  isSelected,
  available,
  onClick,
}) => {

  const beachTowelImage = <Image 
    src={beachTowelIcon} alt="Towel" height={dynamicSize / 2}
    style={{
      marginTop: `-${dynamicSize / 2.8}px`,
      transform: `rotate(30deg)`, transformOrigin: 'center'
    }} />

  // Existing border style logic.
  const borderThickness = available && isSelected ? 4 : 1;
  const backgroundColor = available ? (isSelected ? 'blue' : 'green') : 'red';
  const beachTowel = available ? (
    isSelected ? 
      beachTowelImage : 
      null
    ) : beachTowelImage;

  const size = dynamicSize; // use dynamicSize as the base container size

  // --- NEW: Add shade circle ---
  // Use 30% of dynamicSize as the shade diameter.
  const shadeDiameter = dynamicSize * 0.6;
  // Determine if this sunbed is paired.
  const isPaired = Boolean(item.pair || item.pairedBy);
  // Assume that if the item has a pairedBy field, it is the primary in the pair.
  const isPrimary = Boolean(item.pairedBy);

  // Compute the shade style for a single bed or primary in a pair.
  let shadeStyle: React.CSSProperties = {};
  if (isPaired) {
    // For paired beds, only the primary gets the shade (upper, centered).
    shadeStyle = {
      position: 'absolute',
      left: `${(dynamicSize / 4)}px`,
      top: '0px'
    };
  } else {
    // For single beds, position the shade on the left-center.
    shadeStyle = {
      position: 'absolute',
      left: `${(dynamicSize / 4)}px`,
      top: '0px'
    };
  }
  // --- END NEW ---

  const markerContent = zoom > 19 ? (

    <div className="relative block"
        style={{
          maxWidth: 'none',
          height: `${dynamicSize * (zoom > 20 ? 1 : 1.1)}px`,
          width: `${dynamicSize / (zoom > 20 ? 2.1 : 1.9)}px`,
          border: `1px solid black`,
          ...(item.rotation
            ? { transform: `rotate(${item.rotation}deg)`, transformOrigin: 'center' }
            : {})
      }}>
        <div
          className="absolute"
          style={{
            height: '100%',
            width: '100%',
            backgroundColor: backgroundColor,
            zIndex: 1
          }}
        >
          <Image src={sunbedIcon} alt="Sunbed" height={dynamicSize} />
          { beachTowel }
        </div>
        
        {(!isPaired || (isPaired && isPrimary)) && (
          <div className="absolute"
            style={{
              ...shadeStyle,
              width: `${shadeDiameter}px`,
              height: `${shadeDiameter}px`,
              borderRadius: '50%',
              backgroundColor: 'rgba(0, 0, 0, 0.3)',
              zIndex: 10
            }}
          >
            <Image 
              src={sunshadeIcon} 
              alt="Sunshade" 
              height={dynamicSize} 
              style={{
                marginTop: `-${(dynamicSize - shadeDiameter) / 2}px`,
                marginLeft: `-${(dynamicSize - shadeDiameter) / 3}px`
              }} />
          </div>
        )}
      </div>

  ) : (

    <div className="relative block"
        style={{
          maxWidth: 'none',
          height: `${dynamicSize}px`,
          width: `${dynamicSize / 2.1}px`,
          border: `1px solid black`,
          backgroundColor: backgroundColor,
          ...(item.rotation
            ? { transform: `rotate(${item.rotation}deg)`, transformOrigin: 'center' }
            : {})
      }}></div>
  
  )

  return (
    <AdvancedMarker
      key={item.id}
      position={{ lat: Number(item.locationLat), lng: Number(item.locationLng) }}
      onClick={onClick}
      zIndex={isPaired && isPrimary ? 10 : 1}
    >
      {markerContent}
    </AdvancedMarker>
  );
};


/** Main SunbedSelection Component */
export default function SunbedSelection({
  apiKey,
  site,
}: {
  apiKey: string
  site: SiteProps
}) {
  const dispatch = useDispatch()
  const sitesState = useSelector((state: RootState) => state.sites)
  const { reservationState, reservationMode, selectedItems } = sitesState

  const [zoom, setZoom] = useState<number>(20)

  // Calculate reservation day, timeRange, dateRange from state or defaults
  const reservationDay = sitesState.reservationDay || dayjs().toDate()
  const timeRange = sitesState.timeRange || [
    dayjs().add(2, 'hour').toDate().toISOString(),
    dayjs().add(4, 'hour').toDate().toISOString(),
  ]
  const dateRange = sitesState.dateRange || [
    dayjs().startOf('day').toISOString(),
    dayjs().add(1, 'day').endOf('day').toISOString().substring(0, 10),
  ]
  let availabilityFrom = dateRange[0]
  let availabilityTo = dateRange[1]
  if (reservationMode === 'hours') {
    availabilityFrom = dayjs(reservationDay)
      .hour(timeRange[0].getHours())
      .minute(timeRange[0].getMinutes())
      .second(timeRange[0].getSeconds())
      .toISOString()
    availabilityTo = dayjs(reservationDay)
      .hour(timeRange[1].getHours())
      .minute(timeRange[1].getMinutes())
      .second(timeRange[1].getSeconds())
      .toISOString()
  }

  const { data: availabilityResponse, status: availabilityStatus } =
    useGetAvailabilityBySiteAndTimeRangeQuery({
      siteId: site.id,
      from: availabilityFrom,
      to: availabilityTo,
    })

  // isAvailable: returns true if the given item is available per the API response.
  const isAvailable = (item: InventoryItem): boolean => {
    if (!availabilityResponse) return false
    return !!availabilityResponse.availability.find(
      a => a.itemId === item.id && a.available
    )
  }

  const inventoryItems = site.inventoryItems

  // useEffect to update selected items based on availability.
  useEffect(() => {
    if (!availabilityResponse) return

    const filteredSelection = (selectedItems ?? []).filter(
      (item: InventoryItem) => isAvailable(item)
    )
    if (!filteredSelection.length) {
      dispatch(setValue({ selectedItems: [] }))
    } else {
      dispatch(setValue({ selectedItems: filteredSelection }))
    }
    if (!sitesState.dateRange) {
      dispatch(setValue({ dateRange: [availabilityFrom, availabilityTo] }))
    }
  }, [availabilityResponse])

  // Calculate map bounds based on inventory item positions.
  const itemLats = (inventoryItems || []).map(item => Number(item.locationLat))
  const itemLngs = (inventoryItems || []).map(item => Number(item.locationLng))
  const defaultBounds: MapBounds = {
    north: Math.max(...itemLats),
    south: Math.min(...itemLats),
    east: Math.max(...itemLngs),
    west: Math.min(...itemLngs),
  }

  let notWorkingHours = false
  if (reservationMode === 'hours' && reservationDay && availabilityFrom && availabilityTo) {
    notWorkingHours = !isSiteOpen(
      dayjs(reservationDay),
      dayjs(availabilityFrom),
      dayjs(availabilityTo),
      site.workingHours
    )
  }

  const dynamicSize = getScaledSize(zoom)

  // Toggle selection: if an item is available, toggle its selection state. If pairing is defined, include its pair.
  const toggleSelection = (item: InventoryItem): void => {
    if (!isAvailable(item)) return
    const alreadySelected = selectedItems?.some(
      (selected: { id: string }) => selected.id === item.id
    )
    let updatedItems = [...(selectedItems || [])]
    if (alreadySelected) {
      updatedItems = updatedItems.filter((selected: { id: string }) => selected.id !== item.id)
      const pairItem = getPairedItem(item)
      if (pairItem) {
        updatedItems = updatedItems.filter((selected: { id: string }) => selected.id !== pairItem.id)
      }
    } else {
      updatedItems.push(item)
      const pairItem = getPairedItem(item)
      if (pairItem && !updatedItems.some((selected: { id: string }) => selected.id === pairItem.id)) {
        updatedItems.push(pairItem)
      }
    }
    dispatch(setValue({ selectedItems: updatedItems }))
  }

  return (
    <>
      <APIProvider apiKey={apiKey}>
        <Map
          mapId={'7a0196a7ba317ea5'}
          defaultZoom={defaultBounds ? undefined : 20}
          defaultCenter={{
            lat: Number(site.locationLat),
            lng: Number(site.locationLng),
          }}
          defaultBounds={defaultBounds}
          gestureHandling="greedy"
          disableDefaultUI={true}
          onZoomChanged={mapInstance => {
            const newZoom = mapInstance.map.getZoom()
            console.log('Zoom changed', newZoom)
            setZoom(newZoom || 20)
          }}
          onClick={e => {
            console.log('Map click', e)
          }}
        >
          {(inventoryItems || []).map(item => {
            const available = isAvailable(item)
            const isSelected = selectedItems?.some(
              (selected: { id: string }) => selected.id === item.id
            )
            return (
              <SiteSunbedMarker
                key={item.id}
                item={item}
                dynamicSize={dynamicSize}
                zoom={zoom}
                isSelected={isSelected}
                available={available}
                onClick={() => toggleSelection(item)}
              />
            )
          })}
        </Map>
      </APIProvider>
    </>
  )
}
