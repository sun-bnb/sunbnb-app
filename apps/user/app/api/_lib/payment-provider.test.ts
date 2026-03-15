import { describe, it, expect, vi } from 'vitest'

// Mock the mollie module to avoid importing the real Mollie client
vi.mock('./mollie', () => ({
  isMolliePayment: (ref: string | null) => ref?.startsWith('tr_') ?? false,
  getMolliePaymentStatus: vi.fn(),
}))

import { detectProvider, isPaymentSucceeded, isPaymentFailed } from './payment-provider'

describe('detectProvider', () => {
  it('returns demo for pi_demo_ prefix', () => {
    expect(detectProvider('pi_demo_123')).toBe('demo')
  })

  it('returns mollie for tr_ prefix', () => {
    expect(detectProvider('tr_abc123')).toBe('mollie')
  })

  it('returns stripe for pi_ prefix (non-demo)', () => {
    expect(detectProvider('pi_real_123')).toBe('stripe')
  })

  it('returns null for null input', () => {
    expect(detectProvider(null)).toBeNull()
  })

  it('returns null for unrecognized format', () => {
    expect(detectProvider('unknown_ref')).toBeNull()
  })
})

describe('isPaymentSucceeded', () => {
  it('returns true for Stripe succeeded', () => {
    expect(isPaymentSucceeded('succeeded')).toBe(true)
  })

  it('returns true for Mollie paid', () => {
    expect(isPaymentSucceeded('paid')).toBe(true)
  })

  it('returns false for failed', () => {
    expect(isPaymentSucceeded('failed')).toBe(false)
  })

  it('returns false for pending', () => {
    expect(isPaymentSucceeded('pending')).toBe(false)
  })

  it('returns false for canceled', () => {
    expect(isPaymentSucceeded('canceled')).toBe(false)
  })
})

describe('isPaymentFailed', () => {
  it('returns true for canceled', () => {
    expect(isPaymentFailed('canceled')).toBe(true)
  })

  it('returns true for expired', () => {
    expect(isPaymentFailed('expired')).toBe(true)
  })

  it('returns true for failed', () => {
    expect(isPaymentFailed('failed')).toBe(true)
  })

  it('returns false for succeeded', () => {
    expect(isPaymentFailed('succeeded')).toBe(false)
  })

  it('returns false for paid', () => {
    expect(isPaymentFailed('paid')).toBe(false)
  })

  it('returns false for pending', () => {
    expect(isPaymentFailed('pending')).toBe(false)
  })
})
