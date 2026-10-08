import { describe, it, expect } from 'vitest'
import {
  STRIPE_APPLICATION_FEE_POLICY,
  stripeProcessingEstimate,
  stripePassThrough,
  stripeApplicationFee,
} from './fee-policy'

describe('stripe fee policy', () => {
  it('defaults to commission-plus-processing (founder decision 2026-10-07)', () => {
    expect(STRIPE_APPLICATION_FEE_POLICY).toBe('commission-plus-processing')
  })

  it.each([
    [10, 0.4], // 0.15 + 0.25
    [40, 0.85], // 0.60 + 0.25
    [100, 1.75],
    [33.33, 0.75], // 0.49995 + 0.25 = 0.74995 -> 0.75
  ])('processing estimate for %s is %s', (amount, expected) => {
    expect(stripeProcessingEstimate(amount)).toBe(expected)
  })

  it('is 0 for non-positive amounts', () => {
    expect(stripeProcessingEstimate(0)).toBe(0)
    expect(stripeProcessingEstimate(-5)).toBe(0)
  })

  it('pass-through is the estimate under the default policy and 0 under commission-only', () => {
    expect(stripePassThrough(40)).toBe(0.85)
    expect(stripePassThrough(40, 'commission-only')).toBe(0)
  })

  it('application fee = commission + pass-through, rounded', () => {
    expect(stripeApplicationFee(4, 40)).toBe(4.85)
    expect(stripeApplicationFee(4, 40, 'commission-only')).toBe(4)
  })

  it('a zero-commission payment (launch promo / deposit) still carries the pass-through', () => {
    expect(stripeApplicationFee(0, 40)).toBe(0.85)
  })

  it('commission-only with zero commission is a zero fee', () => {
    expect(stripeApplicationFee(0, 40, 'commission-only')).toBe(0)
  })

  it('is capped below the charge (Stripe rejects fee >= amount)', () => {
    expect(stripeApplicationFee(5, 5)).toBe(4.99)
    expect(stripeApplicationFee(0, 0.2)).toBe(0.19)
  })
})
