'use client'

import { usePathname } from 'next/navigation'
import { CookieConsent } from '@repo/ui/cookie-consent'

// Site-detail pages (`/sites/[id]` and branded `/s/[slug]`) render their own
// sticky cookie dialog below the search bar, so suppress the global bottom
// banner there to avoid showing two dialogs at once.
const SITE_DETAIL = /^\/(?:sites|s)\/[^/]+$/

export function GlobalCookieConsent() {
  const pathname = usePathname()
  if (SITE_DETAIL.test(pathname)) return null
  return <CookieConsent hasAnalytics />
}
