'use client'

import { useEffect, useRef } from 'react'
import { drawAppBed, drawAppShade, loadAppSprites, type AppSprites, type BedStatus } from '@/lib/app-sprites.ts'

/** The app map style's own colours (cloud mapId 7a0196a7ba317ea5), so hero and mockup match. */
const SEA = '#8fd9ee'
const SEA_DEEP = '#6cc9e3'
const SAND = '#f7ebd1'
const WET = '#efdcb4'

const PICK_MS = 650 // a guest's tap (blue) before the booking lands (red + towel)
const BETWEEN_MS = 900
const TAG_MS = 1500

/**
 * What the scene is showing — one per hero slide (track 027: the first screen showcases the
 * platform, one feature at a time). Every mode is a SHIPPED feature (lib/agent/knowledge.ts).
 */
export type HeroMode = 'book' | 'order' | 'rent' | 'checkin' | 'invoice'

interface Bed {
  x: number
  y: number
  status: BedStatus
  checked: boolean
}
interface Tag {
  x: number
  y: number
  born: number
  text: string
}

/**
 * The hero: a beach that runs itself, drawn with the app's real sunbed / towel / sunshade
 * sprites on the app map's colours. `mode` picks what it demonstrates — guests booking (blue →
 * red + towel), drinks ordered to booked sunbeds, boards rented from the rack, staff checking
 * guests in, receipts going out — each with a rising tag in the visitor's language (`tags`).
 * Purely illustrative — no figures. Reduced motion → a still, half-booked beach.
 */
