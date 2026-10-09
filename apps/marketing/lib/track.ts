'use client'

/**
 * Client tracking (track 027 P8). One call site per funnel moment:
 *   track('cta_click', { step: 7 })
 * Always records a first-party event (sendBeacon → /api/events). The tags — Meta, Google
 * (GA4 + Ads), PostHog — hear about it too, but they only exist after marketing consent
 * (`lib/marketing-tags.ts`); before that the calls go nowhere. Routing rules: `lib/tracking-plan.ts`.
 */
import type { LeadEventName } from '@repo/data/lead-model'
import { capturePosthog } from './marketing-tags.ts'
import { planEvent, type AnalyticsEventName, type Props, type TagConfig, type TrackingContext } from './tracking-plan.ts'

let context: TrackingContext = {}

/** Set once per page: the lead token (mockup page) or the ad angle/arm (landing). */
export function setTrackingContext(c: TrackingContext) {
  context = { ...context, ...c }
}

const CONFIG: TagConfig = {
  googleAdsId: process.env.NEXT_PUBLIC_GOOGLE_ADS_ID,
  ga4Id: process.env.NEXT_PUBLIC_GA4_ID,
  adsLabels: {
    mockup: process.env.NEXT_PUBLIC_GOOGLE_ADS_LABEL_MOCKUP,
    lead: process.env.NEXT_PUBLIC_GOOGLE_ADS_LABEL_LEAD,
    signup: process.env.NEXT_PUBLIC_GOOGLE_ADS_LABEL_SIGNUP,
  },
}

/** A funnel event. `beacon: false` skips the first-party record (the server already wrote it). */
export function track(name: LeadEventName, props?: Props, opts: { beacon?: boolean } = {}) {
  send(name, props, opts)
}

/** A measurement for the analytics tools only (GA4 / PostHog) — not a funnel step. */
export function trackAnalytics(name: AnalyticsEventName, props?: Props) {
  send(name, props)
}

function send(name: LeadEventName | AnalyticsEventName, props: Props | undefined, opts: { beacon?: boolean } = {}) {
  if (typeof window === 'undefined') return
  try {
    const plan = planEvent(name, props, context, CONFIG, opts)
    if (plan.beacon) {
      const body = JSON.stringify({ name, props, token: context.token, angle: context.angle, variant: context.variant })
      if (!navigator.sendBeacon?.('/api/events', body)) {
        void fetch('/api/events', { method: 'POST', body, keepalive: true }).catch(() => {})
      }
    }
    for (const call of plan.fbq) window.fbq?.(...call)
    for (const call of plan.gtag) window.gtag?.(...call)
    capturePosthog(plan.posthog.event, plan.posthog.properties)
  } catch {
    /* tracking must never break the page */
  }
}
