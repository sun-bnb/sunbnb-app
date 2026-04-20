'use client'

import Image from 'next/image'
import Chip from '@mui/material/Chip'
import { useEffect, useState } from 'react'
import { InventoryItem, MapBounds, SiteProps, WorkingHours } from '@/app/sites/types'
import { useSelector, useDispatch } from 'react-redux'
import { setValue } from '@/store/features/sites/sitesSlice'
import { RootState } from '@/store/store'
import { useGetAvailabilityBySiteAndTimeRangeQuery } from '@/store/features/api/apiSlice'
import dayjs, { Dayjs } from 'dayjs'
import { APIProvider, AdvancedMarker, Map } from '@vis.gl/react-google-maps'
import { Polygon } from './polygon'
import { getPaddedConvexHull } from '@/utils/geometry'
import sunbedIcon from './sunbed-perforated-transparent.png'
import sunshadeIcon from './sunshade-transparent.png'
import beachTowelIcon from './beach-towel-transparent.png'
import React from 'react'
import { useSession } from 'next-auth/react'
import SchematicSelection from './SchematicSelection'

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
  const physicalLength = 2.1; // in meters; adjust if needed for your actual sunbed size
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
  const SafeAdvancedMarker = AdvancedMarker as unknown as React.ComponentType<any>

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

  const dynamicHeight = dynamicSize * (zoom > 20 ? 1 : 1.1)
  const dynamicWidth = dynamicSize / (zoom > 20 ? 2.1 : 1.9)

  // Compute the shade style for a single bed or primary in a pair.
  let shadeStyle: React.CSSProperties = {};
  if (isPaired) {
    // For paired beds, only the primary gets the shade (upper, centered).
    shadeStyle = {
      position: 'absolute',
      left: `-${dynamicWidth}px`,
      top: '0px'
    };
  } else {
    // For single beds, position the shade on the left-center.
    shadeStyle = {
      position: 'absolute',
      left: `-${dynamicWidth}px`,
      top: '0px'
    };
  }
  // --- END NEW ---

  const markerContent = zoom > 19 ? (

    <div className="relative block"
        style={{
          maxWidth: 'none',
          height: `${dynamicHeight}px`,
          width: `${dynamicWidth}px`,
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
                marginTop: `-${(dynamicHeight - shadeDiameter) / 2}px`,
                marginLeft: `-${(0)}px`
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
    <SafeAdvancedMarker
      key={item.id}
      position={{ lat: Number(item.locationLat), lng: Number(item.locationLng) }}
      onClick={onClick}
      zIndex={isPaired && isPrimary ? 10 : 1}
    >
      {markerContent}
    </SafeAdvancedMarker>
  );
};

interface ParcelShape {
  number: number;
  shape: { lat: number, lng: number }[];
}

/** Main SunbedSelection Component */
function SunbedSelectionGeo({
  apiKey,
  site,
}: {
  apiKey: string
  site: SiteProps
}) {

  const { data: session } = useSession()
  const loggedIn = !!(session?.user?.id)

  const dispatch = useDispatch()
  const sitesState = useSelector((state: RootState) => state.sites)
  const { reservationState, reservationMode, selectedItems } = sitesState

  const [zoom, setZoom] = useState<number>(20)
  const [sunbedParcels, setSunbedParcels] = useState<{ [key: number]: InventoryItem[] }>({})
  const [parcelShapes, setParcelShapes] = useState<ParcelShape[]>([])

  // Calculate reservation day, timeRange, dateRange from state or defaults
  const reservationDay = sitesState.reservationDay || dayjs().toDate()
  const timeRange = sitesState.timeRange || [
    dayjs().add(2, 'hour').toDate().toISOString(),
    dayjs().add(4, 'hour').toDate().toISOString(),
  ]
  const dateRange = sitesState.dateRange || [
    dayjs().startOf('day').toISOString(),
    dayjs().add(1, 'day').endOf('day').toISOString(),
  ]
  let availabilityFrom = dateRange[0]
  let availabilityTo = dateRange[1]
  if (reservationMode === 'hours') {
    const t0 = dayjs(timeRange[0])
    const t1 = dayjs(timeRange[1])
    availabilityFrom = dayjs(reservationDay)
      .hour(t0.hour())
      .minute(t0.minute())
      .second(t0.second())
      .toISOString()
    availabilityTo = dayjs(reservationDay)
      .hour(t1.hour())
      .minute(t1.minute())
      .second(t1.second())
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

  function groupByParcel(items: InventoryItem[]): Record<string, InventoryItem[]> {
    return items.reduce((acc, item) => {
      // Adjust this key as needed; here we use item.parcelId if present, otherwise the item id.
      const key = item.group;
      if (!acc[key]) {
        acc[key] = [];
      }
      acc[key].push(item);
      return acc;
    }, {} as Record<number, InventoryItem[]>);
  }

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

    const groupedItems = (inventoryItems || []).filter(item => item.group !== 0)

    const sunbedParcels = groupByParcel(groupedItems)

    setSunbedParcels(sunbedParcels)

    setParcelShapes(Object.keys(sunbedParcels)
      .filter(parcelNumber => sunbedParcels[parcelNumber])
      .map(parcelNumber => {
        const parcelItems = sunbedParcels[parcelNumber] || []
        const shapeCoords = getPaddedConvexHull(parcelItems.map(item => ({
          locationLat: Number(item.locationLat),
          locationLng: Number(item.locationLng)
        })), 2.5)
        return { number: Number(parcelNumber), shape: shapeCoords }
    }))

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

  const sunbedMarkers = (inventoryItems || []).map(item => {
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
  })

  // Helper: Compute the centroid of an array of lat/lng points.
  function getCentroid(points: google.maps.LatLngLiteral[]): google.maps.LatLngLiteral {
    let latSum = 0,
      lngSum = 0;
    points.forEach(p => {
      latSum += p.lat;
      lngSum += p.lng;
    });
    return { lat: latSum / points.length, lng: lngSum / points.length };
  }

  // Helper: Count available sunbeds in a parcel.
  // (Assuming you have an isAvailable(item) function in scope.)
  function getAvailableCountForParcel(parcelItems: InventoryItem[]): number {
    return parcelItems.filter(item => isAvailable(item)).length;
  }

  const SafeAPIProvider = APIProvider as unknown as React.ComponentType<any>
  const SafeMap = Map as unknown as React.ComponentType<any>
  const SafeAdvancedMarker = AdvancedMarker as unknown as React.ComponentType<any>

  return (
    <>
      <SafeAPIProvider apiKey={apiKey}>
        <SafeMap
          mapId={'7a0196a7ba317ea5'}
          defaultZoom={defaultBounds ? undefined : 20}
          defaultCenter={{
            lat: Number(site.locationLat),
            lng: Number(site.locationLng),
          }}
          defaultBounds={defaultBounds}
          gestureHandling="greedy"
          disableDefaultUI={true}
          onZoomChanged={(mapInstance: any) => {
            const newZoom = mapInstance.map.getZoom()
            setZoom(newZoom || 20)
          }}
          onIdle={(mapInstance: any) => {
            const newZoom = mapInstance.map.getZoom()
            setZoom(newZoom || 20)
          }}
          onClick={(e: any) => {
          }}
        >
          {
            zoom > 19 ? sunbedMarkers :
              (parcelShapes || []).map((parcelShape, idx) => {
                // Compute the parcel centroid.
                const centroid = getCentroid(parcelShape.shape);
                const parcelItems = sunbedParcels[parcelShape.number] || [];
                const totalCount = parcelItems.length;
                const availableCount = getAvailableCountForParcel(parcelItems);
                const hasAvailability = availableCount > 0;
                return (
                  <React.Fragment key={idx}>
                    <Polygon
                      key={idx}
                      paths={parcelShape.shape}
                      strokeColor={hasAvailability ? '#16a34a' : '#9ca3af'}
                      strokeOpacity={0.7}
                      strokeWeight={2}
                      fillColor={hasAvailability ? '#22c55e' : '#d1d5db'}
                      fillOpacity={hasAvailability ? 0.15 : 0.12}
                    />
                    <SafeAdvancedMarker
                      key={`chip-${idx}`}
                      position={centroid}
                    >
                      <div
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          gap: 2,
                        }}
                      >
                        <Chip
                          label={`${availableCount} / ${totalCount}`}
                          size="small"
                          sx={{
                            fontWeight: 600,
                            fontSize: '0.75rem',
                            backgroundColor: hasAvailability ? '#f0fdf4' : '#f9fafb',
                            color: hasAvailability ? '#16a34a' : '#6b7280',
                            border: `1.5px solid ${hasAvailability ? '#86efac' : '#d1d5db'}`,
                            boxShadow: '0 1px 3px rgba(0,0,0,0.10)',
                            '.MuiChip-label': { px: 1.5, py: 0.25 },
                          }}
                        />
                      </div>
                    </SafeAdvancedMarker>
                  </React.Fragment>
                )
              })
            
          }
        </SafeMap>
      </SafeAPIProvider>
    </>
  )
}

export default function SunbedSelection({ apiKey, site }: { apiKey: string; site: SiteProps }) {
  if (site.layoutMode === 'schematic') {
    return <SchematicSelection site={site} />
  }
  return <SunbedSelectionGeo apiKey={apiKey} site={site} />
}
