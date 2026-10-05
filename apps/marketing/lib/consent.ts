/**
 * Cookie consent for try.sunbnb.app (track 027 P8) — pure rules, shared by the banner, the tag
 * loader and tests. Separate from the demo form's CONSENT_VERSION: that one versions the privacy
 * notice a prospect agreed to when leaving contact details; this one versions the cookie choice.
 */
export const COOKIE_CONSENT_VERSION = '2026-10-05'
export const CONSENT_COOKIE = 'sb_consent'
/** ~6 months, then ask again (common EU DPA guidance is ≤ 13 months). */
export const CONSENT_MAX_AGE_S = 182 * 24 * 60 * 60

export interface ConsentState {
  marketing: boolean
  at: number
}

/** The stored choice, or null when the visitor hasn't chosen under the current version. */
export function parseConsentCookie(raw: string | null | undefined): ConsentState | null {
  if (!raw) return null
  try {
    const v = JSON.parse(decodeURIComponent(raw)) as { v?: unknown; m?: unknown; at?: unknown }
    if (v.v !== COOKIE_CONSENT_VERSION || (v.m !== 0 && v.m !== 1) || typeof v.at !== 'number') return null
    return { marketing: v.m === 1, at: v.at }
  } catch {
    return null
  }
}

export function serializeConsent(marketing: boolean, now: number): string {
  return encodeURIComponent(JSON.stringify({ v: COOKIE_CONSENT_VERSION, m: marketing ? 1 : 0, at: now }))
}

export function readConsentCookie(cookieHeader: string): ConsentState | null {
  const match = cookieHeader.split(';').map((c) => c.trim()).find((c) => c.startsWith(`${CONSENT_COOKIE}=`))
  return parseConsentCookie(match?.slice(CONSENT_COOKIE.length + 1))
}
