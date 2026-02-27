'use client'
import React from 'react'
import { InventoryItem } from '@/types/shared'
import { makeLocalProjector } from './map-geo'

const BED_L = 2.0
const BED_W = 0.75

type Pt = { x: number; y: number }

interface ItemLayerProps {
  items: InventoryItem[]
  siteLat: number
  siteLng: number
  selectedItemId: string | null
  selectedGroupNumber?: number | null
  pairingMode: boolean
  clientToWorld: (e: React.MouseEvent) => Pt
  onMarkerClick: (item: InventoryItem) => void
  onMarkerDragEnd: (item: InventoryItem, e: { world: Pt }) => void
}

export default function ItemLayer({
  items, siteLat, siteLng, selectedItemId, selectedGroupNumber, pairingMode, clientToWorld, onMarkerClick, onMarkerDragEnd,
}: ItemLayerProps) {
  const proj = React.useMemo(() => makeLocalProjector({ lat: siteLat, lng: siteLng }), [siteLat, siteLng])

  return (
    <g id="beds" vectorEffect="non-scaling-stroke">
      {items.map((item) => {
        const isSelected = selectedItemId === item.id ||
          (selectedGroupNumber != null && item.group === selectedGroupNumber)
        const pairedSelected =
          pairingMode && selectedItemId
            ? item.id === items.find(i => i.id === selectedItemId)?.pairId ||
              item.id === items.find(i => i.id === selectedItemId)?.pairedBy?.id
            : false

        const { x, y } = proj.llToWorld(Number(item.locationLat), Number(item.locationLng))
        const rot = item.rotation || 0

        function onDragStart(ev: React.MouseEvent<SVGRectElement>) {
          ev.stopPropagation()
          ;(ev.currentTarget as any).__drag = { start: clientToWorld(ev) }
        }
        function onDrag(ev: React.MouseEvent<SVGRectElement>) {
          const d = (ev.currentTarget as any).__drag
          if (!d) return
          d.last = clientToWorld(ev)
        }
        function onDragEnd(ev: React.MouseEvent<SVGRectElement>) {
          const d = (ev.currentTarget as any).__drag
          ;(ev.currentTarget as any).__drag = null
          if (!d?.last) return
          onMarkerDragEnd(item, { world: d.last })
        }

        return (
          <g key={item.id} transform={`translate(${x} ${y}) rotate(${rot})`} onClick={(e) => { e.stopPropagation(); onMarkerClick(item) }}>
            <rect
              x={-BED_W / 2}
              y={-BED_L / 2}
              width={BED_W}
              height={BED_L}
              rx={0.12}
              className={`fill-white stroke-[1] ${isSelected ? 'stroke-blue-600' : pairedSelected ? 'stroke-amber-500' : 'stroke-black'}`}
              style={{ vectorEffect: 'non-scaling-stroke', cursor: 'pointer' }}
              onMouseDown={onDragStart}
              onMouseMove={onDrag}
              onMouseUp={onDragEnd}
            />
            <text y={0.05} textAnchor="middle" fontSize={0.18} style={{ userSelect: 'none' }}>
              {item.number}
            </text>
          </g>
        )
      })}
    </g>
  )
}
