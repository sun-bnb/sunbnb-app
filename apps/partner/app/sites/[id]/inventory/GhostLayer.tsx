'use client'

import { useEffect, useRef } from 'react'
import { useMap } from '@vis.gl/react-google-maps'
import { seatCornersGeo, type GhostKind, type GhostModel } from '@/components/assistant/geometry-preview'

/** Colours follow the status palette: blue = new, amber = moved, red = removed. */
const KIND_STYLE: Record<GhostKind, { stroke: string; fill: string; fillOpacity: number }> = {
  added: { stroke: '#2563eb', fill: '#3b82f6', fillOpacity: 0.3 },
  moved: { stroke: '#d97706', fill: '#f59e0b', fillOpacity: 0.3 },
  'moved-from': { stroke: '#9ca3af', fill: '#9ca3af', fillOpacity: 0.08 },
  removed: { stroke: '#dc2626', fill: '#ef4444', fillOpacity: 0.4 },
}
const PARCEL_STROKE = '#2563eb'
/** Above this many seats we skip the per-seat dashed outline (fill + solid edge only). */
const DASH_SEAT_LIMIT = 600

const dashIcon = (color: string, scale = 2): google.maps.IconSequence => ({
  icon: { path: 'M 0,-1 0,1', strokeOpacity: 1, strokeColor: color, scale },
  offset: '0',
  repeat: '8px',
})

/**
 * Paints the assistant's proposed inventory change as non-interactive ghosts over the geo map:
 * native Polygon / Polyline overlays (one canvas-backed layer, `clickable: false`) instead of
 * hundreds of AdvancedMarker DOM nodes. Parcel footprints are drawn even for parcels whose seats
 * are not loaded (track 020 parcel tier). Fits the viewport once per `focusKey`, never after.
 */
export default function GhostLayer({ model, focusKey }: { model: GhostModel | null; focusKey: string }) {
  const map = useMap()
  const modelRef = useRef(model)
  modelRef.current = model

  useEffect(() => {
    if (!map || !model || model.mode !== 'geo') return
    const overlays: Array<google.maps.Polygon | google.maps.Polyline> = []
    const dashed = model.seats.length <= DASH_SEAT_LIMIT

    for (const p of model.parcels) {
      const path = p.points.map((pt) => ({ lat: pt.y, lng: pt.x }))
      overlays.push(
        new google.maps.Polygon({
          map, paths: path, clickable: false, strokeOpacity: 0, strokeWeight: 0,
          fillColor: PARCEL_STROKE, fillOpacity: 0.06, zIndex: 1,
        }),
        new google.maps.Polyline({
          map, path: [...path, path[0]!], clickable: false, strokeOpacity: 0, zIndex: 2,
          icons: [dashIcon(PARCEL_STROKE, 2.5)],
        }),
      )
    }

    for (const s of model.seats) {
      const st = KIND_STYLE[s.kind]
      const corners = seatCornersGeo(s.at, s.rotation)
      overlays.push(
        new google.maps.Polygon({
          map, paths: corners, clickable: false, strokeColor: st.stroke,
          strokeOpacity: dashed ? 0 : 0.9, strokeWeight: 1,
          fillColor: st.fill, fillOpacity: st.fillOpacity, zIndex: s.kind === 'moved-from' ? 3 : 4,
        }),
      )
      if (dashed) {
        overlays.push(
          new google.maps.Polyline({
            map, path: [...corners, corners[0]!], clickable: false, strokeOpacity: 0, zIndex: 5,
            icons: [dashIcon(st.stroke, 1.4)],
          }),
        )
      }
      if (s.kind === 'removed') {
        // Strike-through: one diagonal across the seat.
        overlays.push(
          new google.maps.Polyline({
            map, path: [corners[0]!, corners[2]!], clickable: false,
            strokeColor: st.stroke, strokeOpacity: 0.95, strokeWeight: 2, zIndex: 6,
          }),
        )
      }
    }

    for (const l of model.links) {
      overlays.push(
        new google.maps.Polyline({
          map, path: [{ lat: l.from.y, lng: l.from.x }, { lat: l.to.y, lng: l.to.x }],
          clickable: false, strokeColor: KIND_STYLE.moved.stroke, strokeOpacity: 0.85, strokeWeight: 1.5, zIndex: 6,
          icons: [{ icon: { path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW, scale: 2.5, strokeColor: KIND_STYLE.moved.stroke, fillColor: KIND_STYLE.moved.stroke, fillOpacity: 1 }, offset: '100%' }],
        }),
      )
    }

    return () => {
      for (const o of overlays) o.setMap(null)
    }
  }, [map, model])

  // Fit once when a preview (re)activates. Reads the model through a ref so later
  // site refreshes (which rebuild the model) never pull the viewport away from the user.
  useEffect(() => {
    const m = modelRef.current
    if (!map || !focusKey || !m || m.mode !== 'geo' || !m.bounds) return
    const b = m.bounds
    if (b.maxX - b.minX < 1e-6 && b.maxY - b.minY < 1e-6) {
      map.setCenter({ lat: b.minY, lng: b.minX })
      map.setZoom(20)
      return
    }
    map.fitBounds(new google.maps.LatLngBounds({ lat: b.minY, lng: b.minX }, { lat: b.maxY, lng: b.maxX }), 80)
    google.maps.event.addListenerOnce(map, 'idle', () => {
      if ((map.getZoom() ?? 0) > 21) map.setZoom(21)
    })
  }, [map, focusKey])

  return null
}
