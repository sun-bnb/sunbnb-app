'use client'

/**
 * Consent-gated Google Analytics 4 for the user and partner apps (the marketing app has its own
 * tag loader in apps/marketing/lib/marketing-tags.ts). Pairs with `./cookie-consent`: nothing
 * from Google loads until the visitor accepts (`cookie_consent=accepted`). Consent Mode v2 runs
 * in BASIC mode — the tag only exists after "accept", so it is configured as granted; changing
 * the choice to essential-only afterwards updates every signal to denied.
 *
 * Usage: render `<GoogleAnalytics measurementId={process.env.NEXT_PUBLIC_GA4_ID} />` once in the
 * root layout (no id → renders nothing), and call `gaEvent('purchase', {...})` at funnel moments.
 */
import Script from 'next/script'
import { useEffect, useState } from 'react'

declare global {
  interface Window {
    dataLayer?: unknown[]
    gtag?: (...args: unknown[]) => void
  }
}

const CONSENT_COOKIE = 'cookie_consent'
type ConsentValue = 'granted' | 'denied'

function readConsent(): boolean {
  return new RegExp(`(?:^|; )${CONSENT_COOKIE}=accepted(?:;|$)`).test(document.cookie)
}

/** The four Consent Mode v2 signals (EEA ad measurement and remarketing need all of them). */
export function consentSignals(granted: boolean): Record<'ad_storage' | 'analytics_storage' | 'ad_user_data' | 'ad_personalization', ConsentValue> {
  const v: ConsentValue = granted ? 'granted' : 'denied'
  return { ad_storage: v, analytics_storage: v, ad_user_data: v, ad_personalization: v }
}

/**
 * Send a GA4 event. A no-op before consent (gtag doesn't exist yet) and on the server, so call
 * sites never need to check. Use GA4 recommended names where one fits (sign_up, login,
 * begin_checkout, purchase, generate_lead …); never put personal data (email, name) in params.
 */
export function gaEvent(name: string, params?: Record<string, unknown>) {
  if (typeof window === 'undefined') return
  try {
    window.gtag?.('event', name, params ?? {})
  } catch {
    /* analytics must never break the page */
  }
}

export function GoogleAnalytics({ measurementId }: { measurementId?: string }) {
  const [consented, setConsented] = useState(false)

  useEffect(() => {
    const check = () => {
      const now = readConsent()
      // Withdrawal after the tag loaded: it stays in memory until the next page load, so tell it.
      if (!now) window.gtag?.('consent', 'update', consentSignals(false))
      setConsented(now)
    }
    check()
    window.addEventListener('cookie-consent-update', check)
    return () => window.removeEventListener('cookie-consent-update', check)
  }, [])

  if (!measurementId || !consented) return null

  const init = [
    'window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}window.gtag=gtag;',
    `gtag('consent','default',${JSON.stringify(consentSignals(true))});`,
    "gtag('js',new Date());",
    `gtag('config',${JSON.stringify(measurementId)});`,
  ].join('')

  return (
    <>
      <Script id="ga4-init" strategy="afterInteractive">{init}</Script>
      <Script src={`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`} strategy="afterInteractive" />
    </>
  )
}
