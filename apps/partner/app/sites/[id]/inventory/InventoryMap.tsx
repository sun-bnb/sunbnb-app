// components/InventoryMap.tsx
'use client'

import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { APIProvider, Map, ControlPosition, MapMouseEvent, useMap, AdvancedMarker } from '@vis.gl/react-google-maps'
import { cullToBounds, expandBounds, lodTier, orientedBoundingBox, LOD_SEAT_ZOOM, type ViewportBounds } from '@repo/schematic'
import { Polygon } from '@/components/maps/polygon'
import SunbedMarker from './SunbedMarker'
import { InventoryItem } from '@/types/shared'
import { getParcelColor } from './chair-util'
import MapHandler from '@/components/maps/map-handler'
import { CustomMapControl } from '@/components/maps/map-control'
import { useSite } from '@/app/sites/site-context'

interface InventoryMapProps {
  siteLat: string
  siteLng: string
  apiKey: string
  selectedItemId: string | null
  selectedItemIds: string[]
  selectedGroupNumber?: number | null
  pairingMode: boolean
  creatingParcel?: boolean
  parcelSummary?: string
  repositionMode?: boolean
  onMarkerClick: (item: InventoryItem, modifiers: { metaKey: boolean; ctrlKey: boolean }) => void
  onMarkerDragEnd: (item: InventoryItem, e: any) => void
  onPlaceSelect: (place: google.maps.places.PlaceResult | null) => void
  onMapClick: (event: MapMouseEvent) => void
  onSelectionChange: (ids: string[]) => void
  selectedPlace: google.maps.places.PlaceResult | null
}

function getScaledSize(zoom: number): number {
  const physicalLength = 2.1 // meters
  const metersPerPixel = 156543.03392 / Math.pow(2, zoom)
  const size = physicalLength / metersPerPixel
  return Math.max(size, 10) // minimum 10px for visibility at low zoom
}

interface ParcelBox {
  group: number
  count: number
  ids: string[]
  color: string
  corners: Array<{ lat: number; lng: number }>
  center: { lat: number; lng: number }
  firstItem: InventoryItem
}

/**
 * One overview-tier parcel: an ORIENTED bounding box (matches the parcel's
 * real bounds and rotation) that is DRAGGABLE — dragging any box moves the
 * whole parcel via the absolute-target moveParcel path — plus a count chip.
 * Clicking box or chip selects the parcel and zooms to seat level.
 */
function DraggableParcelBox({
  box,
  onMoved,
  onOpen,
}: {
  box: ParcelBox
  /** Same contract as a marker drag end: (anchor item, drop event). */
  onMoved: (item: InventoryItem, e: { latLng: { lat: () => number; lng: () => number } }) => void
  onOpen: (box: ParcelBox) => void
}) {
  const polyRef = useRef<google.maps.Polygon | null>(null)
  const dragStartRef = useRef<{ lat: number; lng: number } | null>(null)
  const SafeAdvancedMarker = AdvancedMarker as unknown as React.ComponentType<any>

  const firstVertex = () => {
    const path = polyRef.current?.getPath()
    if (!path || path.getLength() === 0) return null
    const v = path.getAt(0)
    return { lat: v.lat(), lng: v.lng() }
  }

  return (
    <>
      <Polygon
        ref={polyRef}
        paths={box.corners}
        draggable
        strokeColor={box.color}
        strokeOpacity={0.85}
        strokeWeight={2}
        fillColor={box.color}
        fillOpacity={0.14}
        onDragStart={() => {
          dragStartRef.current = firstVertex()
        }}
        onDragEnd={() => {
          const start = dragStartRef.current
          const end = firstVertex()
          dragStartRef.current = null
          if (!start || !end) return
          const dLat = end.lat - start.lat
          const dLng = end.lng - start.lng
          if (Math.abs(dLat) < 1e-9 && Math.abs(dLng) < 1e-9) return
          // The whole parcel moves by the box's drag delta: send the parcel's
          // first seat to its new ABSOLUTE position (the server derives the
          // delta from that seat's DB row — same rail as a seat drag).
          const targetLat = Number(box.firstItem.locationLat) + dLat
          const targetLng = Number(box.firstItem.locationLng) + dLng
          onMoved(box.firstItem, { latLng: { lat: () => targetLat, lng: () => targetLng } })
        }}
        onClick={() => onOpen(box)}
      />
      <SafeAdvancedMarker position={box.center}>
        <div
          onClick={() => onOpen(box)}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: 'white', borderRadius: 9999,
            border: `1.5px solid ${box.color}`,
            padding: '3px 10px', cursor: 'pointer',
            fontSize: 12, fontWeight: 600, color: '#374151',
            boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
            whiteSpace: 'nowrap',
          }}
        >
          <span style={{ width: 8, height: 8, borderRadius: 9999, background: box.color }} />
          {box.group} · {box.count}
        </div>
      </SafeAdvancedMarker>
    </>
  )
}

