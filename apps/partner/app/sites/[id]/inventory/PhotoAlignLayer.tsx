'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useMap } from '@vis.gl/react-google-maps'
import { cssMatrixFor, latLngToPx, pxToLatLng, type LatLng, type Px, type SimilarityGeoref } from '@repo/agent/geo/georef'
import { imageUrl } from '@/components/assistant/aerial-api'
import { dragHandle, dragMove, handlePx, pinning } from '@/components/assistant/photo-align'
import { dispatchAlign } from '@/components/assistant/photo-align-store'
import { useIsDesktop } from '@/components/assistant/useIsDesktop'
import { usePhotoAlign } from '@/components/assistant/usePhotoAlign'

type Drag = { kind: 'move'; from: LatLng; start: SimilarityGeoref } | { kind: 'handle'; start: SimilarityGeoref }

interface Host {
  el: HTMLDivElement
  overlay: google.maps.OverlayView
}

/**
 * The aerial photo drawn on the map as a custom OverlayView (track 030 S7d). The <img> is laid out
 * at its natural size and placed with one CSS matrix from `cssMatrixFor(georef, image, project)`,
 * `project` being the overlay projection, so it stays glued to the map on pan / zoom (Maps calls
 * `draw()`, which bumps `tick` and recomputes). The satellite basemap is deliberately NOT toggled.
 *
 * Interaction: dragging the photo body moves it, the corner handle rotates + scales about the
 * centre; pointer events are stopped at the overlay host so the map does not pan during those
 * drags - everywhere else the map keeps its gestures. In pin mode the photo and the map are
 * click targets instead.
 */
