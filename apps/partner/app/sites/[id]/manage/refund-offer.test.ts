import { describe, it, expect } from 'vitest'
import { isRefundableOnlineRef } from '@repo/data/payment-refs'

// BedDetail offers the refund control iff isRefundableOnlineRef(reservation.paymentRef).
describe('BedDetail refund offer rule', () => {
  it.each(['tr_abc123', 'stripe_cs_x', 'stripe_pi_x', 'vso_x', 'viva_x'])('offers refund for %s', (ref) => {
    expect(isRefundableOnlineRef(ref)).toBe(true)
  })
  it.each(['pi_demo_x', 'pi_bare', '', null, undefined, 'cash'])('does not offer refund for %s', (ref) => {
    expect(isRefundableOnlineRef(ref)).toBe(false)
  })
})
