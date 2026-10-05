'use client'

import type { HeroMode } from './HeroBeach'

export interface HeroSlide {
  mode: HeroMode
  title: string
  subtitle: string
}

/**
 * The first screen's headline, one feature at a time (track 027): every slide sits in the SAME
 * grid cell, so the block is as tall as the tallest slide and the beach behind it never jumps;
 * the active one slides up into view, the previous one slides up and away. The first slide is the
 * page's h1 (the ad's promise); the rest are presentational and hidden from assistive tech while
 * inactive. Dots fill like a timer and can be tapped.
 */
export default function HeroSlides({
  slides,
  active,
  intervalMs,
  running,
  onPick,
  showLabel,
}: {
  slides: HeroSlide[]
  active: number
  intervalMs: number
  /** False → no timer fill (paused, or reduced motion). */
  running: boolean
  onPick: (i: number) => void
  showLabel: (title: string) => string
}) {
  return (
    <div>
      <div className="grid">
        {slides.map((s, i) => {
          const state = i === active ? 'translate-y-0 opacity-100' : i < active ? '-translate-y-6 opacity-0' : 'translate-y-6 opacity-0'
          const Title = i === 0 ? 'h1' : 'p'
          return (
            <div key={s.mode} aria-hidden={i !== active} className={`col-start-1 row-start-1 transition-all duration-700 ease-out motion-reduce:transition-none ${state}`}>
              <Title className="text-[clamp(2rem,8.6vw,4rem)] font-semibold leading-[1.02] tracking-[-0.03em] text-[#0e3a4a] [@media(max-height:700px)]:text-[1.75rem]">{s.title}</Title>
              <p className="mt-3 hidden max-w-xl text-[clamp(1rem,4vw,1.25rem)] leading-snug text-[#0e3a4a]/80 sm:block">{s.subtitle}</p>
            </div>
          )
        })}
      </div>
      <div className="pointer-events-auto mt-4 flex gap-1.5" role="tablist">
        {slides.map((s, i) => (
          <button
            key={s.mode}
            type="button"
            role="tab"
            aria-selected={i === active}
            aria-label={showLabel(s.title)}
            onClick={() => onPick(i)}
            className={`relative h-1.5 overflow-hidden rounded-full bg-[#0e3a4a]/15 transition-all duration-300 ${i === active ? 'w-10' : 'w-4 hover:bg-[#0e3a4a]/30'}`}
          >
            {i === active && (
              <span
                key={`${active}-${running}`}
                className="absolute inset-y-0 left-0 rounded-full bg-[#0e3a4a]"
                style={running ? { animation: `hero-fill ${intervalMs}ms linear forwards` } : { width: '100%' }}
              />
            )}
          </button>
        ))}
      </div>
    </div>
  )
}
