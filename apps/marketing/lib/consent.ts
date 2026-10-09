/**
 * Cookie consent for try.sunbnb.app (track 027 P8) — pure rules, shared by the banner, the tag
 * loader and tests. Separate from the demo form's CONSENT_VERSION: that one versions the privacy
 * notice a prospect agreed to when leaving contact details; this one versions the cookie choice.
 */
/** '2026-10-09': GA4 + PostHog (session recordings) joined the marketing choice — ask everyone again. */
export const COOKIE_CONSENT_VERSION = '2026-10-09'
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

/** Google Consent Mode v2 signals (EEA ad measurement and remarketing need all four). */
export type GoogleConsent = Record<'ad_storage' | 'analytics_storage' | 'ad_user_data' | 'ad_personalization', 'granted' | 'denied'>

/**
 * The signals for a marketing-cookie choice. We run Consent Mode in BASIC mode: no Google tag loads
 * before "accept", so the default sent when it loads is always the granted set, and a withdrawal
 * after loading updates everything to denied.
 */
export function googleConsent(marketing: boolean): GoogleConsent {
  const v = marketing ? 'granted' : 'denied'
  return { ad_storage: v, analytics_storage: v, ad_user_data: v, ad_personalization: v }
}