/** Inner component that has access to the map instance via useMap() */
function MapContent({
  selectedItemId,
  selectedItemIds,
  selectedGroupNumber,
  pairingMode,
  onMarkerClick,
  onMarkerDragEnd,
  onSelectionChange,
  zoom,
  viewBounds,
}: {
  selectedItemId: string | null
  selectedItemIds: string[]
  selectedGroupNumber?: number | null
  pairingMode: boolean
  onMarkerClick: (item: InventoryItem, modifiers: { metaKey: boolean; ctrlKey: boolean }) => void
  onMarkerDragEnd: (item: InventoryItem, e: any) => void
  onSelectionChange: (ids: string[]) => void
  zoom: number
  viewBounds: ViewportBounds | null
}) {
  const map = useMap()
  const { site } = useSite()

  const dynamicSize = getScaledSize(zoom)

  // Group drag state — tracks which item is being dragged and the lat/lng delta
  const [groupDrag, setGroupDrag] = useState<{
    draggedItemId: string
    group: number
    deltaLat: number
    deltaLng: number
  } | null>(null)

  // Clear group drag when site data refreshes (positions updated from server)
  useEffect(() => {
    setGroupDrag(null)
  }, [site.inventoryItems])

  // Marquee state
  const [marquee, setMarquee] = useState<{ startX: number; startY: number; endX: number; endY: number } | null>(null)
  const isDragging = useRef(false)
  const containerRef = useRef<HTMLDivElement | null>(null)

  // Marquee mouse handlers — shift+drag to select
  useEffect(() => {
    if (!map) return
    const container = (map as any).getDiv?.() as HTMLDivElement | undefined
    if (!container) return
    containerRef.current = container

    const handleMouseDown = (e: MouseEvent) => {
      // Only shift+left-click, and not on a marker
      if (e.button !== 0 || !e.shiftKey) return
      const target = e.target as HTMLElement
      if (target.closest('[data-sunbed-marker]')) return

      // Temporarily disable map dragging for this marquee gesture
      if (map) map.setOptions({ draggable: false })

      const rect = container.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      isDragging.current = true
      setMarquee({ startX: x, startY: y, endX: x, endY: y })
    }

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return
      const rect = container.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      setMarquee(prev => prev ? { ...prev, endX: x, endY: y } : null)
    }

    const handleMouseUp = (e: MouseEvent) => {
      if (!isDragging.current || !map) {
        isDragging.current = false
        setMarquee(null)
        return
      }
      isDragging.current = false
      // Re-enable map dragging after marquee gesture
      map.setOptions({ draggable: true })

      setMarquee(prev => {
        if (!prev) return null

        const width = Math.abs(prev.endX - prev.startX)
        const height = Math.abs(prev.endY - prev.startY)

        // If the drag was very small, treat as a click — let the map's
        // native onClick handle it (it provides accurate lat/lng)
        if (width < 5 && height < 5) return null

        // Convert pixel bounds to lat/lng
        const projection = map.getProjection()
        if (!projection) return null

        const bounds = map.getBounds()
        if (!bounds) return null

        // Use overlay projection: pixel coords relative to map container → lat/lng
        const mapDiv = (map as any).getDiv() as HTMLDivElement
        const mapRect = mapDiv.getBoundingClientRect()

        const topLeft = screenPixelToLatLng(
          map,
          Math.min(prev.startX, prev.endX),
          Math.min(prev.startY, prev.endY),
          mapRect,
        )
        const bottomRight = screenPixelToLatLng(
          map,
          Math.max(prev.startX, prev.endX),
          Math.max(prev.startY, prev.endY),
          mapRect,
        )

        if (!topLeft || !bottomRight) return null

        // Hit test: find all items within bounds
        // Exclude pool seats (sentinel coords 0,0 + status:'pool') from marquee selection
        const items = (site.inventoryItems || []).filter(i => i.status !== 'pool')
        const selected = items.filter(item => {
          const lat = Number(item.locationLat)
          const lng = Number(item.locationLng)
          return (
            lat <= topLeft.lat &&
            lat >= bottomRight.lat &&
            lng >= topLeft.lng &&
            lng <= bottomRight.lng
          )
        })

        // On shift, add to existing selection; otherwise replace
        if (e.shiftKey) {
          const existingSet = new Set(selectedItemIds)
          selected.forEach(item => existingSet.add(item.id))
          onSelectionChange(Array.from(existingSet))
        } else {
          onSelectionChange(selected.map(item => item.id))
        }

        return null
      })
    }

    container.addEventListener('mousedown', handleMouseDown)
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)

    return () => {
      container.removeEventListener('mousedown', handleMouseDown)
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [map, site.inventoryItems, selectedItemIds, onSelectionChange])

  // Build the set of all highlighted item IDs for quick lookup
  const selectedSet = useMemo(() => new Set(selectedItemIds), [selectedItemIds])

  // Exclude pool seats (status:'pool') — they have sentinel coords (0,0)
  // and must not appear as stray markers on the inventory map.
  const visibleItems = useMemo(
    () => (site.inventoryItems || []).filter(i => i.status !== 'pool'),
    [site.inventoryItems],
  )

  // Track 020 P3: this lookup used to run INSIDE the per-item map below —
  // a full-array find per marker, O(N²) per render (~9M comparisons at 3 000
  // seats). It does not depend on the loop variable; hoisted.
  const selectedInvItem = useMemo(
    () => (site.inventoryItems || []).find((i) => i.id === selectedItemId),
    [site.inventoryItems, selectedItemId],
  )

  // Stable callbacks via the latest-ref pattern: SunbedMarker is React.memo'd,
  // so its handler props must not change identity per render — but the parent
  // props (onMarkerClick etc.) usually do. The ref decouples the two.
  const parentHandlersRef = useRef({ onMarkerClick, onMarkerDragEnd })
  parentHandlersRef.current = { onMarkerClick, onMarkerDragEnd }

  const handleItemClick = useCallback(
    (item: InventoryItem, mods: { metaKey: boolean; ctrlKey: boolean }) =>
      parentHandlersRef.current.onMarkerClick(item, mods),
    [],
  )
  const handleItemDragEnd = useCallback(
    (item: InventoryItem, e: any) => parentHandlersRef.current.onMarkerDragEnd(item, e),
    [],
  )
  // Formation drag: previously an inline arrow passed only for grouped items;
  // now one stable handler that no-ops for ungrouped items (same behavior).
  const handleItemDragMove = useCallback((item: InventoryItem, deltaLat: number, deltaLng: number) => {
    if (item.group > 0) {
      setGroupDrag({ draggedItemId: item.id, group: item.group, deltaLat, deltaLng })
    }
  }, [])

  // Track 020 P6 (editor slice C1): two-tier LOD like the consumer map.
  // At overview zoom the editor renders one BOX + chip per parcel instead of
  // thousands of markers (founder-directed); at seat zoom, only the seats in
  // the margin-expanded viewport mount. Selected/editing seats always render.
  const tier = lodTier(zoom)

  const culledSeats = useMemo(() => {
    if (tier !== 'seats') return []
    const always = new Set(selectedSet)
    if (selectedItemId) always.add(selectedItemId)
    return cullToBounds(
      visibleItems,
      viewBounds ? expandBounds(viewBounds) : null,
      (i) => i.id,
      (i) => Number(i.locationLat),
      (i) => Number(i.locationLng),
      { alwaysInclude: always },
    )
  }, [tier, visibleItems, viewBounds, selectedSet, selectedItemId])

  const parcelBoxes = useMemo(() => {
    if (tier !== 'parcels') return []
    // (record, not a Map — `Map` here is the @vis.gl map component)
    const byGroup: Record<number, InventoryItem[]> = {}
    for (const i of visibleItems) {
      if (!(i.group > 0)) continue
      ;(byGroup[i.group] ??= []).push(i)
    }
    return Object.entries(byGroup).map(([groupStr, items]) => {
      const group = Number(groupStr)
      const points = items.map((i) => ({ lat: Number(i.locationLat), lng: Number(i.locationLng) }))
      // Oriented to the parcel's actual rotation so the box hugs its real
      // bounds (seats all share the parcel rotation).
      const corners = orientedBoundingBox(points, items[0]?.rotation ?? 0, 2.5)
      const center = {
        lat: points.reduce((s, pnt) => s + pnt.lat, 0) / points.length,
        lng: points.reduce((s, pnt) => s + pnt.lng, 0) / points.length,
      }
      return {
        group,
        count: items.length,
        ids: items.map((i) => i.id),
        color: getParcelColor(group) || '#6b7280',
        corners,
        center,
        firstItem: items[0]!,
      } satisfies ParcelBox
    })
  }, [tier, visibleItems])

  // Click on a box/chip: select the parcel and zoom onto it (into the seats
  // tier — fitBounds, then nudge past LOD_SEAT_ZOOM for very large parcels).
  const openParcel = useCallback((box: ParcelBox) => {
    onSelectionChange(box.ids)
    if (!map) return
    const b = new google.maps.LatLngBounds()
    for (const c of box.corners) b.extend(c)
    map.fitBounds(b, 60)
    google.maps.event.addListenerOnce(map, 'idle', () => {
      const z = map.getZoom() ?? 0
      if (z <= LOD_SEAT_ZOOM) map.setZoom(LOD_SEAT_ZOOM + 1)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, onSelectionChange])

  // Ungrouped seats have no box to live in — keep them as markers at both tiers.
  const ungroupedSeats = useMemo(
    () => (tier === 'parcels' ? visibleItems.filter((i) => !(i.group > 0)) : []),
    [tier, visibleItems],
  )

  return (
    <>
      {tier === 'parcels' &&
        parcelBoxes.map((box) => (
          <DraggableParcelBox
            key={`parcel-${box.group}`}
            box={box}
            onMoved={onMarkerDragEnd}
            onOpen={openParcel}
          />
        ))}
      {(tier === 'seats' ? culledSeats : ungroupedSeats).map((item) => {
        const isEditing = selectedItemId === item.id
        const isMultiSelected =
          selectedSet.has(item.id) ||
          (selectedGroupNumber != null && item.group === selectedGroupNumber)
        const itemParcelColor = getParcelColor(item.group)
        const pairedSelected =
          pairingMode && selectedInvItem?.sunbedGroupId
            ? item.id !== selectedInvItem.id && item.sunbedGroupId === selectedInvItem.sunbedGroupId
            : false

        const lat = Number(item.locationLat)
        const lng = Number(item.locationLng)

        // Group drag: sibling markers get a position override to move in formation
        const isGroupDragSibling =
          groupDrag &&
          item.group > 0 &&
          item.group === groupDrag.group &&
          item.id !== groupDrag.draggedItemId

        return (
          <SunbedMarker
            key={item.id}
            item={item}
            isGroupMember={Boolean(item.sunbedGroupId)}
            number={item.number}
            seatLabel={item.seatLabel}
            rotation={item.rotation || 0}
            status={item.status}
            lat={lat}
            lng={lng}
            zoom={zoom}
            dynamicSize={dynamicSize}
            isEditing={isEditing}
            isMultiSelected={isMultiSelected}
            parcelColor={itemParcelColor}
            pairedSelected={pairedSelected}
            overrideLat={isGroupDragSibling ? lat + groupDrag.deltaLat : null}
            overrideLng={isGroupDragSibling ? lng + groupDrag.deltaLng : null}
            onItemClick={handleItemClick}
            onItemDragEnd={handleItemDragEnd}
            onItemDragMove={handleItemDragMove}
          />
        )
      })}

      {/* Marquee overlay */}
      {marquee && (
        <div
          style={{
            position: 'absolute',
            left: Math.min(marquee.startX, marquee.endX),
            top: Math.min(marquee.startY, marquee.endY),
            width: Math.abs(marquee.endX - marquee.startX),
            height: Math.abs(marquee.endY - marquee.startY),
            background: 'rgba(59, 130, 246, 0.15)',
            border: '2px dashed rgb(59, 130, 246)',
            pointerEvents: 'none',
            zIndex: 10,
          }}
        />
      )}
    </>
  )
}

/** Convert pixel coordinates relative to the map container to lat/lng */
function screenPixelToLatLng(
  map: google.maps.Map,
  px: number,
  py: number,
  mapRect: DOMRect,
): { lat: number; lng: number } | null {
  const projection = map.getProjection()
  if (!projection) return null

  const zoom = map.getZoom()
  if (zoom == null) return null

  const scale = Math.pow(2, zoom)

  // Get the world-coordinate of the map center
  const center = map.getCenter()
  if (!center) return null
  const centerWorldPoint = projection.fromLatLngToPoint(center)
  if (!centerWorldPoint) return null

  // Container center in pixels
  const containerCenterX = mapRect.width / 2
  const containerCenterY = mapRect.height / 2

  // Pixel offset from container center
  const pixelOffsetX = px - containerCenterX
  const pixelOffsetY = py - containerCenterY

  // Convert pixel offset to world coordinates
  const worldPoint = new google.maps.Point(
    centerWorldPoint.x + pixelOffsetX / scale,
    centerWorldPoint.y + pixelOffsetY / scale,
  )

  const latLng = projection.fromPointToLatLng(worldPoint)
  if (!latLng) return null

  return { lat: latLng.lat(), lng: latLng.lng() }
}

export default function InventoryMap({
  siteLat,
  siteLng,
  apiKey,
  selectedItemId,
  selectedItemIds,
  selectedGroupNumber,
  pairingMode,
  creatingParcel,
  parcelSummary,
  repositionMode,
  onMapClick,
  onMarkerClick,
  onMarkerDragEnd,
  onPlaceSelect,
  onSelectionChange,
  selectedPlace,
}: InventoryMapProps) {

  const [zoom, setZoom] = useState(18)
  const [viewBounds, setViewBounds] = useState<ViewportBounds | null>(null)
  const [searchFocused, setSearchFocused] = useState(false)
  const SafeAPIProvider = APIProvider as unknown as React.ComponentType<any>
  const SafeMap = Map as unknown as React.ComponentType<any>

  return (
    <div
      className="w-full h-full"
      style={{ position: 'relative' }}
    >
      {(creatingParcel || repositionMode) && (
        <style>{`.gm-style > div { cursor: crosshair !important; }`}</style>
      )}
      {repositionMode && !searchFocused && (
        <div className="absolute top-[62px] left-2.5 z-10 pointer-events-none" style={{ width: '320px' }}>
          <div className="bg-blue-600 text-white px-4 py-2 rounded-xl shadow-lg flex items-center gap-2.5 text-sm font-medium w-full">
            <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
            </svg>
            <div>Drag any sunbed to move the parcel, or click to reposition</div>
          </div>
        </div>
      )}
      {creatingParcel && !searchFocused && (
        <div className="absolute top-[62px] left-2.5 z-10 pointer-events-none" style={{ width: '320px' }}>
          <div className="bg-green-600 text-white px-4 py-2 rounded-xl shadow-lg flex items-center gap-2.5 text-sm font-medium w-full">
            <svg className="w-5 h-5 flex-shrink-0 animate-bounce" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z" />
            </svg>
            <div>
              <div>Click on the map to place the parcel</div>
              {parcelSummary && <div className="text-xs text-green-100 font-normal">{parcelSummary}</div>}
            </div>
          </div>
        </div>
      )}
      <SafeAPIProvider apiKey={apiKey}>
        <SafeMap
          mapId="7a0196a7ba317ea5"
          defaultZoom={18}
          defaultCenter={
            siteLat && siteLng
              ? { lat: Number(siteLat), lng: Number(siteLng) }
              : { lat: 35.5138298, lng: 24.0180367 }
          }
          gestureHandling="greedy"
          disableDefaultUI
          onZoomChanged={(mapInstance: any) => {
            const newZoom = mapInstance.map.getZoom()
            if (newZoom && newZoom !== zoom) {
              setZoom(newZoom)
            }
          }}
          onIdle={(mapInstance: any) => {
            const b = mapInstance.map.getBounds()
            if (b) {
              const ne = b.getNorthEast()
              const sw = b.getSouthWest()
              setViewBounds({ north: ne.lat(), east: ne.lng(), south: sw.lat(), west: sw.lng() })
            }
          }}
          onClick={onMapClick}
        >
          <MapContent
            selectedItemId={selectedItemId}
            selectedItemIds={selectedItemIds}
            selectedGroupNumber={selectedGroupNumber}
            pairingMode={pairingMode}
            onMarkerClick={onMarkerClick}
            onMarkerDragEnd={onMarkerDragEnd}
            onSelectionChange={onSelectionChange}
            zoom={zoom}
            viewBounds={viewBounds}
          />
        </SafeMap>
        <CustomMapControl
          controlPosition={ControlPosition.TOP_LEFT}
          onPlaceSelect={onPlaceSelect}
          onFocusChange={setSearchFocused}
        />
        <MapHandler place={selectedPlace} />
      </SafeAPIProvider>
    </div>
  )
}
