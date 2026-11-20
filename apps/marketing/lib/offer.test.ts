import { describe, expect, it } from 'vitest'
import { OFFERS, offerFor } from './offer.ts'

describe('offer copy guard', () => {
  it('ships no placeholder or TODO text — terms are the founder\'s, or the block stays hidden', () => {
    for (const [locale, offer] of Object.entries(OFFERS)) {
      for (const text of [offer.launchOffer, offer.launchOfferShort, offer.founderPromise]) {
        if (text === null) continue
        expect(text, locale).not.toMatch(/\[FOUNDER|TODO|TBD|XX|lorem/i)
        expect(text.trim().length, locale).toBeGreaterThan(10)
      }
    }
  })

  it('every locale fills the same slots — no market sees an offer another language lacks', () => {
    const shape = (o: (typeof OFFERS)['en']) => [o.launchOffer !== null, o.launchOfferShort !== null, o.founderPromise !== null]
    expect(shape(OFFERS.es)).toEqual(shape(OFFERS.en))
    expect(shape(OFFERS.fi)).toEqual(shape(OFFERS.en))
  })

  it('the short form exists exactly when the full terms do — never a teaser without its conditions', () => {
    for (const o of Object.values(OFFERS)) expect(o.launchOfferShort === null).toBe(o.launchOffer === null)
  })
})

describe('no public launch offer (CR-005: retired; offers are agreed one to one, never published)', () => {
  it('no locale shows a launch offer, and offerFor hides the block', () => {
    for (const locale of ['en', 'es', 'fi'] as const) {
      expect(OFFERS[locale].launchOffer, locale).toBeNull()
      expect(OFFERS[locale].launchOfferShort, locale).toBeNull()
      expect(offerFor(locale), locale).toBeNull()
    }
  })
})
