'use client'

import React, { useEffect, useRef, useState } from 'react'
import { AdvancedMarker, useMap } from '@vis.gl/react-google-maps'
import { InventoryItem } from '@/types/shared'

interface SunbedMarkerProps {
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
  isEditing?: boolean
  isMultiSelected?: boolean
  parcelColor?: string
  pairedSelected?: boolean
  positionOverride?: { lat: number; lng: number } | null
  onClick: (modifiers: { metaKey: boolean; ctrlKey: boolean }) => void
  onDragEnd: (e: google.maps.MapMouseEvent) => void
  onDragMove?: (deltaLat: number, deltaLng: number) => void
}

export default function SunbedMarker({
  pairedBy,
  pairId,
  number,
  rotation,
  status,
  initialPosition,
  zoom,
  dynamicSize,
  isEditing = false,
  isMultiSelected = false,
  parcelColor,
  pairedSelected = false,
  positionOverride,
  onClick,
  onDragEnd,
  onDragMove,
}: SunbedMarkerProps) {

  const map = useMap()
  const svgRef = useRef<SVGSVGElement>(null)

  const [position, setPosition] = useState<google.maps.LatLngLiteral | null>(null)

  // Reset local drag position when the authoritative position changes (e.g. reorder/move)
  useEffect(() => {
    setPosition(null)
  }, [initialPosition.lat, initialPosition.lng])

  const isDraggingRef = useRef(false)
  const wasDraggedRef = useRef(false)
  const startClientRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 })
  const startWorldRef = useRef<google.maps.Point | null>(null)

  const isPaired = Boolean(pairId || pairedBy?.id)
  const isHighlighted = isEditing || isMultiSelected

  // Fixed viewBox coordinate space for crisp rendering at any zoom
  const VB_W = 40
  const VB_H = 100

  const strokeW = isHighlighted || pairedSelected ? 4.5 : 2.5
  const strokeColor = isEditing ? '#f59e0b' : isMultiSelected ? '#3b82f6' : isPaired ? '#9ca3af' : '#374151'
  const fillColor = isEditing
    ? 'rgba(245, 158, 11, 0.30)'
    : isMultiSelected
      ? 'rgba(59, 130, 246, 0.30)'
      : parcelColor
        ? `${parcelColor}22`
        : 'rgba(255,255,255,0.02)'

  const width = dynamicSize / 2.5
  const height = dynamicSize
  const SafeAdvancedMarker = AdvancedMarker as unknown as React.ComponentType<any>

  useEffect(() => {
    const el = svgRef.current
    if (!el || !map) return

    const handlePointerDown = (e: PointerEvent) => {
      e.preventDefault()
      e.stopPropagation()

      const projection = map.getProjection()
      if (!projection) return

      isDraggingRef.current = true
      wasDraggedRef.current = false
      startClientRef.current = { x: e.clientX, y: e.clientY }

      const latLng = new google.maps.LatLng((position || initialPosition).lat, (position || initialPosition).lng)
      startWorldRef.current = projection.fromLatLngToPoint(latLng)

      el.setPointerCapture(e.pointerId)
      map.setOptions({ draggable: false })
    }

    const handlePointerMove = (e: PointerEvent) => {
      if (!isDraggingRef.current || !startWorldRef.current || !map) return

      const dx = e.clientX - startClientRef.current.x
      const dy = e.clientY - startClientRef.current.y
      const distance = Math.sqrt(dx * dx + dy * dy)
      if (distance > 3) wasDraggedRef.current = true

      const projection = map.getProjection()
      const scale = Math.pow(2, map.getZoom()!)
      const worldDeltaX = dx / scale
      const worldDeltaY = dy / scale

      const newWorldPoint = new google.maps.Point(
        startWorldRef.current.x + worldDeltaX,
        startWorldRef.current.y + worldDeltaY
      )

      const newLatLng = projection!.fromPointToLatLng(newWorldPoint)
      if (newLatLng) {
        const newPos = { lat: newLatLng.lat(), lng: newLatLng.lng() }
        setPosition(newPos)
        if (onDragMove) {
          onDragMove(newPos.lat - initialPosition.lat, newPos.lng - initialPosition.lng)
        }
      }
    }

    const handlePointerUp = (e: PointerEvent) => {
      if (!isDraggingRef.current) return
    
      isDraggingRef.current = false
      el.releasePointerCapture(e.pointerId)
      map.setOptions({ draggable: true })
    
      if (wasDraggedRef.current) {
        onDragEnd({
          latLng: new google.maps.LatLng((position || initialPosition).lat, (position || initialPosition).lng),
        } as google.maps.MapMouseEvent)
      }
    }
    

    const handleClick = (e: MouseEvent) => {
      if (!wasDraggedRef.current) onClick({ metaKey: e.metaKey, ctrlKey: e.ctrlKey })
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
  }, [map, position, zoom, onClick, onDragEnd, onDragMove])

  return (
    <SafeAdvancedMarker position={(positionOverride ?? position ?? initialPosition)} style={{ pointerEvents: 'none' }}>
      <svg
        ref={svgRef}
        data-sunbed-marker
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
            fill={fillColor}
            stroke={strokeColor}
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
            stroke={strokeColor}
            strokeWidth={1.5}
            strokeOpacity={0.35}
            strokeLinecap="round"
          />

          {/* Parcel color accent bar */}
          {parcelColor && !isHighlighted && (
            <rect
              x={strokeW / 2}
              y={VB_H - strokeW / 2 - 5}
              width={VB_W - strokeW}
              height={5}
              fill={parcelColor}
              opacity={0.5}
              rx={0}
              ry={0}
              style={{ pointerEvents: 'none' }}
            />
          )}

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
    </SafeAdvancedMarker>
  )
}
