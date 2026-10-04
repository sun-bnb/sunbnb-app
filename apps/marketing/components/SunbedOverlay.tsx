'use client'
/* global google -- loaded by the Maps JS API via APIProvider */

import { useMap } from '@vis.gl/react-google-maps'
import { useEffect, useRef } from 'react'
import { DEFAULT_LAYOUT, type BeachLayout } from '@/lib/beach-layout.ts'

/**
 * Draws a generated beach layout on the map with ONE canvas overlay. A marker per sunbed does
 * not scale — track 020 measured the cost of per-item map markers at venue scale, and a prospect
 * can type 5,000 — whereas one canvas redraw per pan/zoom stays cheap at any count.
 *
 * Sizes are true to scale: each bed is drawn at its real footprint (metres → pixels at the
 * current zoom), so the mockup shows how the beach would actually fill.
 */
export default function SunbedOverlay({ layout }: { layout: BeachLayout }) {
  const map = useMap()
  const layoutRef = useRef(layout)
  const overlayRef = useRef<google.maps.OverlayView | null>(null)

  useEffect(() => {
    if (!map) return

    class CanvasOverlay extends google.maps.OverlayView {
      private canvas = document.createElement('canvas')

      onAdd() {
        this.canvas.style.position = 'absolute'
        this.canvas.style.pointerEvents = 'none'
        this.getPanes()?.overlayLayer.appendChild(this.canvas)
      }

      onRemove() {
        this.canvas.remove()
      }

      draw() {
        const projection = this.getProjection()
        const bounds = map!.getBounds()
        if (!projection || !bounds) return
        const ne = projection.fromLatLngToDivPixel(bounds.getNorthEast())
        const sw = projection.fromLatLngToDivPixel(bounds.getSouthWest())
        if (!ne || !sw) return

        const width = Math.max(1, ne.x - sw.x)
        const height = Math.max(1, sw.y - ne.y)
        const dpr = window.devicePixelRatio || 1
        const c = this.canvas
        c.style.left = `${sw.x}px`
        c.style.top = `${ne.y}px`
        c.style.width = `${width}px`
        c.style.height = `${height}px`
        c.width = Math.round(width * dpr)
        c.height = Math.round(height * dpr)
        const ctx = c.getContext('2d')
        if (!ctx) return
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        ctx.clearRect(0, 0, width, height)

        const { sunbeds, umbrellas } = layoutRef.current
        if (!sunbeds.length) return

        // Pixels per metre at this zoom, measured at the first bed (1e-5° lat ≈ 1.11 m).
        const first = sunbeds[0]!
        const a = projection.fromLatLngToDivPixel(new google.maps.LatLng(first.lat, first.lng))
        const b = projection.fromLatLngToDivPixel(new google.maps.LatLng(first.lat + 1e-5, first.lng))
        if (!a || !b) return
        const pxPerM = Math.abs(a.y - b.y) / 1.1132
        const bedW = DEFAULT_LAYOUT.bedWidthM * pxPerM
        const bedL = DEFAULT_LAYOUT.bedLengthM * pxPerM
        const toLocal = (lat: number, lng: number) => {
          const p = projection.fromLatLngToDivPixel(new google.maps.LatLng(lat, lng))
          return p ? { x: p.x - sw.x, y: p.y - ne.y } : null
        }

        // Zoomed far out a bed is under a pixel: draw dots so the beach still reads as filled.
        if (bedW < 2) {
          ctx.fillStyle = 'rgba(255,255,255,0.9)'
          for (const s of sunbeds) {
            const p = toLocal(s.lat, s.lng)
            if (p) ctx.fillRect(p.x - 1, p.y - 1, 2, 2)
          }
          return
        }

        const angle = (first.rotationDeg * Math.PI) / 180
        for (const s of sunbeds) {
          const p = toLocal(s.lat, s.lng)
          if (!p || p.x < -bedL || p.y < -bedL || p.x > width + bedL || p.y > height + bedL) continue
          ctx.save()
          ctx.translate(p.x, p.y)
          // After rotating by the sea bearing, canvas "up" points at the sea: feet up, head down.
          ctx.rotate(angle)
          ctx.fillStyle = '#ffffff'
          ctx.strokeStyle = 'rgba(17,24,39,0.85)'
          ctx.lineWidth = Math.max(0.75, bedW * 0.08)
          roundRect(ctx, -bedW / 2, -bedL / 2, bedW, bedL, Math.min(bedW, bedL) * 0.2)
          ctx.fill()
          ctx.stroke()
          // Raised backrest at the land end.
          ctx.fillStyle = 'rgba(17,24,39,0.18)'
          roundRect(ctx, -bedW / 2, bedL / 2 - bedL * 0.3, bedW, bedL * 0.3, Math.min(bedW, bedL) * 0.2)
          ctx.fill()
          ctx.restore()
        }

        // Umbrellas sit between the two beds of each pair, over the backrests.
        const r = 1.0 * pxPerM
        ctx.fillStyle = 'rgba(251,191,36,0.55)'
        ctx.strokeStyle = 'rgba(180,83,9,0.8)'
        ctx.lineWidth = Math.max(0.75, r * 0.08)
        for (const u of umbrellas) {
          const p = toLocal(u.lat, u.lng)
          if (!p) continue
          // Canvas "toward land" is (−sin θ, cos θ) after the sea-bearing rotation.
          const back = { x: p.x - Math.sin(angle) * bedL * 0.25, y: p.y + Math.cos(angle) * bedL * 0.25 }
          ctx.beginPath()
          ctx.arc(back.x, back.y, r, 0, Math.PI * 2)
          ctx.fill()
          ctx.stroke()
        }
      }
    }

    const overlay = new CanvasOverlay()
    overlay.setMap(map)
    overlayRef.current = overlay
    return () => {
      overlay.setMap(null)
      overlayRef.current = null
    }
  }, [map])

  // New layout (rotate / move / count change) → redraw without re-creating the overlay.
  useEffect(() => {
    layoutRef.current = layout
    overlayRef.current?.draw()
  }, [layout])

  return null
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}
