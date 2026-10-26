'use client'

/**
 * Consent-gated PostHog (EU cloud) for the user and partner apps — the same project and setup as
 * try.sunbnb.app (apps/marketing/lib/marketing-tags.ts). Pairs with `./cookie-consent`: the
 * posthog-js bundle is imported only after the visitor accepts (`cookie_consent=accepted`), so no
 * request, cookie or localStorage key exists before it. Requests go through the app's own
 * `/ingest` rewrite (next.config.mjs) so ad blockers don't drop consented analytics.
 *
 * Usage: render `<PostHogAnalytics apiKey={process.env.NEXT_PUBLIC_POSTHOG_KEY} app="user"
 * environment={process.env.NEXT_PUBLIC_APP_ENV} userId={session?.user?.id} />`
 * once in the root layout (no key → renders nothing). Pageviews, autocapture, session replay
 * (inputs masked) and web vitals are automatic; funnel events arrive via `gaEvent` in
 * `./google-analytics`, which forwards every event here too.
 */
import type { PostHog } from 'posthog-js'
import { useEffect } from 'react'

const CONSENT_COOKIE = 'cookie_consent'

let posthog: PostHog | null = null
let loading = false
/** Captures made while the bundle is still loading (the first seconds after "accept"). */
let pending: [string, Record<string, unknown>][] = []
/** The signed-in user to identify once loaded; `null` = anonymous. */
let identity: string | null = null

function readConsent(): boolean {
  return new RegExp(`(?:^|; )${CONSENT_COOKIE}=accepted(?:;|$)`).test(document.cookie)
}

/** Send a PostHog event. A no-op before consent and on the server; never put email/name in props. */
export function posthogEvent(name: string, properties?: Record<string, unknown>) {
  if (typeof window === 'undefined') return
  try {
    if (posthog) posthog.capture(name, properties)
    else if (loading) pending.push([name, properties ?? {}])
  } catch {
    /* analytics must never break the page */
  }
}

function applyIdentity(ph: PostHog) {
  if (identity) {
    if (ph.get_distinct_id() !== identity) ph.identify(identity)
  } else if (ph._isIdentified()) {
    ph.reset() // signed out: the next visitor on this browser starts anonymous
  }
}

function load(apiKey: string, app: string, environment: string) {
  if (posthog) {
    // Accepted again after withdrawing on this same page view: lift the opt-out.
    if (posthog.has_opted_out_capturing()) posthog.opt_in_capturing()
    return
  }
  if (loading) return
  loading = true
  void import('posthog-js')
    .then((mod) => {
      // This package's CJS-style resolution types the default export as the module namespace;
      // the apps' bundler resolution (and the runtime) give the PostHog instance.
      const ph = (mod as unknown as { default: PostHog }).default
      if (!loading) return // withdrawn while loading
      ph.init(apiKey, {
        api_host: '/ingest', // first-party rewrite (next.config.mjs) → eu.i.posthog.com
        ui_host: 'https://eu.posthog.com',
        person_profiles: 'identified_only',
        capture_pageview: 'history_change', // App Router navigations are client-side
        capture_pageleave: true,
        capture_performance: { web_vitals: true },
        disable_session_recording: false,
        session_recording: { maskAllInputs: true },
      })
      // One PostHog project serves every app and environment (the free plan has one project):
      // each event carries both, and the project's test-account filter drops non-production hosts.
      ph.register({ app, environment })
      // Re-accepting after an earlier withdrawal: the opt-out is persisted, so lift it.
      if (ph.has_opted_out_capturing()) ph.opt_in_capturing()
      applyIdentity(ph)
      posthog = ph
      loading = false
      const queued = pending
      pending = []
      for (const [event, props] of queued) ph.capture(event, props)
    })
    .catch(() => {
      loading = false
      pending = []
    })
}

export function PostHogAnalytics({ apiKey, app, environment = 'development', userId }: {
  apiKey?: string
  /** Super-property telling the apps apart in the shared project: 'user' | 'partner'. */
  app: string
  /** The Vercel environment (`NEXT_PUBLIC_APP_ENV`), registered on every event. */
  environment?: string
  /** Internal user id of the signed-in user (never email); omit when anonymous or impersonating. */
  userId?: string | null
}) {
  useEffect(() => {
    identity = userId ?? null
    if (posthog) applyIdentity(posthog)
  }, [userId])

  useEffect(() => {
    if (!apiKey) return
    const check = () => {
      if (readConsent()) load(apiKey, app, environment)
      else {
        // Withdrawal after loading: the bundle stays in memory until the next page load, so stop it.
        posthog?.opt_out_capturing()
        loading = false
        pending = []
      }
    }
    check()
    window.addEventListener('cookie-consent-update', check)
    return () => window.removeEventListener('cookie-consent-update', check)
  }, [apiKey, app, environment])

  return null
}
