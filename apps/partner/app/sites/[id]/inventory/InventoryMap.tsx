// components/InventoryMap.tsx
'use client'

import React, { useState, useRef, useEffect } from 'react'
import { APIProvider, Map, ControlPosition, MapMouseEvent, useMap } from '@vis.gl/react-google-maps'
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
}: {
  selectedItemId: string | null
  selectedItemIds: string[]
  selectedGroupNumber?: number | null
  pairingMode: boolean
  onMarkerClick: (item: InventoryItem, modifiers: { metaKey: boolean; ctrlKey: boolean }) => void
  onMarkerDragEnd: (item: InventoryItem, e: any) => void
  onSelectionChange: (ids: string[]) => void
  zoom: number
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
  const selectedSet = new Set(selectedItemIds)

  return (
    <>
      {/* Exclude pool seats (status:'pool') — they have sentinel coords (0,0)
          and must not appear as stray markers on the inventory map. */}
      {(site.inventoryItems || []).filter(i => i.status !== 'pool').map((item) => {
        const isEditing = selectedItemId === item.id
        const isMultiSelected =
          selectedSet.has(item.id) ||
          (selectedGroupNumber != null && item.group === selectedGroupNumber)
        const itemParcelColor = getParcelColor(item.group)
        const selectedInvItem = (site.inventoryItems || []).find((i) => i.id === selectedItemId)
        const pairedSelected =
          pairingMode && selectedInvItem?.sunbedGroupId
            ? item.id !== selectedInvItem.id && item.sunbedGroupId === selectedInvItem.sunbedGroupId
            : false

        const position = {
          lat: Number(item.locationLat),
          lng: Number(item.locationLng),
        }

        // Group drag: sibling markers get a position override to move in formation
        const isGroupDragSibling =
          groupDrag &&
          item.group > 0 &&
          item.group === groupDrag.group &&
          item.id !== groupDrag.draggedItemId

        const positionOverride = isGroupDragSibling
          ? { lat: position.lat + groupDrag.deltaLat, lng: position.lng + groupDrag.deltaLng }
          : null

        return (
          <SunbedMarker
            key={item.id}
            isGroupMember={Boolean(item.sunbedGroupId)}
            number={item.number}
            seatLabel={item.seatLabel}
            rotation={item.rotation || 0}
            status={item.status}
            initialPosition={position}
            zoom={zoom}
            dynamicSize={dynamicSize}
            isEditing={isEditing}
            isMultiSelected={isMultiSelected}
            parcelColor={itemParcelColor}
            pairedSelected={pairedSelected}
            positionOverride={positionOverride}
            onClick={(mods) => onMarkerClick(item, mods)}
            onDragEnd={(e) => onMarkerDragEnd(item, e)}
            onDragMove={item.group > 0 ? (deltaLat, deltaLng) => {
              setGroupDrag({ draggedItemId: item.id, group: item.group, deltaLat, deltaLng })
            } : undefined}
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
