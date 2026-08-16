'use client'

import Image from 'next/image'
import Chip from '@mui/material/Chip'
import { useEffect, useMemo, useState } from 'react'
import { InventoryItem, SiteProps, WorkingHours } from '@/app/sites/types'
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
import { cullToBounds, expandBounds, lodTier, type ViewportBounds } from '@repo/schematic'
import { pickFirstAvailablePair } from '@/app/sites/[id]/sunbed-preselection'
export { resolveSelectionSet, pickFirstAvailablePair } from '@/app/sites/[id]/sunbed-preselection'

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

/** Helper: Return all OTHER members of this item's sunbed group (used by co-selection logic).
 *  Falls back to pair/pairedBy only when no group is present, preserving backward compat. */
const getGroupMembers = (item: InventoryItem): { id: string }[] => {
  if (item.sunbedGroup?.items?.length) {
    return item.sunbedGroup.items.filter((m) => m.id !== item.id)
  }
  // Track 021 P1: grouping is the only pairing representation.
  return []
}

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
  /** For a grouped bed, true on the single designated "primary" that renders the shared umbrella. */
  isGroupPrimary: boolean
  onClick: () => void
}


const SiteSunbedMarker: React.FC<SiteSunbedMarkerProps> = ({
  item,
  dynamicSize,
  zoom,
  isSelected,
  available,
  isGroupPrimary,
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

  // Shade diameter: 60% of dynamicSize (same as before).
  const shadeDiameter = dynamicSize * 0.6;
  // A grouped bed renders the shared umbrella only on its designated primary
  // (chosen by the parent so the original left-offset lands between the pair and
  // rotates with the bed); other group members render none. Singles always do.
  const isInGroup = Boolean(item.sunbedGroupId);
  const showUmbrella = !isInGroup || isGroupPrimary;

  const dynamicHeight = dynamicSize * (zoom > 20 ? 1 : 1.1)
  const dynamicWidth = dynamicSize / (zoom > 20 ? 2.1 : 1.9)

  // Shade style for single beds (unchanged from before).
  const shadeStyle: React.CSSProperties = {
    position: 'absolute',
    left: `-${dynamicWidth}px`,
    top: '0px'
  };

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

        {showUmbrella && (
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
      zIndex={isGroupPrimary ? 10 : 1}
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
  // Current map viewport (set on idle). null until the first idle — the culled
  // marker list stays selected-seats-only for those first few hundred ms.
  const [viewBounds, setViewBounds] = useState<ViewportBounds | null>(null)
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
    dayjs().endOf('day').toISOString(),
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

  // Track 020 P3: availability lookups were a linear `.find` over the whole
  // availability array, called once per item in the marker map — O(N²) per
  // render (~9M comparisons at 3 000 seats). One Set, O(1) per lookup, rebuilt
  // only when a fresh availability response arrives.
  const availableIds = useMemo(
    () =>
      new Set(
        (availabilityResponse?.availability ?? [])
          .filter(a => a.available)
          .map(a => a.itemId)
      ),
    [availabilityResponse]
  )

  // isAvailable: returns true if the given item is available per the API response.
  // (No response yet → nothing is available — same as the old `.find` on undefined.)
  const isAvailable = (item: InventoryItem): boolean =>
    !!availabilityResponse && availableIds.has(item.id)

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
  // Deps: [availabilityResponse] only — selectedItems deliberately excluded to avoid a
  // dispatch loop. Toggling a seat changes selectedItems but NOT availabilityResponse,
  // so preselection runs only when fresh availability arrives (initial load / date change).
  useEffect(() => {

    if (!availabilityResponse) return

    const filteredSelection = (selectedItems ?? []).filter(
      (item: InventoryItem) => isAvailable(item)
    )

    if (filteredSelection.length) {
      // Keep valid selections; drop items that are no longer available.
      dispatch(setValue({ selectedItems: filteredSelection }))
    } else {
      // Nothing selected (or current selection is entirely unavailable).
      // Preselect the first available pair so "Reserve" is live on open.
      // Zero availability → empty array, leave selectedItems: [].
      const preselected = pickFirstAvailablePair(
        availabilityResponse.availability,
        inventoryItems || [],
      )
      dispatch(setValue({ selectedItems: preselected }))
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

  // Center the initial view on the inventory, so the default seat-level zoom (20)
  // frames the sunbeds rather than the site's marketing pin. We deliberately do NOT
  // fit-to-bounds here — fitting all seats zooms out to parcel level; opening at the
  // farthest zoom where individual seats are still visible (zoom 20) is the goal.
  const inventoryCenter = useMemo(() => {
    const itemLats = (inventoryItems || []).map(item => Number(item.locationLat))
    const itemLngs = (inventoryItems || []).map(item => Number(item.locationLng))
    return itemLats.length > 0
      ? {
          lat: (Math.max(...itemLats) + Math.min(...itemLats)) / 2,
          lng: (Math.max(...itemLngs) + Math.min(...itemLngs)) / 2,
        }
      : { lat: Number(site.locationLat), lng: Number(site.locationLng) }
  }, [inventoryItems, site.locationLat, site.locationLng])

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

  // Toggle selection: if an item is available, toggle its selection state.
  // Co-selects/deselects all other members of the item's sunbed group (group-authoritative;
  // falls back to pair/pairedBy when no group is set).
  const toggleSelection = (item: InventoryItem): void => {
    if (!isAvailable(item)) return
    const alreadySelected = selectedItems?.some(
      (selected: { id: string }) => selected.id === item.id
    )
    const groupMembers = getGroupMembers(item)
    let updatedItems = [...(selectedItems || [])]
    if (alreadySelected) {
      const removeIds = new Set([item.id, ...groupMembers.map((m) => m.id)])
      updatedItems = updatedItems.filter((selected: { id: string }) => !removeIds.has(selected.id))
    } else {
      updatedItems.push(item)
      for (const member of groupMembers) {
        if (!updatedItems.some((selected: { id: string }) => selected.id === member.id)) {
          updatedItems.push(member)
        }
      }
    }
    dispatch(setValue({ selectedItems: updatedItems }))
  }

  // Pick one "primary" bed per SunbedGroup to host the single shared umbrella.
  // It renders inside that bed's rotated container with the same left-offset as a
  // single bed, so it rotates consistently with the parcel (the old primary-seat
  // look) — but the primary is derived from group GEOMETRY, not pairId: it's the
  // member whose partner lies to its LOCAL-left, so the offset lands the umbrella
  // between the beds rather than outside the pair.
  // Memoized (track 020 P3): geometry only depends on the inventory, but this
  // rebuilt the whole group map on every render (pan/zoom/selection).
  const groupPrimaryIds = useMemo(() => {
    const groups: Record<string, InventoryItem[]> = {}
    for (const it of inventoryItems || []) {
      const gid = it.sunbedGroupId
      if (!gid) continue
      if (!groups[gid]) groups[gid] = []
      groups[gid]!.push(it)
    }
    const ids = new Set<string>()
    for (const members of Object.values(groups)) {
      if (members.length === 1) { ids.add(members[0]!.id); continue }
      if (members.length < 2) continue
      const a = members[0]!, b = members[1]!
      // Bed's local-left direction in screen space for its CSS rotation.
      const theta = ((a.rotation || 0) * Math.PI) / 180
      const leftX = -Math.cos(theta)
      const leftY = -Math.sin(theta)
      // Vector a->b in screen coords (east = +x, north = -y).
      const vx = Number(b.locationLng) - Number(a.locationLng)
      const vy = -(Number(b.locationLat) - Number(a.locationLat))
      // If b is to a's local-left, a is primary; otherwise b.
      ids.add(leftX * vx + leftY * vy > 0 ? a.id : b.id)
    }
    return ids
  }, [inventoryItems])

  // Track 020 P6 (user slice): the map opens at seat zoom, and this used to
  // build AND mount one AdvancedMarker per seat for the ENTIRE site on every
  // render — the "long load" at 4 500 items. Seats now render only in the
  // seats LOD tier and only within the margin-expanded viewport; selected
  // seats are always kept so a selection never vanishes off-screen.
  const selectedIdSet = useMemo(
    () => new Set<string>((selectedItems ?? []).map((i: { id: string }) => i.id)),
    [selectedItems]
  )
  const visibleSeats = useMemo(() => {
    if (lodTier(zoom) !== 'seats') return []
    return cullToBounds(
      inventoryItems || [],
      viewBounds ? expandBounds(viewBounds) : null,
      (i) => i.id,
      (i) => Number(i.locationLat),
      (i) => Number(i.locationLng),
      { alwaysInclude: selectedIdSet }
    )
  }, [inventoryItems, viewBounds, zoom, selectedIdSet])

  const sunbedMarkers = visibleSeats.map(item => {
    const available = isAvailable(item)
    const isSelected = selectedIdSet.has(item.id)
    return (
      <SiteSunbedMarker
        key={item.id}
        item={item}
        dynamicSize={dynamicSize}
        zoom={zoom}
        isSelected={isSelected}
        available={available}
        isGroupPrimary={groupPrimaryIds.has(item.id)}
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

  // Per-parcel availability counts for the parcel-tier chips — memoized; the
  // old shape re-filtered every parcel's items on every render.
  // (plain record — `Map` here is the @vis.gl map component, not the global)
  const parcelCounts = useMemo(() => {
    const counts: Record<string, { total: number; available: number }> = {}
    for (const [num, items] of Object.entries(sunbedParcels)) {
      counts[num] = {
        total: (items as InventoryItem[]).length,
        available: availabilityResponse
          ? (items as InventoryItem[]).filter(i => availableIds.has(i.id)).length
          : 0,
      }
    }
    return counts
  }, [sunbedParcels, availableIds, availabilityResponse])

  const SafeAPIProvider = APIProvider as unknown as React.ComponentType<any>
  const SafeMap = Map as unknown as React.ComponentType<any>
  const SafeAdvancedMarker = AdvancedMarker as unknown as React.ComponentType<any>

  return (
    <>
      <SafeAPIProvider apiKey={apiKey}>
        <SafeMap
          mapId={'7a0196a7ba317ea5'}
          defaultZoom={20}
          defaultCenter={inventoryCenter}
          gestureHandling="greedy"
          disableDefaultUI={true}
          onZoomChanged={(mapInstance: any) => {
            const newZoom = mapInstance.map.getZoom()
            setZoom(newZoom || 20)
          }}
          onIdle={(mapInstance: any) => {
            const newZoom = mapInstance.map.getZoom()
            setZoom(newZoom || 20)
            const b = mapInstance.map.getBounds()
            if (b) {
              const ne = b.getNorthEast()
              const sw = b.getSouthWest()
              setViewBounds({ north: ne.lat(), east: ne.lng(), south: sw.lat(), west: sw.lng() })
            }
          }}
          onClick={(e: any) => {
          }}
        >
          {
            lodTier(zoom) === 'seats' ? sunbedMarkers :
              (parcelShapes || []).map((parcelShape, idx) => {
                // Compute the parcel centroid.
                const centroid = getCentroid(parcelShape.shape);
                const counts = parcelCounts[String(parcelShape.number)] ?? { total: 0, available: 0 };
                const totalCount = counts.total;
                const availableCount = counts.available;
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
