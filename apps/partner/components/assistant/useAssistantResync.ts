'use client'

import { useEffect, useRef } from 'react'
import { onAssistantApplied } from './proposal-events'
import { concerns } from '@/lib/resync'

/**
 * Run `refetch` whenever the assistant applies/undoes a proposal of one of `kinds`.
 * `router.refresh()` re-renders server components but never resets client `useState`, so a tab
 * holding a client copy of assistant-writable data must pull fresh values itself. `refetch` is held
 * in a ref so callers can pass an inline closure without resubscribing every render.
 */
export function useAssistantResync(kinds: readonly string[], refetch: (kind: string) => void | Promise<void>): void {
  const refetchRef = useRef(refetch)
  refetchRef.current = refetch
  const kindsKey = kinds.join(',')
  useEffect(() => {
    const list = kindsKey.split(',')
    return onAssistantApplied(({ kind, target }) => {
      if (concerns(list, kind, target)) void refetchRef.current(kind)
    })
  }, [kindsKey])
}
