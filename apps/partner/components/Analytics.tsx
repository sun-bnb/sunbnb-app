'use client'

import { useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { gaEvent } from '@repo/ui/google-analytics'
import { hasFired, markFired, type GaAuthEvent } from '@/lib/analytics'

const POLL_MS = 250
const GIVE_UP_MS = 20_000

/**
 * Fire a GA4 event at most once per `onceKey` (per browser), safely across page loads.
 *
 * The GA tag only exists after consent and loads `afterInteractive`, i.e. AFTER hydration, so a
 * mount-effect on a freshly loaded page (OAuth return, Stripe return) would otherwise be lost.
 * We wait for `window.gtag`; if consent never arrives we give up WITHOUT consuming the key, so
 * the event still fires on a later visit once the visitor accepts.
 * Returns a cancel function.
 */
export function trackOnce(onceKey: string, name: string, params?: Record<string, unknown>): () => void {
  if (typeof window === 'undefined') return () => {}
  if (hasFired(window.localStorage, onceKey)) return () => {}
  const started = Date.now()
  const attempt = () => {
    if (typeof window.gtag === 'function') {
      if (hasFired(window.localStorage, onceKey)) return true
      markFired(window.localStorage, onceKey)
      gaEvent(name, params)
      return true
    }
    return false
  }
  if (attempt()) return () => {}
  const timer = window.setInterval(() => {
    if (attempt() || Date.now() - started > GIVE_UP_MS) window.clearInterval(timer)
  }, POLL_MS)
  return () => window.clearInterval(timer)
}

/** Renders nothing; fires one GA4 event when mounted (guarded by `onceKey`). */
export function TrackEvent({ name, params, onceKey }: { name: string; params?: Record<string, unknown>; onceKey: string }) {
  const serialized = JSON.stringify(params ?? {})
  useEffect(() => trackOnce(onceKey, name, JSON.parse(serialized)), [onceKey, name, serialized])
  return null
}

/**
 * Sends the `sign_up` / `login` event stamped on the session at sign-in (see the jwt callback in
 * app/auth.ts). Once per sign-in, keyed on the sign-in timestamp.
 */
export function AuthEvents() {
  const { data } = useSession()
  const ga = (data as { ga?: GaAuthEvent } | null)?.ga
  const event = ga?.event
  const method = ga?.method
  const at = ga?.at
  useEffect(() => {
    if (!event || !method || !at) return
    return trackOnce(`auth:${at}`, event, { method })
  }, [event, method, at])
  return null
}
