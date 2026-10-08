import { describe, it, expect } from 'vitest'
import {
  PROVIDER_AVAILABILITY,
  availabilityFor,
  availableProviders,
} from './availability'

describe('availability', () => {
  it('every entry has online + cardPresent', () => {
    for (const map of Object.values(PROVIDER_AVAILABILITY)) {
      for (const a of Object.values(map)) {
        expect(a.online).toBe(true)
        expect(['none', 'terminal-app', 'tap-to-pay']).toContain(a.cardPresent)
      }
    }
  })

  it('Spain: all online; Mollie no card-present, Viva terminal app, Stripe tap-to-pay', () => {
    expect(availabilityFor('mollie', 'ES')).toMatchObject({ online: true, cardPresent: 'none' })
    expect(availabilityFor('mollie', 'ES').note).toBe('Mollie Tap to Pay is not available in Spain')
    expect(availabilityFor('viva', 'ES')).toMatchObject({ online: true, cardPresent: 'terminal-app' })
    expect(availabilityFor('stripe', 'ES')).toMatchObject({ online: true, cardPresent: 'tap-to-pay' })
    expect(availableProviders('ES')).toEqual(['mollie', 'viva', 'stripe'])
  })

  it('Finland: Stripe online + tap-to-pay; Mollie tap-to-pay too', () => {
    expect(availabilityFor('stripe', 'FI')).toMatchObject({ online: true, cardPresent: 'tap-to-pay' })
    expect(availabilityFor('mollie', 'FI').cardPresent).toBe('tap-to-pay')
  })

  it('country is case-insensitive', () => {
    expect(availabilityFor('viva', 'es')).toEqual(availabilityFor('viva', 'ES'))
    expect(availableProviders('es')).toEqual(availableProviders('ES'))
  })

  it('Mollie-only markets: Viva/Stripe not offered', () => {
    expect(availableProviders('IS')).toEqual(['mollie'])
    expect(availabilityFor('viva', 'NO')).toEqual({ online: false, cardPresent: 'none', note: 'not-available' })
  })

  it('null / empty country → none, flagged country-unknown', () => {
    expect(availableProviders(null)).toEqual([])
    expect(availableProviders(undefined)).toEqual([])
    expect(availabilityFor('mollie', null)).toEqual({ online: false, cardPresent: 'none', note: 'country-unknown' })
  })

  it('unlisted country → none, not-available', () => {
    expect(availableProviders('US')).toEqual([])
    expect(availabilityFor('stripe', 'US').note).toBe('not-available')
  })
})
