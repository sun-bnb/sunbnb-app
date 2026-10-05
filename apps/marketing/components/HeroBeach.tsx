'use client'

import { useTranslations } from 'next-intl'
import { useEffect, useRef, useState } from 'react'
import { drawAppBed, drawAppShade, loadAppSprites, type AppSprites, type BedStatus } from '@/lib/app-sprites.ts'

/** The app map style's own colours (cloud mapId 7a0196a7ba317ea5), so hero and mockup match. */
const SEA = '#8fd9ee'
const SEA_DEEP = '#6cc9e3'
const SAND = '#f7ebd1'
const WET = '#efdcb4'

const PICK_MS = 650 // a guest's tap (blue) before the booking lands (red + towel)
const BETWEEN_MS = 900
const TAG_MS = 1500

interface Bed {
  x: number
  y: number
  status: BedStatus
}
interface Tag {
  x: number
  y: number
  born: number
}

/**
 * The hero: a beach that books itself — the product's one-glance pitch, drawn with the app's real
 * sunbed / towel / sunshade sprites on the app map's colours. A guest picks a bed (blue), it is
 * booked (red + towel) and a "booked · paid" tag rises; when the beach is full it starts over.
 * Purely illustrative — no figures. Reduced motion → a still, half-booked beach.
 */
export default function HeroBeach({
  shore = 0.24,
  band = [0.36, 0.98],
  showCount = true,
}: {
  /** Waterline height as a fraction of the scene (the sea is above it). */
  shore?: number
  /** Vertical band, as fractions, the sunbed rows fill — leaves room for floating UI. */
  band?: [number, number]
  showCount?: boolean
} = {}) {
  const t = useTranslations('Hero')
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [booked, setBooked] = useState(0)
  const [total, setTotal] = useState(0)

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
    const tagText = t('sceneTag')

    function layout() {
      const rect = canvas!.getBoundingClientRect()
      width = rect.width
      height = rect.height
      const dpr = window.devicePixelRatio || 1
      canvas!.width = Math.round(width * dpr)
      canvas!.height = Math.round(height * dpr)
      canvas!.getContext('2d')!.setTransform(dpr, 0, 0, dpr, 0, 0)
      // Real proportions: 2.1 m beds, pairs, aisles — sized so 3 rows fill the sand.
      const bandH = (band[1] - band[0]) * height
      // As many rows (1–3) as the band holds at a readable size, then size beds to fill it.
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
            beds.push({ x: startX + p * pitch + side * (bedW / 2 + bedL * 0.15), y: firstRowY + r * rowPitch, status: 'free' })
          }
        }
      }
      // Keep the booking state across a resize.
      prev.forEach((b, i) => beds[i] && (beds[i]!.status = b.status))
      setTotal(beds.length)
      setBooked(beds.filter((b) => b.status === 'booked').length)
    }

    function shoreY(x: number, now: number) {
      return height * shore + Math.sin(x / 70 + now / 1400) * 4 + Math.sin(x / 23 + now / 900) * 1.5
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
      for (const b of beds) drawAppBed(ctx, sprites, b.x, b.y, 0, bedL, b.status)
      for (let i = 0; i < beds.length; i += 2) {
        const a = beds[i]!
        const c = beds[i + 1]!
        drawAppShade(ctx, sprites, (a.x + c.x) / 2, a.y + bedL * 0.22, bedL)
      }
      // "Booked · paid by card" tags rising from fresh bookings.
      tags = tags.filter((tg) => now - tg.born < TAG_MS)
      ctx.font = '600 12px var(--font-geist-sans), system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      for (const tg of tags) {
        const k = (now - tg.born) / TAG_MS
        const y = tg.y - bedL * 0.7 - k * 26
        const alpha = k < 0.15 ? k / 0.15 : 1 - Math.max(0, (k - 0.6) / 0.4)
        const tw = ctx.measureText(tagText).width + 18
        ctx.globalAlpha = alpha
        ctx.fillStyle = '#0e3a4a'
        ctx.beginPath()
        ctx.roundRect(tg.x - tw / 2, y - 12, tw, 24, 12)
        ctx.fill()
        ctx.fillStyle = '#ffffff'
        ctx.fillText(tagText, tg.x, y + 0.5)
        ctx.globalAlpha = 1
      }
    }

    function loop(now: number) {
      draw(now)
      raf = requestAnimationFrame(loop)
    }

    function step() {
      const free = beds.map((b, i) => [b, i] as const).filter(([b]) => b.status === 'free')
      if (!free.length) {
        // Full: a beat to admire it, then the day starts again.
        timer = setTimeout(() => {
          beds.forEach((b) => (b.status = 'free'))
          setBooked(0)
          timer = setTimeout(step, BETWEEN_MS)
        }, 2200)
        return
      }
      // Front row first, like real demand.
      const [bed] = free[Math.floor(Math.random() * Math.min(free.length, 6))]!
      bed.status = 'selected'
      timer = setTimeout(() => {
        bed.status = 'booked'
        tags.push({ x: bed.x, y: bed.y, born: performance.now() })
        setBooked((n) => n + 1)
        timer = setTimeout(step, BETWEEN_MS)
      }, PICK_MS)
    }

    layout()
    const ro = new ResizeObserver(layout)
    ro.observe(canvas)
    void loadAppSprites().then((s) => {
      sprites = s
      if (reduced) {
        beds.forEach((b, i) => i % 2 === 0 && i < beds.length / 1.5 && (b.status = 'booked'))
        setBooked(beds.filter((b) => b.status === 'booked').length)
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
  }, [t, shore, band[0], band[1]])

  return (
    <div className="relative h-full w-full overflow-hidden">
      <canvas ref={canvasRef} className="h-full w-full" aria-hidden="true" />
      {showCount && total > 0 && (
        <div className="absolute right-3 top-3 rounded-full bg-white/90 px-3 py-1 text-xs font-semibold tabular-nums text-[#0e3a4a] shadow-sm" aria-live="off">
          {t('sceneCount', { booked, total })}
        </div>
      )}
    </div>
  )
}
