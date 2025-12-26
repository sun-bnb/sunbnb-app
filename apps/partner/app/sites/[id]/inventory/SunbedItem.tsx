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
  const borderThickness = selected || pairedSelected ? 4 : 2
  const borderColor = isPaired ? 'gray' : 'black'

  const width = dynamicSize / 2.5
  const height = dynamicSize
  const badgeFontSize = dynamicSize * 0.1

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
        // Only call onDragEnd if it was actually dragged
        console.log('SunbedMarker dragged to:', position || initialPosition)
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
        style={{
          pointerEvents: 'auto',
          touchAction: 'none',
          cursor: 'grab',
          overflow: 'visible',
        }}
      >
        <g transform={`rotate(${rotation}, ${width / 2}, ${height / 2})`}>
          {/* Chair rectangle */}
          <rect
            x={0}
            y={0}
            width={width}
            height={height}
            fill={selected ? 'rgba(0, 0, 0, 0.3)' : 'rgba(255,255,255,0.01)'}
            stroke={borderColor}
            strokeWidth={borderThickness}
            rx={zoom > 20 ? 4 : 0}
            ry={zoom > 20 ? 4 : 0}
          />

          {/* Chair number, centered and rotated with chair */}
          {zoom > 20 && (
            <g transform={`rotate(90, ${width / 2}, ${height / 2})`}>
              <text
                x={width / 2}
                y={height / 2}
                fill="black"
                fontSize={dynamicSize * 0.15}
                fontWeight="bold"
                textAnchor="middle"
                dominantBaseline="central"
                style={{ pointerEvents: 'none' }}
              >
                {String(number).padStart(4, '0')}
              </text>
            </g>
          )}
          {
            status === 'disabled' &&  
              <line
                  x1={0}
                  y1={0}
                  x2={width}
                  y2={height}          // ↘ top-left → bottom-right
                  stroke="red"
                  strokeWidth={Math.max(2, width * 0.05)} // thickness scales with size
                  strokeLinecap="round"
                  style={{ pointerEvents: 'none' }}
                />
          }

        </g>
      </svg>
    </div>
  )
}
