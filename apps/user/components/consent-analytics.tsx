'use client'

import { useEffect, useState } from 'react'
import Script from 'next/script'

const GA_ID = 'G-Y6CN4PSJX1'

export function ConsentAwareAnalytics() {
  const [consented, setConsented] = useState(false)

  useEffect(() => {
    const check = () => {
      const match = document.cookie.match(/(?:^|; )cookie_consent=([^;]*)/)
      setConsented(match?.[1] === 'accepted')
    }
    check()
    window.addEventListener('cookie-consent-update', check)
    return () => window.removeEventListener('cookie-consent-update', check)
  }, [])

  if (!consented) return null

  return (
    <>
      <Script src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`} strategy="afterInteractive" />
      <Script id="ga-init" strategy="afterInteractive">
        {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${GA_ID}');`}
      </Script>
    </>
  )
}
