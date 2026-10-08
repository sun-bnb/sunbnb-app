'use client'

import Chip from '@mui/material/Chip'
import { useEffect, useMemo, useState } from 'react'
import { InventoryItem, SiteProps, WorkingHours } from '@/app/sites/types'
import { useSelector, useDispatch } from 'react-redux'
import { setValue } from '@/store/features/sites/sitesSlice'
import { RootState } from '@/store/store'
import { useGetAvailabilityBySiteAndTimeRangeQuery } from '@/store/features/api/apiSlice'
import dayjs, { Dayjs } from 'dayjs'
import { APIProvider, AdvancedMarker, Map, useMap } from '@vis.gl/react-google-maps'
import { Polygon } from './polygon'
import { getPaddedConvexHull } from '@/utils/geometry'
import React from 'react'
import { useSession } from 'next-auth/react'
import SchematicSelection from './SchematicSelection'
import {
  BED_ART_LENGTH,
  BedArtDefs,
  BedGlyphSvg,
  ParasolGlyph,
  bedLengthPxAtZoom,
  bedMarkerBox,
  cullToBounds,
  expandBounds,
  lodTier,
  parasolOffset,
  type BedGlyphState,
  type ViewportBounds,
} from '@repo/schematic'
import { inventoryAnchor, pickRandomAvailablePair, selectionCenter } from '@/app/sites/[id]/sunbed-preselection'
import { toggleSeatSelection } from '@/app/sites/[id]/seat-selection'
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

/** Reusable marker component for rendering a sunbed on the map.
 *  The art is vector (`@repo/schematic` BedGlyphSvg) drawn into a box of the
 *  bed's real on-screen size; the box keeps the partner marker's footprint and
 *  the default bottom-centre anchor, so beds land where the operator placed them.
 */
interface SiteSunbedMarkerProps {
  item: InventoryItem
  lengthPx: number
  state: BedGlyphState
  onClick: () => void
}

const SiteSunbedMarker: React.FC<SiteSunbedMarkerProps> = ({ item, lengthPx, state, onClick }) => {
  const SafeAdvancedMarker = AdvancedMarker as unknown as React.ComponentType<any>
  const box = bedMarkerBox(lengthPx)
  return (
    <SafeAdvancedMarker
      key={item.id}
      position={{ lat: Number(item.locationLat), lng: Number(item.locationLng) }}
      onClick={onClick}
      zIndex={1}
    >
      <BedGlyphSvg
        state={state}
        lengthPx={lengthPx}
        width={box.width}
        height={box.height}
        rotation={item.rotation ?? 0}
        label={`Sunbed ${item.number}, ${state}`}
      />
    </SafeAdvancedMarker>
  )
}

/** One parasol: shared by a pair (anchored at the midpoint of the two beds) or
 *  beside a single bed. Its own marker, drawn above the beds and click-through.
 *  The <svg> is a square one bed-length wide whose centre sits where a bed's
 *  centre would (half a bed above the bottom-centre anchor), so it lines up
 *  with the bed markers at every zoom.
 */
interface ParasolSpot {
  key: string
  lat: number
  lng: number
  rotation: number
  kind: 'pair' | 'single'
  /** Bed ids under this parasol — it renders when any of them is visible. */
  bedIds: string[]
}

// The canopy sits above the beds but must never eat their taps. Maps keeps
// rewriting the marker element's inline style, and vis.gl forces
// `pointer-events: all` on content whenever `clickable` is defined (even
// false), so a scoped !important rule keyed on the parasol <svg> is the only
// thing that sticks. Mounted once by the map.
const PARASOL_CLICK_THROUGH_CSS =
  'gmp-advanced-marker:has([data-sbn-parasol]),gmp-advanced-marker:has([data-sbn-parasol]) *{pointer-events:none!important}'

const ParasolMarker: React.FC<{ spot: ParasolSpot; lengthPx: number }> = ({ spot, lengthPx }) => {
  const SafeAdvancedMarker = AdvancedMarker as unknown as React.ComponentType<any>
  const half = BED_ART_LENGTH / 2
  const off = parasolOffset(spot.kind)
  return (
    <SafeAdvancedMarker
      position={{ lat: spot.lat, lng: spot.lng }}
      zIndex={10}
    >
      <svg
        width={lengthPx}
        height={lengthPx}
        viewBox={`${-half} ${-half} ${BED_ART_LENGTH} ${BED_ART_LENGTH}`}
        overflow="visible"
        aria-hidden="true"
        data-sbn-parasol=""
        style={{ overflow: 'visible', display: 'block', pointerEvents: 'none' }}
      >
        <g transform={spot.rotation ? `rotate(${spot.rotation})` : undefined}>
          <g transform={`translate(${off.x} ${off.y})`}>
            <ParasolGlyph bedLengthPx={lengthPx} />
          </g>
        </g>
      </svg>
    </SafeAdvancedMarker>
  )
}

interface MapFocus {
  lat: number
  lng: number
}

