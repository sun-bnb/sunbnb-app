'use client'

import { useEffect } from 'react'
import type { LeadEventName } from '@repo/data/lead-model'
import { setTrackingContext, track } from '@/lib/track.ts'

// Once per page view, even when React mounts an effect twice (dev Strict Mode, fast refresh).
const fired = new Set<string>()

/**
 * Sets the page's tracking context and records one event when the page mounts. `beacon: false`
 * fires only the ad-platform pixel — for events the server already recorded (mockup_created).
 */
export default function TrackOnMount({
  name,
  context,
  props,
  beacon = true,
}: {
  name?: LeadEventName
  context: { token?: string; angle?: string | null; variant?: string | null }
  props?: Record<string, string | number | boolean>
  beacon?: boolean
}) {
  useEffect(() => {
    setTrackingContext(context)
    const key = `${name}:${window.location.pathname}`
    if (name && !fired.has(key)) {
      fired.add(key)
      track(name, props, { beacon })
    }
    // A one-shot marker (`?new=1` after creating a mockup) must not re-fire on refresh or share.
    const url = new URL(window.location.href)
    if (url.searchParams.has('new')) {
      url.searchParams.delete('new')
      window.history.replaceState(null, '', url.pathname + url.search + url.hash)
    }
    // Once per page view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return null
}
