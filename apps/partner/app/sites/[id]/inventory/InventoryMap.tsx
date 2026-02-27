// components/InventoryMap.tsx
'use client'

import React, { useState, useRef, useEffect } from 'react'
import { APIProvider, Map, ControlPosition, MapMouseEvent, useMap } from '@vis.gl/react-google-maps'
import SunbedMarker from './SunbedMarker'
import { InventoryItem } from '@/types/shared'
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
  onMarkerClick: (item: InventoryItem) => void
  onMarkerDragEnd: (item: InventoryItem, e: any) => void
  onPlaceSelect: (place: google.maps.places.PlaceResult | null) => void
  onMapClick: (event: MapMouseEvent) => void
  onSelectionChange: (ids: string[]) => void
  selectedPlace: google.maps.places.PlaceResult | null
}

function getScaledSize(zoom: number): number {
  const physicalLength = 2.5 // meters
  const metersPerPixel = 156543.03392 / Math.pow(2, zoom)
  return physicalLength / metersPerPixel
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
  onMarkerClick: (item: InventoryItem) => void
  onMarkerDragEnd: (item: InventoryItem, e: any) => void
  onSelectionChange: (ids: string[]) => void
  zoom: number
}) {
  const map = useMap()
  const { site } = useSite()

  const dynamicSize = getScaledSize(zoom)

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
        const items = site.inventoryItems || []
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
      {(site.inventoryItems || []).map((item) => {
        const isSelected =
          selectedItemId === item.id ||
          selectedSet.has(item.id) ||
          (selectedGroupNumber != null && item.group === selectedGroupNumber)
        const pairedSelected =
          pairingMode && selectedItemId
            ? item.id === (site.inventoryItems || []).find((i) => i.id === selectedItemId)?.pairId ||
              item.id === (site.inventoryItems || []).find((i) => i.id === selectedItemId)?.pairedBy?.id
            : false

        const position = {
          lat: Number(item.locationLat),
          lng: Number(item.locationLng),
        }

        return (
          <SunbedMarker
            key={item.id}
            pairedBy={item.pairedBy || undefined}
            pairId={item.pairId || undefined}
            number={item.number}
            rotation={item.rotation || 0}
            status={item.status}
            initialPosition={position}
            zoom={zoom}
            dynamicSize={dynamicSize}
            selected={isSelected}
            pairedSelected={pairedSelected}
            onClick={() => onMarkerClick(item)}
            onDragEnd={(e) => onMarkerDragEnd(item, e)}
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
  onMapClick,
  onMarkerClick,
  onMarkerDragEnd,
  onPlaceSelect,
  onSelectionChange,
  selectedPlace,
}: InventoryMapProps) {

  const [zoom, setZoom] = useState(20)
  const SafeAPIProvider = APIProvider as unknown as React.ComponentType<any>
  const SafeMap = Map as unknown as React.ComponentType<any>

  return (
    <div
      className="w-full h-[400px] border border-2 border-gray-400"
      style={{ position: 'relative' }}
    >
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
        />
        <MapHandler place={selectedPlace} />
      </SafeAPIProvider>
    </div>
  )
}
