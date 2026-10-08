import { describe, it, expect } from 'vitest'
import { usesLegacyMollieEndpoint, neutralCheckoutBody } from './checkout-endpoint'

describe('usesLegacyMollieEndpoint', () => {
  it.each(['mollie', undefined, null, '', 'paypal', 'Stripe'])('keeps Mollie endpoint for %s', (p) => {
    expect(usesLegacyMollieEndpoint(p as string | null | undefined)).toBe(true)
  })
  it.each(['stripe', 'viva'])('uses neutral endpoint for %s', (p) => {
    expect(usesLegacyMollieEndpoint(p)).toBe(false)
  })
})

describe('neutralCheckoutBody', () => {
  it('builds kind + ids + anonId + redirectUrl', () => {
    expect(
      neutralCheckoutBody('reservation', { reservationId: 'r1' }, { anonId: 'a', redirectUrl: 'https://x/y' }),
    ).toEqual({ kind: 'reservation', reservationId: 'r1', anonId: 'a', redirectUrl: 'https://x/y' })
  })
  it('omits anonId when null/undefined', () => {
    const b = neutralCheckoutBody('tab', { tabId: 't' }, { anonId: null, redirectUrl: 'u' })
    expect(b).toEqual({ kind: 'tab', tabId: 't', redirectUrl: 'u' })
    expect('anonId' in b).toBe(false)
  })
  it('does not let ids override kind', () => {
    expect(neutralCheckoutBody('order', { orderId: 'o' }, { redirectUrl: 'u' }).kind).toBe('order')
  })
})
