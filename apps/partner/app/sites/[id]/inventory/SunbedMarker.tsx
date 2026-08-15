'use client'

import React, { useEffect, useRef, useState } from 'react'
import { AdvancedMarker, useMap } from '@vis.gl/react-google-maps'
import { formatSeat } from '@repo/data/seat-label'
import { InventoryItem } from '@/types/shared'

// Track 020 P3: props are scalars (lat/lng, overrideLat/overrideLng) rather
// than {lat,lng} objects, and the callbacks carry the item, so the parent can
// pass REFERENTIALLY STABLE handlers. Both are what make the React.memo export
// actually effective — with per-render object/closure props every parent
// render re-rendered all N markers and re-attached 4 DOM listeners each.
interface SunbedMarkerProps {
  /** The inventory item this marker renders — handed back in every callback. */
  item: InventoryItem
  /** True when this item belongs to a SunbedGroup (i.e. is part of a double/couple). */
  isGroupMember?: boolean
  number: number
  seatLabel?: string | null
  rotation: number
  status: string
  lat: number
  lng: number
  zoom: number
  dynamicSize: number
  isEditing?: boolean
  isMultiSelected?: boolean
  parcelColor?: string
  pairedSelected?: boolean
  /** Group-drag formation override — null/undefined when not overridden. */
  overrideLat?: number | null
  overrideLng?: number | null
  onItemClick: (item: InventoryItem, modifiers: { metaKey: boolean; ctrlKey: boolean }) => void
  onItemDragEnd: (item: InventoryItem, e: google.maps.MapMouseEvent) => void
  onItemDragMove?: (item: InventoryItem, deltaLat: number, deltaLng: number) => void
}

function SunbedMarker({
  item,
  isGroupMember = false,
  number,
  seatLabel,
  rotation,
  status,
  lat,
  lng,
  zoom,
  dynamicSize,
  isEditing = false,
  isMultiSelected = false,
  parcelColor,
  pairedSelected = false,
  overrideLat,
  overrideLng,
  onItemClick,
  onItemDragEnd,
  onItemDragMove,
}: SunbedMarkerProps) {

  const map = useMap()
  // The SVG is held in STATE via a callback ref, not a plain useRef: the
  // parent AdvancedMarker renders `null` until Google Maps provides its
  // content container (async after mount), so the SVG does not exist when
  // mount-time effects run. A [map]-only effect reading a plain ref therefore
  // attaches listeners to nothing and never re-runs — no pointerdown, no
  // preventDefault, and the map PANS instead of dragging the seat (the
  // regression this replaced code shipped). A callback ref fires exactly when
  // the portal-rendered node mounts, re-running the listener effect below.
  const [svgEl, setSvgEl] = useState<SVGSVGElement | null>(null)

  const [position, setPosition] = useState<google.maps.LatLngLiteral | null>(null)

  // Reset local drag position when the authoritative position changes (e.g. reorder/move)
  useEffect(() => {
    setPosition(null)
  }, [lat, lng])

  // Latest-ref: the pointer-listener effect below subscribes ONCE per map and
  // reads everything mutable through this ref, so a parent re-render (new
  // handler identities, moved position) no longer tears down and re-attaches
  // 4 DOM listeners on every marker. Assigned during render — the standard
  // latest-ref pattern; the values are only read inside DOM event handlers.
  const liveRef = useRef({ item, lat, lng, position, onItemClick, onItemDragEnd, onItemDragMove })
  liveRef.current = { item, lat, lng, position, onItemClick, onItemDragEnd, onItemDragMove }

  const isDraggingRef = useRef(false)
  const wasDraggedRef = useRef(false)
  const startClientRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 })
  const startWorldRef = useRef<google.maps.Point | null>(null)
  // The in-flight drag position, written synchronously in pointermove so that
  // pointerup reports the exact drop point even if React has not yet committed
  // the corresponding setPosition render (the old code read the last RENDERED
  // position, which could trail the pointer by one move).
  const dragPosRef = useRef<google.maps.LatLngLiteral | null>(null)

  const isPaired = isGroupMember
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
    const el = svgEl
    if (!el || !map) return

    // Everything mutable is read through liveRef at event time — the effect
    // subscribes once per (element, map) instead of once per parent render
    // (deps were [map, position, zoom, onClick, onDragEnd, onDragMove], i.e.
    // 4 listeners × N markers re-attached on every render, at pointer-event
    // rate during a parcel drag). zoom is read live off the map.
    const current = () => {
      const { position: pos, lat: l, lng: g } = liveRef.current
      return pos ?? { lat: l, lng: g }
    }

    const handlePointerDown = (e: PointerEvent) => {
      e.preventDefault()
      e.stopPropagation()

      const projection = map.getProjection()
      if (!projection) return

      isDraggingRef.current = true
      wasDraggedRef.current = false
      dragPosRef.current = null
      startClientRef.current = { x: e.clientX, y: e.clientY }

      const { lat: cLat, lng: cLng } = current()
      startWorldRef.current = projection.fromLatLngToPoint(new google.maps.LatLng(cLat, cLng))

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
        dragPosRef.current = newPos
        setPosition(newPos)
        const { item: it, lat: baseLat, lng: baseLng, onItemDragMove: dragMove } = liveRef.current
        if (dragMove) {
          dragMove(it, newPos.lat - baseLat, newPos.lng - baseLng)
        }
      }
    }

    const handlePointerUp = (e: PointerEvent) => {
      if (!isDraggingRef.current) return

      isDraggingRef.current = false
      el.releasePointerCapture(e.pointerId)
      map.setOptions({ draggable: true })

      if (wasDraggedRef.current) {
        const { lat: cLat, lng: cLng } = dragPosRef.current ?? current()
        liveRef.current.onItemDragEnd(liveRef.current.item, {
          latLng: new google.maps.LatLng(cLat, cLng),
        } as google.maps.MapMouseEvent)
      }
    }

    const handleClick = (e: MouseEvent) => {
      if (!wasDraggedRef.current) {
        liveRef.current.onItemClick(liveRef.current.item, { metaKey: e.metaKey, ctrlKey: e.ctrlKey })
      }
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
  }, [svgEl, map])

  const overridePosition =
    overrideLat != null && overrideLng != null ? { lat: overrideLat, lng: overrideLng } : null

  return (
    <SafeAdvancedMarker position={overridePosition ?? position ?? { lat, lng }} style={{ pointerEvents: 'none' }}>
      <svg
        ref={setSvgEl}
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
                {formatSeat({ seatLabel, number }, { parcel: true })}
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

// Memoized: with scalar props and parent-stable callbacks, a parent re-render
// (selection change, marquee move, another parcel's drag) skips the ~N markers
// whose props didn't change. During a group drag only the dragged parcel's
// siblings get new override coords — exactly those re-render.
export default React.memo(SunbedMarker)
