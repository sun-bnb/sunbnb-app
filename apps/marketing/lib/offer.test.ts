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

describe('the launch offer copy matches what billing enforces', () => {
  it('states the same 30 days and cut-off date as @repo/data/promotion in every language', async () => {
    const { LAUNCH_PROMOTION } = await import('@repo/data/promotion')
    expect(LAUNCH_PROMOTION.days).toBe(30)
    // 1 June 00:00 Madrid = joined by 31 May inclusive
    expect(LAUNCH_PROMOTION.joinCutoff.toISOString()).toBe('2027-05-31T22:00:00.000Z')
    for (const o of Object.values(OFFERS)) {
      expect(o.launchOffer).toMatch(/30/)
      expect(o.launchOffer).toMatch(/2027/)
      expect(o.launchOffer).toMatch(/31/)
    }
  })
})
