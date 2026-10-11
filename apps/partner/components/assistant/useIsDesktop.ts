'use client'

import { useSyncExternalStore } from 'react'

/** Tailwind `lg` (1024px) - below it the inventory map editor is not offered. */
const DESKTOP_QUERY = '(min-width: 1024px)'

export function useIsDesktop(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(DESKTOP_QUERY)
      mq.addEventListener('change', cb)
      return () => mq.removeEventListener('change', cb)
    },
    () => window.matchMedia(DESKTOP_QUERY).matches,
    () => true,
  )
}
