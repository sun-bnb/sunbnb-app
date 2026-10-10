'use client'

/**
 * BeachStage — the scrollytelling frame around the WebGL world.
 *
 * A tall scroll container with a sticky, viewport-high stage inside it. As the
 * page scrolls through the container, the stage stays put and the scene (plus
 * the overlaid copy panels) advance through the day. Progress is published
 * three ways, none of which re-render React on scroll:
 *
 *   - a ref the scene reads every frame (camera, sun, props),
 *   - a `--p` CSS custom property on the stage, which the panels turn into
 *     opacity/transform with plain `clamp()` math in CSS, and
 *   - a `data-beat` attribute naming the panel whose scroll window we are in,
 *     so only that panel's controls accept pointer events (state is set only
 *     when the beat actually changes — a handful of times per page).
 *
 * The scene is loaded with `next/dynamic` + `ssr: false`, so three.js is a
 * chunk only the landing route pays for. Until it arrives, and permanently when
 * the browser has no WebGL, the poster — a still of the opening frame — shows.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import dynamic from 'next/dynamic'
import Image from 'next/image'
import poster from '@/app/beach-scene-poster.jpg'

const BeachScene = dynamic(() => import('./beach-scene'), { ssr: false })

function hasWebGL(): boolean {
  try {
    const c = document.createElement('canvas')
    return !!(c.getContext('webgl2') || c.getContext('webgl'))
  } catch {
    return false
  }
}

export default function BeachStage({
  heightVh,
  yoursLabel,
  label,
  beats,
  children,
}: {
  /** Scroll length of the story, in viewport heights. */
  heightVh: number
  yoursLabel: string
  label: string
  /** Panel name → [start, end] progress window; used for `data-beat`. */
  beats: Record<string, [number, number]>
  /** The copy panels, absolutely positioned inside the sticky stage. */
  children: ReactNode
}) {
  const outer = useRef<HTMLDivElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const progress = useRef(0)
  const beatRef = useRef<string>('')
  const [mode, setMode] = useState<'poster' | 'scene'>('poster')
  const [active, setActive] = useState(true)
  const [beat, setBeat] = useState<string>('hero')

  useEffect(() => {
    if (hasWebGL()) setMode('scene')
  }, [])

  // The fixed app header reads these to go transparent over the stage and
  // switch to light type once the scene has gone dark (see globals.css).
  useEffect(() => {
    document.body.dataset.lpStage = 'on'
    return () => {
      delete document.body.dataset.lpStage
      delete document.body.dataset.lpTheme
    }
  }, [])
  useEffect(() => {
    document.body.dataset.lpTheme = beat === 'close' ? 'dark' : 'light'
  }, [beat])

  useEffect(() => {
    const el = outer.current
    const st = stage.current
    if (!el || !st) return
    let raf = 0
    let wasActive = true
    const update = () => {
      raf = 0
      const rect = el.getBoundingClientRect()
      const travel = Math.max(1, rect.height - window.innerHeight)
      const p = Math.min(1, Math.max(0, -rect.top / travel))
      progress.current = p
      st.style.setProperty('--p', p.toFixed(4))

      let current = ''
      for (const [name, [a, d]] of Object.entries(beats)) {
        if (p >= a && p <= d) {
          current = name
          break
        }
      }
      if (current !== beatRef.current) {
        beatRef.current = current
        setBeat(current)
      }

      const isActive = rect.bottom > -200 && rect.top < window.innerHeight + 200
      if (isActive !== wasActive) {
        wasActive = isActive
        setActive(isActive)
      }
    }
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update)
    }
    update()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [beats])

  return (
    <div ref={outer} style={{ height: `${heightVh}vh` }} className="relative">
      <div
        ref={stage}
        className="lp-stage sticky top-0 h-lvh w-full overflow-hidden bg-[#f8efdc]"
        style={{ ['--p' as string]: 0 }}
        data-beat={beat}
      >
        <Image src={poster} alt={mode === 'poster' ? label : ''} fill priority sizes="100vw" className="object-cover" />
        {mode === 'scene' && (
          <div className="sb-scene-fade absolute inset-0">
            <BeachScene progress={progress} active={active} yoursLabel={yoursLabel} label={label} />
          </div>
        )}
        {/* copy panels sit above the canvas, inside the small viewport so mobile toolbars never cover them */}
        <div className="absolute inset-x-0 top-0 h-svh">{children}</div>
      </div>
      <style>{`
        .sb-scene-fade { animation: sbSceneFade 700ms ease-out both; }
        @keyframes sbSceneFade { from { opacity: 0; } to { opacity: 1; } }
        @media (prefers-reduced-motion: reduce) { .sb-scene-fade { animation: none; } }
      `}</style>
    </div>
  )
}
