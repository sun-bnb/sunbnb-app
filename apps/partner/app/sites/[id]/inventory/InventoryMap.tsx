// components/InventoryMap.tsx
'use client'

import React, { useState } from 'react'
import { APIProvider, Map, ControlPosition, MapMouseEvent } from '@vis.gl/react-google-maps'
import SunbedMarker from './SunbedMarker'
import { InventoryItem } from '../../../../types/shared'
import MapHandler from '@/components/maps/map-handler'
import { CustomMapControl } from '@/components/maps/map-control'

interface InventoryMapProps {
  siteLat: string
  siteLng: string
  apiKey: string
  inventory: InventoryItem[]
  selectedItemId: string | null
  pairingMode: boolean
  onMarkerClick: (item: InventoryItem) => void
  onMarkerDragEnd: (item: InventoryItem, e: any) => void
  onPlaceSelect: (place: google.maps.places.PlaceResult | null) => void
  onMapClick: (event: MapMouseEvent) => void
  selectedPlace: google.maps.places.PlaceResult | null
}

function getScaledSize(zoom: number): number {
  const physicalLength = 3.5 // meters
  const metersPerPixel = 156543.03392 / Math.pow(2, zoom)
  return physicalLength / metersPerPixel
}

export default function InventoryMap({
  siteLat,
  siteLng,
  apiKey,
  inventory,
  selectedItemId,
  pairingMode,
  onMapClick,
  onMarkerClick,
  onMarkerDragEnd,
  onPlaceSelect,
  selectedPlace,
}: InventoryMapProps) {


  const [zoom, setZoom] = useState(20)
  const dynamicSize = getScaledSize(zoom)

  console.log('zoom', zoom, 'dynamicSize', dynamicSize)

  return (
    <div className="w-full h-[400px] border border-2 border-gray-400">
      <APIProvider apiKey={apiKey}>
        <Map
          mapId="7a0196a7ba317ea5"
          defaultZoom={18}
          defaultCenter={
            siteLat && siteLng
              ? { lat: Number(siteLat), lng: Number(siteLng) }
              : { lat: 35.5138298, lng: 24.0180367 }
          }
          gestureHandling="greedy"
          disableDefaultUI
          onZoomChanged={(mapInstance) => {
            const newZoom = mapInstance.map.getZoom()
            if (newZoom && newZoom !== zoom) {
              setZoom(newZoom)
            }
          }}
          onClick={onMapClick}
        >
          {inventory.map((item) => {
            const isSelected = selectedItemId === item.id
            const pairedSelected =
              pairingMode && selectedItemId
                ? item.id === inventory.find((i) => i.id === selectedItemId)?.pairId ||
                  item.id === inventory.find((i) => i.id === selectedItemId)?.pairedBy?.id
                : false

            return (
              <SunbedMarker
                key={item.id}
                item={item}
                zoom={zoom}
                dynamicSize={dynamicSize}
                selected={isSelected}
                pairedSelected={pairedSelected}
                onClick={() => onMarkerClick(item)}
                onDragEnd={(e) => onMarkerDragEnd(item, e)}
              />
            )
          })}
        </Map>
        <CustomMapControl
          controlPosition={ControlPosition.TOP_LEFT}
          onPlaceSelect={onPlaceSelect}
        />
        <MapHandler place={selectedPlace} />
      </APIProvider>
    </div>
  )
}