export default function PhotoAlignLayer({ siteId }: { siteId: string }) {
  const map = useMap()
  const isDesktop = useIsDesktop()
  const align = usePhotoAlign(siteId)
  const [host, setHost] = useState<Host | null>(null)
  const [, setTick] = useState(0)
  const [draft, setDraft] = useState<SimilarityGeoref | null>(null)
  const dragRef = useRef<Drag | null>(null)
  const draftRef = useRef<SimilarityGeoref | null>(null)

  const on = !!(align.active && align.request && align.georef && isDesktop)
  const request = align.request
  const pinMode = pinning(align.pins)

  // Create / remove the OverlayView.
  useEffect(() => {
    if (!map || !on) return
    class PhotoOverlay extends google.maps.OverlayView {
      el = document.createElement('div')
      onAdd() {
        this.el.style.position = 'absolute'
        this.el.style.left = '0'
        this.el.style.top = '0'
        this.getPanes()?.overlayMouseTarget.appendChild(this.el)
        setHost({ el: this.el, overlay: this })
      }
      draw() {
        setTick((t) => t + 1)
      }
      onRemove() {
        this.el.remove()
        setHost(null)
      }
    }
    const overlay = new PhotoOverlay()
    overlay.setMap(map)
    return () => overlay.setMap(null)
  }, [map, on])

  // Map clicks in pin mode (outside the photo; clicks on the photo arrive via the <img>).
  const georefRef = useRef(align.georef)
  georefRef.current = align.georef
  useEffect(() => {
    if (!map || !on || !pinMode || !request) return
    const l = map.addListener('click', (e: google.maps.MapMouseEvent) => {
      const g = georefRef.current
      if (!e.latLng || !g) return
      const ll = { lat: e.latLng.lat(), lng: e.latLng.lng() }
      dispatchAlign(siteId, { type: 'pin', action: { type: 'click', px: latLngToPx(g, ll), ll, image: request.image } })
    })
    return () => l.remove()
  }, [map, on, pinMode, request, siteId])

  const projection = host?.overlay.getProjection() ?? null
  const georef = draft ?? align.georef
  const image = request?.image

  const project = useMemo(() => {
    if (!projection) return null
    return (ll: LatLng): Px => {
      const p = projection.fromLatLngToDivPixel(new google.maps.LatLng(ll.lat, ll.lng))
      return p ? { x: p.x, y: p.y } : { x: 0, y: 0 }
    }
    // tick-driven redraws re-read the projection through `host`; recompute each render below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projection])

  if (!on || !host || !project || !georef || !image || !request) return null

  const toLatLng = (e: { clientX: number; clientY: number }): LatLng | null => {
    const div = map?.getDiv()
    const proj = host.overlay.getProjection()
    if (!div || !proj) return null
    const r = div.getBoundingClientRect()
    const ll = proj.fromContainerPixelToLatLng(new google.maps.Point(e.clientX - r.left, e.clientY - r.top))
    return ll ? { lat: ll.lat(), lng: ll.lng() } : null
  }

  const matrix = cssMatrixFor(georef, image, project)
  const handleAt = project(pxToLatLng(georef, handlePx(image)))
  const pinMarks: Array<{ at: Px; label: string }> = []
  const pins = align.pins
  if (pins.photo1) pinMarks.push({ at: project(pxToLatLng(georef, pins.photo1)), label: '1' })
  if (pins.photo2) pinMarks.push({ at: project(pxToLatLng(georef, pins.photo2)), label: '2' })
  if (pins.map1) pinMarks.push({ at: project(pins.map1), label: '1' })

  const begin = (e: React.PointerEvent, kind: Drag['kind']) => {
    e.stopPropagation()
    e.preventDefault()
    const ll = toLatLng(e)
    if (!ll || !align.georef) return
    if (pinMode) {
      dispatchAlign(siteId, { type: 'pin', action: { type: 'click', px: latLngToPx(align.georef, ll), ll, image } })
      return
    }
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    dragRef.current = kind === 'move' ? { kind, from: ll, start: align.georef } : { kind, start: align.georef }
  }
  const move = (e: React.PointerEvent) => {
    const d = dragRef.current
    if (!d) return
    e.stopPropagation()
    const ll = toLatLng(e)
    if (!ll) return
    const next = d.kind === 'move' ? dragMove(d.start, d.from, ll) : dragHandle(d.start, image, handlePx(image), ll)
    draftRef.current = next
    setDraft(next)
  }
  const end = (e: React.PointerEvent) => {
    if (!dragRef.current) return
    e.stopPropagation()
    dragRef.current = null
    const final = draftRef.current
    draftRef.current = null
    setDraft(null)
    if (final) dispatchAlign(siteId, { type: 'set_georef', georef: final })
  }

  return createPortal(
    <>
      <img
        src={imageUrl(request.uploadId)}
        alt=""
        draggable={false}
        onPointerDown={(e) => begin(e, 'move')}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: image.w,
          height: image.h,
          maxWidth: 'none',
          transformOrigin: '0 0',
          transform: matrix.css,
          opacity: align.opacity,
          outline: '2px dashed #2563eb',
          cursor: pinMode ? 'crosshair' : 'move',
          touchAction: 'none',
          userSelect: 'none',
        }}
      />
      {!pinMode && (
        <button
          type="button"
          aria-hidden="true"
          tabIndex={-1}
          onPointerDown={(e) => begin(e, 'handle')}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute',
            left: handleAt.x - 10,
            top: handleAt.y - 10,
            width: 20,
            height: 20,
            borderRadius: 9999,
            border: '2px solid #fff',
            background: '#2563eb',
            boxShadow: '0 1px 4px rgba(0,0,0,.4)',
            cursor: 'nwse-resize',
            touchAction: 'none',
          }}
        />
      )}
      {pinMarks.map((m, i) => (
        <span
          key={i}
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: m.at.x - 9,
            top: m.at.y - 9,
            width: 18,
            height: 18,
            borderRadius: 9999,
            background: '#d97706',
            color: '#fff',
            fontSize: 11,
            fontWeight: 600,
            lineHeight: '18px',
            textAlign: 'center',
            border: '2px solid #fff',
            pointerEvents: 'none',
          }}
        >
          {m.label}
        </span>
      ))}
    </>,
    host.el,
  )
}
