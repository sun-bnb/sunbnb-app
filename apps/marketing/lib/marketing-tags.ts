'use client'

/**
 * The third-party tags behind the marketing-cookie choice (track 027 P8, D8). Each loads ONLY after
 * the visitor accepts and only when its ID is configured — before that, `window.fbq` /
 * `window.gtag` / PostHog don't exist and no request reaches Meta, Google or PostHog.
 *
 *  - Meta Pixel        NEXT_PUBLIC_META_PIXEL_ID
 *  - Google tag        NEXT_PUBLIC_GA4_ID and/or NEXT_PUBLIC_GOOGLE_ADS_ID (one gtag.js, both configs),
 *                      with Consent Mode v2 signals (basic mode: granted on load, denied on withdrawal)
 *  - PostHog (EU)      NEXT_PUBLIC_POSTHOG_KEY, through the first-party /ingest proxy (next.config)
 */
import type { PostHog } from 'posthog-js'
import { googleConsent } from './consent.ts'

const META_PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID
const GOOGLE_ADS_ID = process.env.NEXT_PUBLIC_GOOGLE_ADS_ID
const GA4_ID = process.env.NEXT_PUBLIC_GA4_ID
const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void
    gtag?: (...args: unknown[]) => void
  }
}

let loaded = false
let posthog: PostHog | null = null
/** Captures made while PostHog's bundle is still loading (the first seconds after "accept"). */
let pending: [string, Record<string, unknown>][] | null = null

export function capturePosthog(event: string, properties: Record<string, unknown>) {
  if (posthog) posthog.capture(event, properties)
  else if (pending) pending.push([event, properties])
}

export function loadMarketingTags() {
  if (loaded) {
    // Accepted again after withdrawing on this same page view: lift the revocation.
    window.gtag?.('consent', 'update', googleConsent(true))
    window.fbq?.('consent', 'grant')
    if (posthog?.has_opted_out_capturing()) posthog.opt_in_capturing()
    return
  }
  loaded = true
  if (META_PIXEL_ID) loadMetaPixel(META_PIXEL_ID)
  if (GOOGLE_ADS_ID || GA4_ID) loadGoogleTag()
  if (POSTHOG_KEY) loadPosthog(POSTHOG_KEY)
}

/**
 * Consent withdrawn after the tags loaded this page view: tell each one to stop. The scripts stay
 * in memory until the next page load (the norm); from then on the cookie says no and nothing loads.
 */
export function revokeMarketingTags() {
  if (!loaded) return
  window.gtag?.('consent', 'update', googleConsent(false))
  window.fbq?.('consent', 'revoke')
  posthog?.opt_out_capturing()
  pending = null
}

function loadMetaPixel(id: string) {
  // Meta's standard base code, inlined so nothing is fetched before this point.
  const w = window as unknown as Record<string, unknown> & Window
  if (!w.fbq) {
    const fbq = function (...args: unknown[]) {
      const self = fbq as unknown as { callMethod?: (...a: unknown[]) => void; queue: unknown[] }
      if (self.callMethod) self.callMethod(...args)
      else self.queue.push(args)
    } as unknown as Window['fbq'] & { queue: unknown[]; loaded: boolean; version: string; push: unknown }
    fbq!.queue = []
    fbq!.loaded = true
    fbq!.version = '2.0'
    fbq!.push = fbq
    w.fbq = fbq
    w._fbq = fbq
    const s = document.createElement('script')
    s.async = true
    s.src = 'https://connect.facebook.net/en_US/fbevents.js'
    document.head.appendChild(s)
  }
  window.fbq?.('consent', 'grant')
  window.fbq?.('init', id)
  window.fbq?.('track', 'PageView')
}

function loadGoogleTag() {
  const w = window as unknown as { dataLayer: unknown[] } & Window
  w.dataLayer = w.dataLayer || []
  w.gtag = function () {
    // gtag requires the arguments object itself, not an array.
    // eslint-disable-next-line prefer-rest-params
    w.dataLayer.push(arguments)
  }
  // Consent Mode v2 must be set before any config: EEA conversions and remarketing need it.
  window.gtag?.('consent', 'default', googleConsent(true))
  window.gtag?.('js', new Date())
  if (GA4_ID) window.gtag?.('config', GA4_ID)
  if (GOOGLE_ADS_ID) window.gtag?.('config', GOOGLE_ADS_ID)
  const s = document.createElement('script')
  s.async = true
  s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent((GA4_ID ?? GOOGLE_ADS_ID)!)}`
  document.head.appendChild(s)
}

function loadPosthog(key: string) {
  pending = []
  // Imported on consent only: the bundle (and its cookie/localStorage) never exists before it.
  void import('posthog-js')
    .then(({ default: ph }) => {
      if (pending === null) return // withdrawn while loading
      ph.init(key, {
        api_host: '/ingest', // first-party proxy (next.config.mjs) → eu.i.posthog.com
        ui_host: 'https://eu.posthog.com',
        person_profiles: 'identified_only',
        capture_pageview: 'history_change', // "Build" moves the address to /m/<token> without a navigation
        capture_pageleave: true,
        disable_session_recording: false,
        session_recording: { maskAllInputs: true },
      })
      // One PostHog project serves production and the previews (the free plan has one project);
      // every event carries its Vercel environment, and the project's test-account filter drops
      // the preview hosts from reports.
      ph.register({ environment: process.env.NEXT_PUBLIC_APP_ENV ?? 'development' })
      // Re-accepting after an earlier withdrawal: the opt-out is persisted, so lift it.
      if (ph.has_opted_out_capturing()) ph.opt_in_capturing()
      posthog = ph
      const queued = pending
      pending = null
      for (const [event, props] of queued) ph.capture(event, props)
    })
    .catch(() => {
      pending = null // analytics must never break the page
    })
}
