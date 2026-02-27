// components/InventoryBackground.tsx
'use client'

import React from 'react'
import { useSite } from '@/app/sites/site-context'
import { InventoryItem } from '@/types/shared'
import { usePanZoom } from './usePanZoom'
import SvgVenue from './SvgVenue'
import ItemLayer from './ItemLayer'

type Point = { x: number; y: number }

interface InventoryBackgroundProps {
  selectedItemId: string | null
  selectedGroupNumber?: number | null
  pairingMode: boolean
  onMarkerClick: (item: InventoryItem) => void
  onMarkerDragEnd: (item: InventoryItem, e: { world: Point }) => void
  onMapClick: (world: Point, e: React.MouseEvent<SVGSVGElement>) => void
  backgroundSvg?: string         // inner SVG markup at 800×600 px coords
  backgroundUrl?: string         // optional <image> fallback
  initialZoom?: number
  // fixed mapping: 800×600 px → 80×60 m
  pxW?: number; pxH?: number
  worldW?: number; worldH?: number
}

export default function InventoryBackground({
  selectedItemId,
  selectedGroupNumber,
  pairingMode,
  onMapClick,
  onMarkerClick,
  onMarkerDragEnd,
  backgroundSvg,
  backgroundUrl,
  initialZoom = 1,
  pxW = 800, pxH = 600,
  worldW = 80, worldH = 60,
}: InventoryBackgroundProps) {
  const { site } = useSite()
  const { svgRef, gTransform, clientToWorld, onWheel, onMouseDown, onMouseMove, onMouseUp, panning } = usePanZoom(initialZoom)

  function handleCanvasClick(e: React.MouseEvent<SVGSVGElement>) {
    if (panning) return
    onMapClick(clientToWorld(e), e)
  }

  return (
    <div className="w-full h-[400px] border-2 border-gray-400 select-none">
      <svg
        ref={svgRef}
        className="w-full h-full touch-pan-y"
        viewBox={`0 0 ${worldW} ${worldH}`}      // meters
        onWheel={onWheel}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        onClick={handleCanvasClick}
      >
        <g transform={gTransform}>
          <SvgVenue innerSvg={backgroundSvg} imageHref={backgroundUrl} pxW={pxW} pxH={pxH} worldW={worldW} worldH={worldH} />
          <ItemLayer
            items={site.inventoryItems || []}
            siteLat={Number(site.locationLat)}
            siteLng={Number(site.locationLng)}
            selectedItemId={selectedItemId}
            selectedGroupNumber={selectedGroupNumber}
            pairingMode={pairingMode}
            clientToWorld={clientToWorld}
            onMarkerClick={onMarkerClick}
            onMarkerDragEnd={onMarkerDragEnd}
          />
        </g>

        {/* HUD */}
        {
          false &&
            <g>
              <rect x={8} y={8} width={90} height={24} rx={6} className="fill-white/80 stroke-gray-300" />
              <text x={14} y={25} fontSize={10}>0,0 = site lat/lng</text>
            </g>
        }
      </svg>

      <div className="px-2 py-1 text-xs text-gray-600">
        Hold Shift + drag to pan. Scroll to zoom. Click to place.
      </div>
    </div>
  )
}
