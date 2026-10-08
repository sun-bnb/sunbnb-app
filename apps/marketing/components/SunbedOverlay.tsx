'use client'
/* global google -- loaded by the Maps JS API via APIProvider */

import { useMap } from '@vis.gl/react-google-maps'
import { useEffect, useRef } from 'react'
import { DEFAULT_LAYOUT, type BeachLayout } from '@/lib/beach-layout.ts'
import { BED_WIDTH_RATIO, drawAppBed, drawAppShade, type BedStatus } from '@/lib/app-art.ts'

/** A newly added bed pops in over this long; additions are staggered so the beach fills row by row. */
const POP_MS = 320
const STAGGER_MS = 12
/** Below this bed length in px the app stops drawing seats and shows the parcel outline + count chip. */
const LOD_MIN_BED_PX = 9

const easeOutBack = (t: number) => {
  const c = 1.70158
  return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2)
}

/**
 * Draws a generated beach layout on the map with ONE canvas overlay, in the guest app's exact
 * visual language (`lib/app-art.ts`). One canvas, not a marker per bed: a prospect can type
 * 5,000, and track 020 measured what per-item map markers cost at venue scale. Beds that appear
 * (first draw, or a higher count) pop in staggered — the "game feel" of setting the count.
 */
export interface FloatTag {
  label: string
  text: string
  /** performance.now() when it was raised */
  at: number
}

const TAG_MS = 1600

export default function SunbedOverlay({
  layout,
  selected = null,
  booked,
  hint = null,
  tag = null,
  ground = null,
}: {
  layout: BeachLayout
  selected?: string | null
  booked?: ReadonlySet<string>
  /** A bed to pulse a "tap me" ring around (the first-guest mission). */
  hint?: string | null
  /** A "+€20 · paid" tag rising from a bed that was just booked. */
  tag?: FloatTag | null
  /** The parcel's sand patch (`lib/land-fit.ts` parcelGround), painted under the beds. */
  ground?: { lat: number; lng: number }[][] | null
}) {
  const map = useMap()
  const layoutRef = useRef(layout)
  const marksRef = useRef({ selected, booked, hint, tag, ground })
  const overlayRef = useRef<google.maps.OverlayView | null>(null)
  /** bed label → when it (re)appeared; umbrellas use their pair's first bed. */
  const bornRef = useRef(new Map<string, number>())
  const rafRef = useRef<number | null>(null)

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
        const toLocal = (lat: number, lng: number) => {
          const p = projection.fromLatLngToDivPixel(new google.maps.LatLng(lat, lng))
          return p ? { x: p.x - sw.x, y: p.y - ne.y } : null
        }

        // Pixels per metre at this zoom, measured at the first bed (1e-5° lat ≈ 1.1132 m).
        const first = sunbeds[0]!
        const a = projection.fromLatLngToDivPixel(new google.maps.LatLng(first.lat, first.lng))
        const b = projection.fromLatLngToDivPixel(new google.maps.LatLng(first.lat + 1e-5, first.lng))
        if (!a || !b) return
        const pxPerM = Math.abs(a.y - b.y) / 1.1132
        const bedL = DEFAULT_LAYOUT.bedLengthM * pxPerM
        const angle = (first.rotationDeg * Math.PI) / 180
        const { selected: sel, booked: bk, hint: hn, tag: tg, ground: gd } = marksRef.current
        const now = performance.now()
        let animating = false
        const popOf = (key: string) => {
          const born = bornRef.current.get(key)
          if (born === undefined) return 1
          const t = (now - born) / POP_MS
          if (t >= 1) return 1
          animating = true
          return t <= 0 ? 0 : Math.max(0, easeOutBack(t))
        }

        // The sand the beds stand on, in the basemap's own sand colour: where Google's water and the
        // OSM coastline disagree, the beach shown matches the shore the beds were placed by.
        if (gd?.length) {
          ctx.save()
          ctx.fillStyle = '#f8ecd0'
          ctx.strokeStyle = '#f8ecd0'
          ctx.lineJoin = 'round'
          ctx.lineWidth = Math.max(3, bedL * 0.3)
          // Each shape filled on its own: as one path, opposite windings cancel where the coast
          // strip and the parcel pad overlap — a hole exactly under the beds.
          for (const poly of gd) {
            const pts = poly.map((g) => toLocal(g.lat, g.lng)).filter((p): p is { x: number; y: number } => !!p)
            if (pts.length < 3) continue
            ctx.beginPath()
            pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)))
            ctx.closePath()
            ctx.fill()
            ctx.stroke()
          }
          ctx.restore()
        }

        if (bedL < LOD_MIN_BED_PX) {
          drawParcelOutline(ctx, sunbeds.map((s) => toLocal(s.lat, s.lng)), angle, bedL, `${sunbeds.length - (bk?.size ?? 0)}/${sunbeds.length}`)
        } else {
          const margin = bedL * 2
          for (const s of sunbeds) {
            const p = toLocal(s.lat, s.lng)
            if (!p || p.x < -margin || p.y < -margin || p.x > width + margin || p.y > height + margin) continue
            const status: BedStatus = s.label === sel ? 'selected' : bk?.has(s.label) ? 'booked' : 'free'
            const pop = popOf(s.label)
            if (pop > 0) drawAppBed(ctx, p.x, p.y, angle, bedL, status, pop)
          }
          // A parasol over each pair (anchored at the pair's midpoint), set toward the backrests as in the app.
          for (const u of umbrellas) {
            const p = toLocal(u.lat, u.lng)
            if (!p) continue
            const pop = popOf(`u:${u.row}:${u.pair}`)
            if (pop > 0) drawAppShade(ctx, p.x, p.y, angle, bedL, pop)
          }
          // The selected bed stays visible above its sunshade.
          const s = sel ? sunbeds.find((x) => x.label === sel) : undefined
          const p = s && toLocal(s.lat, s.lng)
          if (p) {
            ctx.save()
            ctx.translate(p.x, p.y)
            ctx.rotate(angle)
            ctx.strokeStyle = '#2563eb'
            ctx.lineWidth = Math.max(2, bedL * 0.08)
            const w = bedL * BED_WIDTH_RATIO
            ctx.beginPath()
            ctx.roundRect(-w / 2 - 3, -bedL / 2 - 3, w + 6, bedL + 6, 4)
            ctx.stroke()
            ctx.restore()
          }
          // "Tap me": two expanding rings around the hinted bed, looping until it is tapped.
          const h = hn && hn !== sel ? sunbeds.find((x) => x.label === hn) : undefined
          const hp = h && toLocal(h.lat, h.lng)
          if (hp) {
            animating = true
            for (const phase of [0, 0.5]) {
              const k = ((now / 1400 + phase) % 1 + 1) % 1
              ctx.beginPath()
              ctx.arc(hp.x, hp.y, bedL * (0.55 + k * 1.1), 0, Math.PI * 2)
              ctx.strokeStyle = `rgba(0,206,241,${(1 - k) * 0.9})`
              ctx.lineWidth = 3
              ctx.stroke()
            }
          }
        }

        // A booking's rising tag, like the hero scene.
        const tb = tg && now - tg.at < TAG_MS ? sunbeds.find((x) => x.label === tg.label) : undefined
        const tp = tb && toLocal(tb.lat, tb.lng)
        if (tg && tp) {
          animating = true
          const k = (now - tg.at) / TAG_MS
          const y = tp.y - Math.max(18, bedL) - k * 34
          ctx.globalAlpha = k < 0.12 ? k / 0.12 : 1 - Math.max(0, (k - 0.6) / 0.4)
          ctx.font = '600 13px system-ui, sans-serif'
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          const tw = ctx.measureText(tg.text).width + 20
          ctx.fillStyle = '#0e3a4a'
          ctx.beginPath()
          ctx.roundRect(tp.x - tw / 2, y - 13, tw, 26, 13)
          ctx.fill()
          ctx.fillStyle = '#ffffff'
          ctx.fillText(tg.text, tp.x, y + 0.5)
          ctx.globalAlpha = 1
        }

        if (animating && rafRef.current === null) {
          rafRef.current = requestAnimationFrame(() => {
            rafRef.current = null
            this.draw()
          })
        }
      }
    }

    const overlay = new CanvasOverlay()
    overlay.setMap(map)
    overlayRef.current = overlay
    return () => {
      overlay.setMap(null)
      overlayRef.current = null
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }, [map])

  // New layout or marks → beds that weren't there before pop in, staggered front row first.
  useEffect(() => {
    const now = performance.now()
    const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const born = new Map<string, number>()
    let i = 0
    for (const s of layout.sunbeds) {
      const known = bornRef.current.get(s.label)
      const t = known ?? (reduced ? now - POP_MS : now + i++ * STAGGER_MS)
      born.set(s.label, t)
      const uKey = `u:${s.row}:${s.pair}`
      if (!born.has(uKey)) born.set(uKey, bornRef.current.get(uKey) ?? t + 60)
    }
    bornRef.current = born
    layoutRef.current = layout
    marksRef.current = { selected, booked, hint, tag, ground }
    overlayRef.current?.draw()
  }, [layout, selected, booked, hint, tag, ground])

  return null
}