/** Pans the map (once per focus) to the preselected pair. Must render inside <Map>. */
function PanToFocus({ focus }: { focus: MapFocus | null }) {
  const map = useMap()
  useEffect(() => {
    if (!map || !focus) return
    map.panTo({ lat: focus.lat, lng: focus.lng })
  }, [map, focus]) // a new object per preselection — never re-pans on pan/zoom/selection
  return null
}

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
  // Where the map should move to after a preselection (see PanToFocus).
  const [focus, setFocus] = useState<MapFocus | null>(null)

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

  // A plain record, not a Map — `Map` is the Google Maps component in this file.
  const itemById = useMemo(() => {
    const byId: Record<string, InventoryItem> = {}
    for (const item of inventoryItems || []) byId[item.id] = item
    return byId
  }, [inventoryItems])

  const partialGroupBooking = site.partialGroupBookingEnabled ?? false

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
      // Nothing selected (or current selection is entirely unavailable) — the
      // page just opened, or the date changed under a now-booked pick.
      // Preselect a RANDOM free pair so "Reserve" is live on open and guests
      // are spread over the beach, then bring the map to it.
      // Zero availability → empty array, leave selectedItems: [].
      const preselected = pickRandomAvailablePair(
        availabilityResponse.availability,
        inventoryItems || [],
      )
      dispatch(setValue({ selectedItems: preselected }))
      const centre = selectionCenter(preselected)
      if (centre) setFocus({ ...centre })
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
  // The SEAT nearest the inventory's centre, not the raw bounding-box centre:
  // on a beach that curves, the bbox centre is in the water, and zoom 20 over
  // open sea renders no seats at all (found on the 2.8 km Alcúdia site).
  const inventoryCenter = useMemo(() => {
    return (
      inventoryAnchor(inventoryItems || []) ?? {
        lat: Number(site.locationLat),
        lng: Number(site.locationLng),
      }
    )
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

  const bedLengthPx = bedLengthPxAtZoom(zoom)

  // Toggle selection. Whole-unit by default; per-seat once a unit is in play
  // when the site allows partial group booking — see `seat-selection.ts`.
  const toggleSelection = (item: InventoryItem): void => {
    if (!isAvailable(item)) return
    const updatedItems = toggleSeatSelection(item, selectedItems, {
      partialGroupBooking,
      isAvailable,
      resolveItem: (id) => itemById[id],
    })
    if (updatedItems === selectedItems) return
    dispatch(setValue({ selectedItems: updatedItems }))
  }

  // One parasol per SunbedGroup, anchored at the midpoint of its first two
  // beds (a pair shares it); a one-bed group or an ungrouped bed gets its own
  // beside it. Positions come from the beds' geometry, so the canopy lands
  // between the pair at any rotation without a "primary" bed hosting it.
  // Memoized (track 020 P3): geometry only depends on the inventory.
  const parasolSpots = useMemo(() => {
    const groups: Record<string, InventoryItem[]> = {}
    const spots: ParasolSpot[] = []
    for (const it of inventoryItems || []) {
      const gid = it.sunbedGroupId
      if (!gid) {
        spots.push({
          key: it.id, lat: Number(it.locationLat), lng: Number(it.locationLng),
          rotation: it.rotation || 0, kind: 'single', bedIds: [it.id],
        })
        continue
      }
      if (!groups[gid]) groups[gid] = []
      groups[gid]!.push(it)
    }
    for (const [gid, members] of Object.entries(groups)) {
      const a = members[0]!
      const b = members[1]
      spots.push(b
        ? {
            key: gid,
            lat: (Number(a.locationLat) + Number(b.locationLat)) / 2,
            lng: (Number(a.locationLng) + Number(b.locationLng)) / 2,
            rotation: a.rotation || 0, kind: 'pair', bedIds: members.map((m) => m.id),
          }
        : {
            key: gid, lat: Number(a.locationLat), lng: Number(a.locationLng),
            rotation: a.rotation || 0, kind: 'single', bedIds: [a.id],
          })
    }
    return spots
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
    const state: BedGlyphState = !isAvailable(item)
      ? 'reserved'
      : selectedIdSet.has(item.id) ? 'selected' : 'free'
    return (
      <SiteSunbedMarker
        key={item.id}
        item={item}
        lengthPx={bedLengthPx}
        state={state}
        onClick={() => toggleSelection(item)}
      />
    )
  })

  const visibleSeatIds = useMemo(() => new Set(visibleSeats.map((i) => i.id)), [visibleSeats])
  const parasolMarkers = parasolSpots
    .filter((spot) => spot.bedIds.some((id) => visibleSeatIds.has(id)))
    .map((spot) => <ParasolMarker key={`parasol-${spot.key}`} spot={spot} lengthPx={bedLengthPx} />)

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
      <BedArtDefs />
      <style>{PARASOL_CLICK_THROUGH_CSS}</style>
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
          <PanToFocus focus={focus} />
          {
            lodTier(zoom) === 'seats' ? [...sunbedMarkers, ...parasolMarkers] :
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