export default function HeroBeach({
  shore = 0.24,
  band = [0.36, 0.98],
  mode = 'book',
  tags: tagTexts,
}: {
  /** Waterline height as a fraction of the scene (the sea is above it). */
  shore?: number
  /** Vertical band, as fractions, the sunbed rows fill — leaves room for floating UI. */
  band?: [number, number]
  mode?: HeroMode
  tags: Record<HeroMode, string>
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // Read by the running loop: a slide change switches what happens next, it never restarts the scene.
  const modeRef = useRef(mode)
  modeRef.current = mode
  const textRef = useRef(tagTexts)
  textRef.current = tagTexts

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let sprites: AppSprites | null = null
    let beds: Bed[] = []
    let tags: Tag[] = []
    let raf = 0
    let timer: ReturnType<typeof setTimeout> | null = null
    let width = 0
    let height = 0
    let bedL = 0
    let rack = { x: 0, y: 0, shown: 0 } // the rental rack, faded in for 'rent'

    function layout() {
      const rect = canvas!.getBoundingClientRect()
      width = rect.width
      height = rect.height
      const dpr = window.devicePixelRatio || 1
      canvas!.width = Math.round(width * dpr)
      canvas!.height = Math.round(height * dpr)
      canvas!.getContext('2d')!.setTransform(dpr, 0, 0, dpr, 0, 0)
      // Real proportions: 2.1 m beds, pairs, aisles — as many rows (1–3) as the band holds.
      const bandH = (band[1] - band[0]) * height
      const rows = Math.max(1, Math.min(3, Math.floor(bandH / (32 * 1.75))))
      bedL = Math.max(22, Math.min(46, bandH / (rows * 1.75)))
      const bedW = bedL / 2.1
      const pairW = bedW * 2 + bedL * 0.3
      const pitch = pairW + bedL * 0.55
      const pairs = Math.max(3, Math.floor((width - bedL) / pitch))
      const startX = (width - (pairs - 1) * pitch) / 2
      const firstRowY = band[0] * height + bedL * 0.6
      const rowPitch = bedL * 1.75
      const prev = beds
      beds = []
      for (let r = 0; r < rows; r++) {
        for (let p = 0; p < pairs; p++) {
          for (const side of [-1, 1]) {
            beds.push({ x: startX + p * pitch + side * (bedW / 2 + bedL * 0.15), y: firstRowY + r * rowPitch, status: 'free', checked: false })
          }
        }
      }
      // Keep the scene's state across a resize.
      prev.forEach((b, i) => beds[i] && Object.assign(beds[i]!, { status: b.status, checked: b.checked }))
      // The rental rack stands on the wet sand at the right, just below the waterline.
      rack = { ...rack, x: width - Math.max(28, bedL * 0.9), y: height * shore + bedL * 0.75 }
    }

    function shoreY(x: number, now: number) {
      return height * shore + Math.sin(x / 70 + now / 1400) * 4 + Math.sin(x / 23 + now / 900) * 1.5
    }

    function drawRack(ctx: CanvasRenderingContext2D, alpha: number) {
      if (alpha <= 0) return
      const colors = ['#00cef1', '#f59e0b', '#22c55e', '#ef4444']
      const w = Math.max(5, bedL * 0.18)
      const h = bedL * 1.05
      ctx.save()
      ctx.globalAlpha = alpha
      colors.forEach((c, i) => {
        const x = rack.x - (colors.length / 2 - i) * (w + 3)
        ctx.fillStyle = c
        ctx.strokeStyle = 'rgba(0,0,0,0.35)'
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.roundRect(x, rack.y - h / 2, w, h, w / 2)
        ctx.fill()
        ctx.stroke()
      })
      ctx.restore()
    }

    function drawCheck(ctx: CanvasRenderingContext2D, b: Bed) {
      const r = Math.max(6, bedL * 0.2)
      const cx = b.x + bedL * 0.22
      const cy = b.y - bedL * 0.42
      ctx.save()
      ctx.fillStyle = '#16a34a'
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(cx, cy, r, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(cx - r * 0.45, cy)
      ctx.lineTo(cx - r * 0.1, cy + r * 0.38)
      ctx.lineTo(cx + r * 0.5, cy - r * 0.35)
      ctx.stroke()
      ctx.restore()
    }

    function draw(now: number) {
      const ctx = canvas!.getContext('2d')!
      ctx.clearRect(0, 0, width, height)
      ctx.fillStyle = SAND
      ctx.fillRect(0, 0, width, height)
      // Sea with a gently moving waterline (the one ambient motion on the page).
      ctx.beginPath()
      ctx.moveTo(0, 0)
      for (let x = 0; x <= width; x += 8) ctx.lineTo(x, shoreY(x, now))
      ctx.lineTo(width, 0)
      ctx.closePath()
      const g = ctx.createLinearGradient(0, 0, 0, height * (shore + 0.02))
      g.addColorStop(0, SEA_DEEP)
      g.addColorStop(1, SEA)
      ctx.fillStyle = g
      ctx.fill()
      ctx.beginPath()
      for (let x = 0; x <= width; x += 8) ctx.lineTo(x, shoreY(x, now) + 1)
      ctx.lineTo(width, shoreY(width, now) + 14)
      for (let x = width; x >= 0; x -= 8) ctx.lineTo(x, shoreY(x, now) + 14)
      ctx.closePath()
      ctx.fillStyle = WET
      ctx.globalAlpha = 0.6
      ctx.fill()
      ctx.globalAlpha = 1
      if (!sprites) return
      // The rack fades in when the scene shows rentals, out otherwise.
      rack.shown = Math.max(0, Math.min(1, rack.shown + (modeRef.current === 'rent' ? 0.05 : -0.05)))
      drawRack(ctx, rack.shown)
      for (const b of beds) drawAppBed(ctx, sprites, b.x, b.y, 0, bedL, b.status)
      for (let i = 0; i < beds.length; i += 2) {
        const a = beds[i]!
        const c = beds[i + 1]!
        drawAppShade(ctx, sprites, (a.x + c.x) / 2, a.y + bedL * 0.22, bedL)
      }
      for (const b of beds) if (b.checked) drawCheck(ctx, b)
      // Rising tags: "Booked · paid by card", "Drinks · paid", …
      tags = tags.filter((tg) => now - tg.born < TAG_MS)
      ctx.font = '600 12px var(--font-geist-sans), system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      for (const tg of tags) {
        const k = (now - tg.born) / TAG_MS
        const y = tg.y - bedL * 0.7 - k * 26
        const alpha = k < 0.15 ? k / 0.15 : 1 - Math.max(0, (k - 0.6) / 0.4)
        const tw = ctx.measureText(tg.text).width + 18
        const x = Math.max(tw / 2 + 4, Math.min(width - tw / 2 - 4, tg.x))
        ctx.globalAlpha = alpha
        ctx.fillStyle = '#0e3a4a'
        ctx.beginPath()
        ctx.roundRect(x - tw / 2, y - 12, tw, 24, 12)
        ctx.fill()
        ctx.fillStyle = '#ffffff'
        ctx.fillText(tg.text, x, y + 0.5)
        ctx.globalAlpha = 1
      }
    }

    function loop(now: number) {
      draw(now)
      raf = requestAnimationFrame(loop)
    }

    const pick = <T,>(list: T[], front = list.length) => list[Math.floor(Math.random() * Math.min(list.length, front))]
    const tag = (x: number, y: number) => tags.push({ x, y, born: performance.now(), text: textRef.current[modeRef.current] })

    function step() {
      const m = modeRef.current
      if (m === 'rent') {
        tag(rack.x, rack.y)
        timer = setTimeout(step, BETWEEN_MS + 500)
        return
      }
      if (m === 'book') {
        const free = beds.filter((b) => b.status === 'free')
        if (!free.length) {
          // Full: a beat to admire it, then the day starts again.
          timer = setTimeout(() => {
            beds.forEach((b) => Object.assign(b, { status: 'free', checked: false }))
            timer = setTimeout(step, BETWEEN_MS)
          }, 2200)
          return
        }
        const bed = pick(free, 6)! // front row first, like real demand
        bed.status = 'selected'
        timer = setTimeout(() => {
          bed.status = 'booked'
          tag(bed.x, bed.y)
          timer = setTimeout(step, BETWEEN_MS)
        }, PICK_MS)
        return
      }
      // order / checkin / invoice act on booked beds — book a few quietly if there are none.
      let booked = beds.filter((b) => b.status === 'booked' && !(m === 'checkin' && b.checked))
      if (booked.length < 3) {
        beds.filter((b) => b.status === 'free').slice(0, 4).forEach((b) => (b.status = 'booked'))
        booked = beds.filter((b) => b.status === 'booked' && !(m === 'checkin' && b.checked))
      }
      if (m === 'checkin' && !booked.length) beds.forEach((b) => (b.checked = false))
      const bed = pick(booked)
      if (bed) {
        if (m === 'checkin') bed.checked = true
        tag(bed.x, bed.y)
      }
      timer = setTimeout(step, BETWEEN_MS + 300)
    }

    layout()
    const ro = new ResizeObserver(layout)
    ro.observe(canvas)
    void loadAppSprites().then((s) => {
      sprites = s
      if (reduced) {
        beds.forEach((b, i) => i % 2 === 0 && i < beds.length / 1.5 && (b.status = 'booked'))
        draw(0)
      } else {
        raf = requestAnimationFrame(loop)
        timer = setTimeout(step, 700)
      }
    })
    return () => {
      cancelAnimationFrame(raf)
      if (timer) clearTimeout(timer)
      ro.disconnect()
    }
  }, [shore, band[0], band[1]])

  return (
    <div className="relative h-full w-full overflow-hidden">
      <canvas ref={canvasRef} className="h-full w-full" aria-hidden="true" />
    </div>
  )
}
