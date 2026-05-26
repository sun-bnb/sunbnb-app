'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'

// The widget is hosted on the consumer app; NEXT_PUBLIC_APP_URL points there
// (same var the QR-code/POS links use).
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://sunbnb.app'

/** Copy-paste embed snippet for the venue's own website. */
export function EmbedCodeCard({ restaurantId }: { restaurantId: string }) {
  const t = useTranslations('Restaurant')
  const [copied, setCopied] = useState(false)

  const snippet = `<script src="${APP_URL}/embed.js" data-restaurant="${restaurantId}" async></script>`

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(snippet)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* clipboard unavailable — the operator can select the text manually */
    }
  }

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <h3 className="text-sm font-medium text-gray-700 mb-1">{t('embedHeading')}</h3>
      <p className="text-xs text-gray-500 mb-3">{t('embedHint')}</p>
      <pre className="overflow-x-auto rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-800">
        <code>{snippet}</code>
      </pre>
      <button
        type="button"
        onClick={copy}
        className="mt-3 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100"
      >
        {copied ? t('embedCopied') : t('embedCopy')}
      </button>
    </section>
  )
}
