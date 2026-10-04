import { describe, it, expect } from 'vitest'
import { marketingCtaUrl } from './marketing-cta'

describe('marketingCtaUrl', () => {
  it('falls back to production marketing origin when base is unset or empty', () => {
    const expected = 'https://try.sunbnb.app/?utm_source=partner-landing&utm_medium=referral&utm_campaign=landing-hero'
    expect(marketingCtaUrl()).toBe(expected)
    expect(marketingCtaUrl('')).toBe(expected)
  })
  it('uses the given base without doubling slashes', () => {
    expect(marketingCtaUrl('https://trytest.sunbnb.app/')).toBe(
      'https://trytest.sunbnb.app/?utm_source=partner-landing&utm_medium=referral&utm_campaign=landing-hero',
    )
  })
})
