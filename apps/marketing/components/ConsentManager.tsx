'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'
import { CONSENT_COOKIE, CONSENT_MAX_AGE_S, readConsentCookie, serializeConsent } from '@/lib/consent.ts'
import { loadMarketingTags, revokeMarketingTags } from '@/lib/marketing-tags.ts'
import { track } from '@/lib/track.ts'

/** Fired by the footer's "Cookie settings" link to reopen the banner. */
export const OPEN_CONSENT_EVENT = 'sb:open-consent'

/**
 * Cookie banner (track 027 P8, D8). The marketing tags (Meta Pixel, Google GA4/Ads, PostHog —
 * `lib/marketing-tags.ts`) load ONLY after the visitor accepts, and only when their IDs are
 * configured; before that no request reaches Meta, Google or PostHog.
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
    // Withdrawing after the tags loaded: each is told to stop now (Consent Mode denied, Pixel
    // revoked, PostHog opted out); from the next page load nothing loads at all.
    else revokeMarketingTags()
  }

  if (!open) return null
  return (
    <div role="dialog" aria-live="polite" aria-label={t('title')} className="fixed inset-x-3 top-3 z-50 mx-auto max-w-xl rounded-xl border border-gray-200 bg-white p-4 shadow-lg sm:inset-x-auto sm:bottom-3 sm:right-4 sm:top-auto">
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
