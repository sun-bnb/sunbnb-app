'use client'

import { useEffect, useState } from 'react'

const COOKIE_NAME = 'cookie_consent'
const COOKIE_MAX_AGE = 365 * 24 * 60 * 60 // 1 year

function getCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`))
  return match ? decodeURIComponent(match[1]!) : null
}

function setCookie(name: string, value: string, maxAge: number) {
  const secure = typeof window !== 'undefined' && window.location.protocol === 'https:' ? ';Secure' : ''
  document.cookie = `${name}=${encodeURIComponent(value)};path=/;max-age=${maxAge};SameSite=Lax${secure}`
}

export function CookieConsent({
  privacyHref = '/privacy',
  hasAnalytics = false,
  placement = 'bottom',
  forceVisible = false,
  stickyOffsetClass = 'top-0',
}: {
  privacyHref?: string
  hasAnalytics?: boolean
  /** 'bottom' (default) = fixed floating banner; 'top' = sticky bar in flow (below the search bar). */
  placement?: 'bottom' | 'top'
  /** Always show regardless of the stored consent cookie — for placement testing. */
  forceVisible?: boolean
  /** Tailwind `top-*` offset for the sticky top bar (e.g. 'top-[80px]' below a fixed header). */
  stickyOffsetClass?: string
}) {
  const [visible, setVisible] = useState(forceVisible)

  useEffect(() => {
    if (forceVisible) return
    if (!getCookie(COOKIE_NAME)) setVisible(true)
  }, [forceVisible])

  if (!visible) return null

  const respond = (value: 'accepted' | 'essential-only') => {
    setCookie(COOKIE_NAME, value, COOKIE_MAX_AGE)
    window.dispatchEvent(new Event('cookie-consent-update'))
    // While force-visible (test mode) keep the dialog pinned so placement stays inspectable.
    if (!forceVisible) setVisible(false)
  }

  const card = (
    <div className="pointer-events-auto bg-white/95 backdrop-blur border border-gray-200 shadow-lg rounded-lg px-4 py-2.5 flex items-center gap-3 max-w-lg text-xs text-gray-600">
      <p>
        {hasAnalytics
          ? <>We use essential cookies and analytics to improve the service. <a href={privacyHref} className="underline hover:text-gray-900">Privacy policy</a></>
          : <>We use cookies for authentication and essential site functions. <a href={privacyHref} className="underline hover:text-gray-900">Privacy policy</a></>
        }
      </p>
      <div className="flex gap-2 shrink-0">
        {hasAnalytics && (
          <button
            onClick={() => respond('essential-only')}
            className="text-xs font-medium px-3 py-1.5 rounded-md border border-gray-300 text-gray-600 hover:bg-gray-100 transition-colors"
          >
            Decline
          </button>
        )}
        <button
          onClick={() => respond('accepted')}
          className="bg-gray-900 text-white text-xs font-medium px-3 py-1.5 rounded-md hover:bg-gray-800 transition-colors"
        >
          {hasAnalytics ? 'Accept all' : 'OK'}
        </button>
      </div>
    </div>
  )

  if (placement === 'top') {
    // Sticky bar that lives in normal flow at the top of the page, pinned just
    // below the search bar (or the very top when there is none). z-40 keeps it
    // under the fixed header (z-50) while sitting above page content.
    return (
      <div className={`sticky ${stickyOffsetClass} z-40 px-3 py-2 flex justify-center pointer-events-none`}>
        {card}
      </div>
    )
  }

  return (
    <div className="fixed bottom-0 left-0 right-0 z-[9999] p-3 flex justify-center pointer-events-none">
      {card}
    </div>
  )
}