/** The guest app's zoomed-out parcel: green outline (#16a34a, 15 % fill) + an "available/total" chip. */
function drawParcelOutline(
  ctx: CanvasRenderingContext2D,
  points: ({ x: number; y: number } | null)[],
  angle: number,
  bedL: number,
  chip: string,
) {
  const pts = points.filter((p): p is { x: number; y: number } => !!p)
  if (!pts.length) return
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity
  for (const p of pts) {
    const u = p.x * cos + p.y * sin
    const v = -p.x * sin + p.y * cos
    minU = Math.min(minU, u); maxU = Math.max(maxU, u); minV = Math.min(minV, v); maxV = Math.max(maxV, v)
  }
  const pad = Math.max(4, bedL)
  const corners = [
    [minU - pad, minV - pad], [maxU + pad, minV - pad], [maxU + pad, maxV + pad], [minU - pad, maxV + pad],
  ].map(([u, v]) => ({ x: u! * cos - v! * sin, y: u! * sin + v! * cos }))
  ctx.beginPath()
  corners.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)))
  ctx.closePath()
  ctx.fillStyle = 'rgba(34,197,94,0.15)'
  ctx.fill()
  ctx.lineWidth = 2
  ctx.strokeStyle = '#16a34a'
  ctx.stroke()
  const cx = corners.reduce((s, p) => s + p.x, 0) / 4
  const cy = corners.reduce((s, p) => s + p.y, 0) / 4
  ctx.font = '600 12px system-ui, sans-serif'
  const tw = ctx.measureText(chip).width
  ctx.fillStyle = '#f0fdf4'
  ctx.strokeStyle = '#86efac'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.roundRect(cx - tw / 2 - 10, cy - 12, tw + 20, 24, 12)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = '#16a34a'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(chip, cx, cy + 0.5)
}
