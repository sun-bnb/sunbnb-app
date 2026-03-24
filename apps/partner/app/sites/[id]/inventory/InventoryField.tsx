// components/InventoryMap.tsx
'use client'

import React, { useState } from 'react'
import { APIProvider, Map, ControlPosition, MapMouseEvent } from '@vis.gl/react-google-maps'
import SunbedItem from './SunbedItem'
import { InventoryItem } from '@/types/shared'
import MapHandler from '@/components/maps/map-handler'
import { CustomMapControl } from '@/components/maps/map-control'
import { useSite } from '@/app/sites/site-context'

interface InventoryFieldProps {
  selectedItemId: string | null
  pairingMode: boolean
  onMarkerClick: (item: InventoryItem) => void
  onMarkerDragEnd: (item: InventoryItem, e: any) => void
  onPlaceSelect: (place: google.maps.places.PlaceResult | null) => void
  onFieldClick: (event: MapMouseEvent) => void
  selectedPlace: google.maps.places.PlaceResult | null
}

function getScaledSize(zoom: number): number {
  const physicalLength = 2.1 // meters
  const metersPerPixel = 156543.03392 / Math.pow(2, zoom)
  const size = physicalLength / metersPerPixel
  return Math.max(size, 10)
}

export default function InventoryMap({
  selectedItemId,
  pairingMode,
  onFieldClick,
  onMarkerClick,
  onMarkerDragEnd,
  onPlaceSelect
}: InventoryFieldProps) {


  const { site, nonce } = useSite()

  const [zoom, setZoom] = useState(20)
  const dynamicSize = getScaledSize(zoom)

  return (
    <div className="w-full h-[400px] border border-2 border-gray-400">
      <div className="field">
        {(site.inventoryItems || []).map((item) => {
          const isSelected = selectedItemId === item.id
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
            <SunbedItem
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
      </div>
    </div>
  )
}
