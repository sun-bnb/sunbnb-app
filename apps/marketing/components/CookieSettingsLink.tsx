'use client'

import { OPEN_CONSENT_EVENT } from './ConsentManager'

export default function CookieSettingsLink({ label }: { label: string }) {
  return (
    <button type="button" className="hover:text-gray-600" onClick={() => window.dispatchEvent(new Event(OPEN_CONSENT_EVENT))}>
      {label}
    </button>
  )
}
