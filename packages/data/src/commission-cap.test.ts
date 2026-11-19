import { describe, it, expect } from 'vitest'
import { applyMonthlyCap, capMonthKey, isPlanRateFee, capSourceKey, rentalCapSourceKey, refundReversesCommission } from './commission-cap'

describe('applyMonthlyCap (CR-002: 2% capped at EUR 199 per site per month)', () => {
  it('EUR 100 booking on Temporada takes EUR 2.00 below the cap', () => {
    expect(applyMonthlyCap(2, 0, 199)).toBe(2)
  })
  it('takes exactly the remaining headroom when a booking reaches the cap', () => {
    expect(applyMonthlyCap(2, 197, 199)).toBe(2)
    expect(applyMonthlyCap(5, 197.5, 199)).toBe(1.5)
  })
  it('takes 0 once the cap is reached, never negative', () => {
    expect(applyMonthlyCap(2, 199, 199)).toBe(0)
    expect(applyMonthlyCap(2, 250, 199)).toBe(0)
  })
  it('no cap (null) passes the commission through; zero stays zero', () => {
    expect(applyMonthlyCap(12.345, 10_000, null)).toBe(12.35)
    expect(applyMonthlyCap(0, 0, 199)).toBe(0)
  })
})

describe('capMonthKey (Europe/Madrid calendar month, M-65)', () => {
  it('uses Madrid local time across the UTC month boundary', () => {
    // 2027-06-30 22:30 UTC = 2027-07-01 00:30 CEST
    expect(capMonthKey(new Date('2027-06-30T22:30:00Z'))).toBe('2027-07')
    expect(capMonthKey(new Date('2027-06-30T21:30:00Z'))).toBe('2027-06')
    // winter: 2027-01-31 23:30 UTC = 2027-02-01 00:30 CET
    expect(capMonthKey(new Date('2027-01-31T23:30:00Z'))).toBe('2027-02')
  })
})

describe('isPlanRateFee', () => {
  it('only platform rows are capped; negotiated site/account fees bypass', () => {
    expect(isPlanRateFee({ siteId: null, accountId: null })).toBe(true)
    expect(isPlanRateFee({ siteId: 's1', accountId: null })).toBe(false)
    expect(isPlanRateFee({ siteId: null, accountId: 'u1' })).toBe(false)
    expect(isPlanRateFee(undefined)).toBe(false)
  })
  it('source keys are namespaced per payable kind', () => {
    expect(capSourceKey('reservation', 'r1')).toBe('reservation:r1')
  })
})

describe('refundReversesCommission (T-149)', () => {
  it('Stripe and Viva return the fee; Mollie and demo do not', () => {
    expect(refundReversesCommission('stripe')).toBe(true)
    expect(refundReversesCommission('stripe-terminal')).toBe(true)
    expect(refundReversesCommission('viva')).toBe(true)
    expect(refundReversesCommission('viva-terminal')).toBe(true)
    expect(refundReversesCommission('mollie')).toBe(false)
    expect(refundReversesCommission('demo')).toBe(false)
    expect(refundReversesCommission(null)).toBe(false)
  })
  it('rental groups key on the lowest booking id', () => {
    expect(rentalCapSourceKey(['b2', 'a9', 'c1'])).toBe('rental:a9')
  })
})
