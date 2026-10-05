'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'
import { CONSENT_COOKIE, CONSENT_MAX_AGE_S, readConsentCookie, serializeConsent } from '@/lib/consent.ts'
import { track } from '@/lib/track.ts'

const META_PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID
const GOOGLE_ADS_ID = process.env.NEXT_PUBLIC_GOOGLE_ADS_ID

/** Fired by the footer's "Cookie settings" link to reopen the banner. */
export const OPEN_CONSENT_EVENT = 'sb:open-consent'

/**
 * Cookie banner + ad-tag loader (track 027 P8, D8). Meta Pixel and Google Ads tags are injected
 * ONLY after the visitor accepts marketing cookies, and only when their IDs are configured —
 * before that, `window.fbq` / `window.gtag` don't exist and no request reaches Meta or Google.
 */
export default function ConsentManager() {
  const t = useTranslations('Consent')
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const state = readConsentCookie(document.cookie)
    if (state === null) setOpen(true)
    else if (state.marketing) loadMarketingTags()
    const reopen = () => setOpen(true)
    window.addEventListener(OPEN_CONSENT_EVENT, reopen)
    return () => window.removeEventListener(OPEN_CONSENT_EVENT, reopen)
  }, [])

  function choose(marketing: boolean) {
    document.cookie = `${CONSENT_COOKIE}=${serializeConsent(marketing, Date.now())}; Max-Age=${CONSENT_MAX_AGE_S}; Path=/; SameSite=Lax; Secure`
    setOpen(false)
    track(marketing ? 'consent_marketing' : 'consent_necessary')
    if (marketing) loadMarketingTags()
    // Withdrawing consent after tags loaded: they stay in memory until the next page load, which
    // is the norm; nothing new is installed and the cookie now says no.
  }

  if (!open) return null
  return (
    <div role="dialog" aria-live="polite" aria-label={t('title')} className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-xl rounded-xl border border-gray-200 bg-white p-4 shadow-lg sm:inset-x-auto sm:right-4">
      <p className="text-sm text-gray-700">
        {
          // next-intl's rich-text types resolve the hoisted @types/react 19; this app is on 18.
          t.rich('body', {
            link: (chunks) => (
              <Link href="/privacy" className="underline hover:text-gray-900">
                {chunks as React.ReactNode}
              </Link>
            ),
          }) as React.ReactNode
        }
      </p>
      {/* Equal weight on purpose: refusing must be as easy as accepting. */}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button type="button" className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50" onClick={() => choose(false)}>
          {t('necessary')}
        </button>
        <button type="button" className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50" onClick={() => choose(true)}>
          {t('accept')}
        </button>
      </div>
    </div>
  )
}

let tagsLoaded = false

function loadMarketingTags() {
  if (tagsLoaded) return
  tagsLoaded = true
  if (META_PIXEL_ID) {
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
    window.fbq?.('init', META_PIXEL_ID)
    window.fbq?.('track', 'PageView')
  }
  if (GOOGLE_ADS_ID) {
    const w = window as unknown as { dataLayer: unknown[] } & Window
    w.dataLayer = w.dataLayer || []
    w.gtag = function () {
      // gtag requires the arguments object itself, not an array.
      // eslint-disable-next-line prefer-rest-params
      w.dataLayer.push(arguments)
    }
    window.gtag?.('js', new Date())
    window.gtag?.('config', GOOGLE_ADS_ID)
    const s = document.createElement('script')
    s.async = true
    s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GOOGLE_ADS_ID)}`
    document.head.appendChild(s)
  }
}
