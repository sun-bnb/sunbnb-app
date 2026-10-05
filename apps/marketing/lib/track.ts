'use client'

/**
 * Client funnel tracking (track 027 P8). One call site per funnel moment:
 *   track('cta_click', { step: 7 })
 * Always records a first-party event (sendBeacon → /api/events). The ad platforms only hear about
 * the few CONVERSION events, and only when marketing consent is on (MarketingTags installs
 * window.fbq / window.gtag after consent; before that they don't exist and nothing is sent).
 */
import type { LeadEventName } from '@repo/data/lead-model'

type Props = Record<string, string | number | boolean>

let context: { token?: string; angle?: string | null; variant?: string | null } = {}

/** Set once per page: the lead token (mockup page) or the ad angle/arm (landing). */
export function setTrackingContext(c: typeof context) {
  context = { ...context, ...c }
}

/**
 * Funnel events that are ad-platform conversions: Meta standard events, and Google Ads conversion
 * actions (an Ads conversion only counts when sent to its `AW-…/label`, configured per action).
 */
const GOOGLE_ADS_ID = process.env.NEXT_PUBLIC_GOOGLE_ADS_ID
const GOOGLE_LABELS = {
  mockup: process.env.NEXT_PUBLIC_GOOGLE_ADS_LABEL_MOCKUP,
  lead: process.env.NEXT_PUBLIC_GOOGLE_ADS_LABEL_LEAD,
  signup: process.env.NEXT_PUBLIC_GOOGLE_ADS_LABEL_SIGNUP,
}
const CONVERSIONS: Partial<Record<LeadEventName, { meta: string; google: keyof typeof GOOGLE_LABELS }>> = {
  mockup_created: { meta: 'ViewContent', google: 'mockup' },
  demo_requested: { meta: 'Lead', google: 'lead' },
  signup_done: { meta: 'CompleteRegistration', google: 'signup' },
  claim_done: { meta: 'CompleteRegistration', google: 'signup' },
}

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void
    gtag?: (...args: unknown[]) => void
  }
}

export function track(name: LeadEventName, props?: Props, opts: { beacon?: boolean } = {}) {
  if (typeof window === 'undefined') return
  const body = JSON.stringify({ name, props, token: context.token, angle: context.angle, variant: context.variant })
  try {
    if (opts.beacon !== false && !navigator.sendBeacon?.('/api/events', body)) {
      void fetch('/api/events', { method: 'POST', body, keepalive: true }).catch(() => {})
    }
  } catch {
    /* tracking must never break the page */
  }
  const conv = CONVERSIONS[name]
  if (conv) {
    // event_id lets server-side conversions (P14) de-duplicate against these.
    const eventId = `${context.token ?? 'anon'}:${name}`
    window.fbq?.('track', conv.meta, {}, { eventID: eventId })
    const label = GOOGLE_LABELS[conv.google]
    if (GOOGLE_ADS_ID && label) window.gtag?.('event', 'conversion', { send_to: `${GOOGLE_ADS_ID}/${label}`, transaction_id: eventId })
  }
}
