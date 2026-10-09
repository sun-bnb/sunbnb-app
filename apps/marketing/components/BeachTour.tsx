'use client'

import { useTranslations } from 'next-intl'
import { useEffect, useRef, useState } from 'react'
import { haptic } from '@/lib/app-art.ts'
import { track } from '@/lib/track.ts'
import HeroBeach, { type HeroMode } from './HeroBeach'
import { CheckinScene, FitScale, InvoiceScene, OrderScene, RentScene } from './HeroVignettes'

type Stop = Exclude<HeroMode, 'book'>
const STOPS: Stop[] = ['order', 'rent', 'checkin', 'invoice']

/**
 * Below the first screen (track 027 D11): a walk along the same beach. The world is pinned while
 * the page scrolls natively; scroll progress pans the illustrated beach sideways and glides each
 * feature's scene into view, with its text underneath. No scroll hijacking — the content is real
 * HTML (every stop's text is in the DOM), and the browser's own scrolling drives it. Each stop
 * offers "Try it on your beach", which returns to the bar on the first screen.
 */
export default function BeachTour({ tags }: { tags: Record<HeroMode, string> }) {
  const t = useTranslations('Tour')
  const ref = useRef<HTMLElement>(null)
  const [progress, setProgress] = useState(0)
  const [seen, setSeen] = useState(false)

  useEffect(() => {
    let raf = 0
    const read = () => {
      raf = 0
      const el = ref.current
      if (!el) return
      const r = el.getBoundingClientRect()
      const travel = r.height - window.innerHeight
      setProgress(travel > 0 ? Math.max(0, Math.min(1, -r.top / travel)) : 0)
    }
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(read)
    }
    read()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      cancelAnimationFrame(raf)
    }
  }, [])

  // Position along the beach, in stops (0 … STOPS.length − 1), and the stop in front.
  const pos = progress * (STOPS.length - 1)
  const active = Math.round(pos)
  const lastActive = useRef(active)
  useEffect(() => {
    if (active === lastActive.current) return
    lastActive.current = active
    haptic(6)
  }, [active])
  useEffect(() => {
    if (progress > 0 && !seen) {
      setSeen(true)
      track('cta_view', { place: 'tour' })
    }
  }, [progress, seen])

  function tryIt() {
    haptic(10)
    track('cta_click', { place: `tour_${STOPS[active]}` })
    window.scrollTo({ top: 0, behavior: 'smooth' })
    setTimeout(() => document.querySelector<HTMLInputElement>('section input')?.focus({ preventScroll: true }), 600)
  }

  return (
    <section ref={ref} data-track-section="tour" aria-label={t('label')} className="relative" style={{ height: `${STOPS.length * 85}svh` }}>
      {/* dvh, not svh: when the mobile address bar hides on scroll-down the stage grows to the full
          screen and the stop cards (bottom-anchored) move down into the freed space. */}
      <div className="sticky top-0 h-[100svh] overflow-hidden bg-[#f7ebd1] supports-[height:100dvh]:h-[100dvh]">
        {/* Everything top-anchored sits in a LARGEST-viewport box (lvh): when the mobile address bar
            hides, the stage grows but this layer — and the canvas inside it — keeps its size, so
            nothing is resized (a canvas resize wipes it: that was the scroll-down flicker). */}
        <div className="absolute inset-x-0 top-0 h-[100svh] supports-[height:100lvh]:h-[100lvh]">
          {/* The beach, panned like a camera walking along it (slower than the scenes: depth). */}
          <div className="absolute inset-y-0 left-0 w-[220%]" style={{ transform: `translateX(-${(pos / (STOPS.length - 1)) * 54.5}%)` }}>
            <HeroBeach shore={0.12} band={[0.2, 0.5]} mode="book" tags={tags} />
          </div>
          {/* A sand veil behind the scenes: the beach is the place, the scene is the subject. */}
          <div className="pointer-events-none absolute inset-x-0 top-[14%] h-[44%] bg-[#f7ebd1]/75" aria-hidden />
          {/* The sea's TOP edge is a shoreline too — the hero's sand above meets it in a gentle wave. */}
          <svg className="pointer-events-none absolute inset-x-0 -top-px h-5 w-[200%] animate-[tour-wave_14s_linear_infinite] motion-reduce:animate-none" viewBox="0 0 1200 20" preserveAspectRatio="none" aria-hidden>
            <path d="M0 0 H1200 V8 C1150 14 1100 14 1050 8 S950 2 900 8 S800 14 750 8 S650 2 600 8 S500 14 450 8 S350 2 300 8 S200 14 150 8 S50 2 0 8 Z" fill="#f7ebd1" />
          </svg>

          {/* Each stop's scene, gliding in with the scroll. */}
          <div className="pointer-events-none absolute inset-x-0 top-[14%] h-[44%] overflow-hidden" aria-hidden>
            <div className="flex h-full" style={{ transform: `translateX(-${pos * 100}%)` }}>
              {STOPS.map((m, i) => (
                <div key={m} className="flex h-full w-full shrink-0 items-center justify-center px-4">
                  <FitScale>
                    {m === 'order' && <OrderScene active={active === i} />}
                    {m === 'rent' && <RentScene active={active === i} />}
                    {m === 'checkin' && <CheckinScene active={active === i} />}
                    {m === 'invoice' && <InvoiceScene active={active === i} />}
                  </FitScale>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* The stop's words: real text, one card visible at a time. */}
        <div className="absolute inset-x-0 bottom-0 px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          <div className="mx-auto grid max-w-xl">
            {STOPS.map((m, i) => (
              <article
                key={m}
                aria-hidden={i !== active}
                className={`col-start-1 row-start-1 self-end rounded-3xl border-2 border-[#0e3a4a] bg-white p-4 shadow-[0_6px_0_#0e3a4a] sm:p-5 transition-all duration-500 motion-reduce:transition-none ${
                  i === active ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-4 opacity-0'
                }`}
              >
                <p className="text-sm font-medium text-[#0083a0]">{t(`${m}.place`)}</p>
                <h2 className="mt-0.5 text-xl font-semibold tracking-tight text-[#0e3a4a] sm:text-2xl">{t(`${m}.title`)}</h2>
                <p className="mt-1.5 text-sm leading-relaxed text-[#0e3a4a]/75 sm:text-[15px]">{t(`${m}.body`)}</p>
                {m === 'invoice' && <p className="mt-2 text-sm text-amber-800">{t('invoice.spain')}</p>}
                <button
                  type="button"
                  tabIndex={i === active ? 0 : -1}
                  onClick={tryIt}
                  className="mt-3 rounded-xl bg-[#0e3a4a] px-5 py-2.5 text-base font-semibold text-white shadow-[0_4px_0_#06222c] transition active:translate-y-[3px] active:shadow-[0_1px_0_#06222c]"
                >
                  {t('try')}
                </button>
              </article>
            ))}
            <div className="mt-3 flex justify-center gap-1.5" aria-hidden>
              {STOPS.map((m, i) => (
                <span key={m} className={`h-1.5 rounded-full transition-all ${i === active ? 'w-8 bg-[#0e3a4a]' : 'w-3 bg-[#0e3a4a]/20'}`} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
