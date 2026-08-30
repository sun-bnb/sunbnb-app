import { describe, it, expect } from 'vitest'
import { isVivaPaymentRef, vivaRefFromSession, sessionFromVivaRef } from './refs'

describe('isVivaPaymentRef', () => {
  it('is true for a viva_-prefixed ref with content after the prefix', () => {
    expect(isVivaPaymentRef('viva_4bdebe62-c211-4ca0-a994-b2fbea2061c5')).toBe(true)
  })

  it('is false for the bare prefix with nothing after it', () => {
    expect(isVivaPaymentRef('viva_')).toBe(false)
  })

  it('is false for other providers (mollie tr_, demo pi_demo_) so refs stay discriminated', () => {
    expect(isVivaPaymentRef('tr_abc123')).toBe(false)
    expect(isVivaPaymentRef('pi_demo_1234567890')).toBe(false)
  })

  it('is false for null/undefined/empty', () => {
    expect(isVivaPaymentRef(null)).toBe(false)
    expect(isVivaPaymentRef(undefined)).toBe(false)
    expect(isVivaPaymentRef('')).toBe(false)
  })
})

describe('vivaRefFromSession / sessionFromVivaRef — round trip', () => {
  it('is the load-bearing round trip (mint then recover), same discipline as device-code/site-code', () => {
    const sessionId = '4bdebe62-c211-4ca0-a994-b2fbea2061c5'
    const ref = vivaRefFromSession(sessionId)
    expect(ref).toBe('viva_4bdebe62-c211-4ca0-a994-b2fbea2061c5')
    expect(sessionFromVivaRef(ref)).toBe(sessionId)
  })

  it('vivaRefFromSession throws on an empty sessionId rather than minting a bare-prefix ref', () => {
    expect(() => vivaRefFromSession('')).toThrow(/non-empty sessionId/)
  })

  it('sessionFromVivaRef throws on a non-Viva ref instead of silently stripping', () => {
    expect(() => sessionFromVivaRef('tr_abc123')).toThrow(/Not a Viva payment ref/)
  })
})
