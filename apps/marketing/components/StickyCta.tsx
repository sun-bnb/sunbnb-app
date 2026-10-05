'use client'

import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'
import { track } from '@/lib/track.ts'

let viewTracked = false

/**
 * Mobile sticky call-to-action (track 027 P8): always one thumb away from the demo form, hidden
 * once the form itself is on screen so it never covers the thing it points to.
 */
export default function StickyCta({ targetId }: { targetId: string }) {
  const t = useTranslations('Cta')
  const [hidden, setHidden] = useState(false)

  useEffect(() => {
    const target = document.getElementById(targetId)
    if (!target) return
    const io = new IntersectionObserver(([e]) => setHidden(Boolean(e?.isIntersecting)), { threshold: 0.2 })
    io.observe(target)
    if (!viewTracked) {
      viewTracked = true
      track('cta_view', { place: 'sticky' })
    }
    return () => io.disconnect()
  }, [targetId])

  if (hidden) return null
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-gray-200 bg-white/95 p-3 backdrop-blur lg:hidden">
      <button
        type="button"
        className="btn-primary-lg w-full"
        onClick={() => {
          track('cta_click', { place: 'sticky' })
          document.getElementById(targetId)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }}
      >
        {t('bookDemo')}
      </button>
    </div>
  )
}
