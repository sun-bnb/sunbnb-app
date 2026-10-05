import { describe, expect, it } from 'vitest'
import { OFFERS } from './offer.ts'

describe('offer copy guard', () => {
  it('ships no placeholder or TODO text — terms are the founder\'s, or the block stays hidden', () => {
    for (const [locale, offer] of Object.entries(OFFERS)) {
      for (const text of [offer.launchOffer, offer.founderPromise]) {
        if (text === null) continue
        expect(text, locale).not.toMatch(/\[FOUNDER|TODO|TBD|XX|lorem/i)
        expect(text.trim().length, locale).toBeGreaterThan(10)
      }
    }
  })

  it('every locale fills the same slots — no market sees an offer another language lacks', () => {
    const shape = (o: (typeof OFFERS)['en']) => [o.launchOffer !== null, o.founderPromise !== null]
    expect(shape(OFFERS.es)).toEqual(shape(OFFERS.en))
    expect(shape(OFFERS.fi)).toEqual(shape(OFFERS.en))
  })
})
