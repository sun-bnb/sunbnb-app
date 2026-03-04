'use client'

import React, { useEffect, useRef, useState } from 'react'
import { AdvancedMarker, useMap } from '@vis.gl/react-google-maps'
import { InventoryItem } from '@/types/shared'

interface SunbedItemProps {
  pairedBy?: InventoryItem
  pairId?: string
  number: number
  rotation: number
  status: string
  initialPosition: {
    lat: number
    lng: number
  }
  zoom: number
  dynamicSize: number
  selected?: boolean
  pairedSelected?: boolean
  onClick: () => void
  onDragEnd: (e: google.maps.MapMouseEvent) => void
}

export default function SunbedItem({
  pairedBy,
  pairId,
  number,
  rotation,
  status,
  initialPosition,
  zoom,
  dynamicSize,
  selected = false,
  pairedSelected = false,
  onClick,
  onDragEnd,
}: SunbedItemProps) {

  const svgRef = useRef<SVGSVGElement>(null)

  const [position, setPosition] = useState<google.maps.LatLngLiteral | null>(null)

  const isDraggingRef = useRef(false)
  const wasDraggedRef = useRef(false)
  const startClientRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 })
  const startWorldRef = useRef<google.maps.Point | null>(null)

  const isPaired = Boolean(pairId || pairedBy?.id)
  const borderColor = isPaired ? '#9ca3af' : '#374151'

  // Fixed viewBox coordinate space for crisp rendering
  const VB_W = 40
  const VB_H = 100

  const strokeW = selected || pairedSelected ? 4.5 : 2.5
  const bodyFill = selected ? 'rgba(0, 0, 0, 0.25)' : 'rgba(255,255,255,0.02)'

  const width = dynamicSize / 2.5
  const height = dynamicSize

  useEffect(() => {
    
    const el = svgRef.current
    if (!el) return

    const handlePointerDown = (e: PointerEvent) => {
      e.preventDefault()
      e.stopPropagation()

      isDraggingRef.current = true
      wasDraggedRef.current = false
      startClientRef.current = { x: e.clientX, y: e.clientY }

      const latLng = new google.maps.LatLng((position || initialPosition).lat, (position || initialPosition).lng)

      el.setPointerCapture(e.pointerId)

    }

    const handlePointerMove = (e: PointerEvent) => {
      if (!isDraggingRef.current || !startWorldRef.current) return

      const dx = e.clientX - startClientRef.current.x
      const dy = e.clientY - startClientRef.current.y
      const distance = Math.sqrt(dx * dx + dy * dy)
      if (distance > 3) wasDraggedRef.current = true

      const scale = Math.pow(2, zoom)
      const worldDeltaX = dx / scale
      const worldDeltaY = dy / scale

      const newWorldPoint = new google.maps.Point(
        startWorldRef.current.x + worldDeltaX,
        startWorldRef.current.y + worldDeltaY
      )

    }

    const handlePointerUp = (e: PointerEvent) => {
      if (!isDraggingRef.current) return
    
      isDraggingRef.current = false
      el.releasePointerCapture(e.pointerId)
    
      if (wasDraggedRef.current) {
        onDragEnd({
          latLng: new google.maps.LatLng((position || initialPosition).lat, (position || initialPosition).lng),
        } as google.maps.MapMouseEvent)
      }
    }
    

    const handleClick = () => {
      if (!wasDraggedRef.current) onClick()
    }

    el.addEventListener('pointerdown', handlePointerDown)
    el.addEventListener('pointermove', handlePointerMove)
    el.addEventListener('pointerup', handlePointerUp)
    el.addEventListener('click', handleClick)

    return () => {
      el.removeEventListener('pointerdown', handlePointerDown)
      el.removeEventListener('pointermove', handlePointerMove)
      el.removeEventListener('pointerup', handlePointerUp)
      el.removeEventListener('click', handleClick)
    }
  }, [position, zoom, onClick, onDragEnd])

  return (
    <div>
      <svg
        ref={svgRef}
        width={width}
        height={height}
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        style={{
          pointerEvents: 'auto',
          touchAction: 'none',
          cursor: 'grab',
          overflow: 'visible',
        }}
      >
        <g transform={`rotate(${rotation}, ${VB_W / 2}, ${VB_H / 2})`}>
          {/* Chair body */}
          <rect
            x={strokeW / 2}
            y={strokeW / 2}
            width={VB_W - strokeW}
            height={VB_H - strokeW}
            fill={bodyFill}
            stroke={borderColor}
            strokeWidth={strokeW}
            rx={4}
            ry={4}
            shapeRendering="crispEdges"
          />

          {/* Headrest separator */}
          <line
            x1={strokeW + 3}
            y1={VB_H * 0.2}
            x2={VB_W - strokeW - 3}
            y2={VB_H * 0.2}
            stroke={borderColor}
            strokeWidth={1.5}
            strokeOpacity={0.35}
            strokeLinecap="round"
          />

          {/* Chair number */}
          {zoom > 20 && (
            <g transform={`rotate(90, ${VB_W / 2}, ${VB_H / 2})`}>
              <text
                x={VB_W / 2}
                y={VB_H / 2}
                fill="#1f2937"
                fontSize={14}
                fontWeight="600"
                fontFamily="system-ui, -apple-system, sans-serif"
                textAnchor="middle"
                dominantBaseline="central"
                shapeRendering="geometricPrecision"
                style={{ pointerEvents: 'none' }}
              >
                {String(number).padStart(4, '0')}
              </text>
            </g>
          )}

          {/* Disabled strike-through */}
          {status === 'disabled' && (
            <line
              x1={strokeW + 1}
              y1={strokeW + 1}
              x2={VB_W - strokeW - 1}
              y2={VB_H - strokeW - 1}
              stroke="#ef4444"
              strokeWidth={3}
              strokeLinecap="round"
              style={{ pointerEvents: 'none' }}
            />
          )}

        </g>
      </svg>
    </div>
  )
}
