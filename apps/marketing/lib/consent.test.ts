import { describe, expect, it } from 'vitest'
import { CONSENT_COOKIE, parseConsentCookie, readConsentCookie, serializeConsent } from './consent.ts'

describe('consent cookie', () => {
  it('round-trips both choices', () => {
    expect(parseConsentCookie(serializeConsent(true, 1))).toEqual({ marketing: true, at: 1 })
    expect(parseConsentCookie(serializeConsent(false, 2))).toEqual({ marketing: false, at: 2 })
  })

  it('treats a missing, garbled or OLD-version cookie as "not chosen" — the banner asks again', () => {
    expect(parseConsentCookie(null)).toBeNull()
    expect(parseConsentCookie('%%%')).toBeNull()
    expect(parseConsentCookie(encodeURIComponent(JSON.stringify({ v: '2020-01-01', m: 1, at: 1 })))).toBeNull()
    expect(parseConsentCookie(encodeURIComponent(JSON.stringify({ v: undefined, m: 'yes', at: 1 })))).toBeNull()
  })

  it('reads the cookie out of a full Cookie header', () => {
    expect(readConsentCookie(`a=1; ${CONSENT_COOKIE}=${serializeConsent(true, 5)}; b=2`)).toEqual({ marketing: true, at: 5 })
    expect(readConsentCookie('a=1')).toBeNull()
  })
})
