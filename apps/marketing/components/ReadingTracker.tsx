'use client'

import { useEffect } from 'react'
import { track } from '@/lib/track.ts'
import { newScrollMarks } from '@/lib/tracking-plan.ts'

/**
 * How far down the landing page visitors read (track 027): scroll depth at 25/50/75/100 % and each
 * `[data-track-section]` once, when its top reaches the middle of the screen (a tall section like
 * the beach tour never shows half of itself at once, so a visibility ratio would never fire).
 */
export default function ReadingTracker() {
  useEffect(() => {
    const sent = new Set<number>()
    let frame = 0
    const onScroll = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const el = document.documentElement
        const max = el.scrollHeight
        if (max <= 0) return
        for (const mark of newScrollMarks((window.scrollY + window.innerHeight) / max, sent)) {
          sent.add(mark)
          track('scroll_depth', { pct: mark })
        }
      })
    }
    window.addEventListener('scroll', onScroll, { passive: true })

    const seen = new Set<string>()
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const section = (e.target as HTMLElement).dataset.trackSection
          if (!e.isIntersecting || !section || seen.has(section)) continue
          seen.add(section)
          track('section_view', { section })
          io.unobserve(e.target)
        }
      },
      { rootMargin: '0px 0px -50% 0px' },
    )
    document.querySelectorAll('[data-track-section]').forEach((el) => io.observe(el))
    return () => {
      window.removeEventListener('scroll', onScroll)
      cancelAnimationFrame(frame)
      io.disconnect()
    }
  }, [])
  return null
}
