import { describe, expect, it } from 'vitest'
import {
  REF_PREFIX,
  isDemoPayment,
  isLiveProviderRef,
  isMolliePaymentRef,
  isRefundableOnlineRef,
  isStripeCheckoutRef,
  isStripeRef,
  isStripeTerminalRef,
  isVivaCheckoutRef,
  isVivaPaymentRef,
  orderCodeFromVivaCheckoutRef,
  providerFromRef,
  sessionFromVivaRef,
  stripeCheckoutRef,
  stripeIdFromRef,
  stripeTerminalRef,
  vivaCheckoutRefFromOrder,
  vivaRefFromSession,
} from './payment-refs'

const LIVE = ['tr_abc123', 'viva_sess-1', 'vso_123456', 'stripe_cs_test_a1', 'stripe_pi_3Abc']

describe('providerFromRef', () => {
  it.each([
    ['tr_abc123', 'mollie'],
    ['pi_demo_1700000000', 'demo'],
    ['viva_sess-1', 'viva-terminal'],
    ['vso_123456', 'viva'],
    ['stripe_cs_test_a1', 'stripe'],
    ['stripe_pi_3Abc', 'stripe-terminal'],
  ])('%s -> %s', (ref, id) => expect(providerFromRef(ref)).toBe(id))

  it('a bare pi_ ref is not demo', () => expect(providerFromRef('pi_abc')).toBeNull())
  it.each([null, undefined, '', 'offplatform_x', 'cash', 'unknown_1'])('%s -> null', ref =>
    expect(providerFromRef(ref)).toBeNull(),
  )
  it('a prefix alone (no id) is null', () => {
    for (const p of Object.values(REF_PREFIX)) expect(providerFromRef(p)).toBeNull()
  })
})

describe('predicates', () => {
  it('isDemoPayment', () => {
    expect(isDemoPayment('pi_demo_1')).toBe(true)
    expect(isDemoPayment('pi_1')).toBe(false)
    expect(isDemoPayment(null)).toBe(false)
  })
  it('isMolliePaymentRef is strict like the webhook regex', () => {
    expect(isMolliePaymentRef('tr_WDqYK6vllg')).toBe(true)
    expect(isMolliePaymentRef('tr_ab-c')).toBe(false)
    expect(isMolliePaymentRef('tr_' + 'a'.repeat(50))).toBe(true)
    expect(isMolliePaymentRef('tr_' + 'a'.repeat(51))).toBe(false)
    expect(isMolliePaymentRef('tr_')).toBe(false)
    expect(isMolliePaymentRef(null)).toBe(false)
  })
  it('viva / stripe checks', () => {
    expect(isVivaCheckoutRef('vso_1')).toBe(true)
    expect(isVivaCheckoutRef('viva_1')).toBe(false)
    expect(isVivaPaymentRef('viva_1')).toBe(true)
    expect(isStripeCheckoutRef('stripe_cs_1')).toBe(true)
    expect(isStripeCheckoutRef('stripe_pi_1')).toBe(false)
    expect(isStripeTerminalRef('stripe_pi_1')).toBe(true)
    expect(isStripeRef('stripe_cs_1')).toBe(true)
    expect(isStripeRef('stripe_pi_1')).toBe(true)
    expect(isStripeRef('tr_1')).toBe(false)
  })
  it.each(LIVE)('%s is live and refundable online', ref => {
    expect(isLiveProviderRef(ref)).toBe(true)
    expect(isRefundableOnlineRef(ref)).toBe(true)
  })
  it.each(['pi_demo_1', null, undefined, '', 'offplatform_x'])('%s is not live/refundable', ref => {
    expect(isLiveProviderRef(ref)).toBe(false)
    expect(isRefundableOnlineRef(ref)).toBe(false)
  })
})

describe('minters', () => {
  it('round-trips', () => {
    expect(orderCodeFromVivaCheckoutRef(vivaCheckoutRefFromOrder('9876'))).toBe('9876')
    expect(vivaCheckoutRefFromOrder('9876')).toBe('vso_9876')
    expect(stripeIdFromRef(stripeCheckoutRef('cs_test_1'))).toBe('cs_test_1')
    expect(stripeCheckoutRef('cs_1')).toBe('stripe_cs_cs_1')
    expect(stripeIdFromRef(stripeTerminalRef('pi_3A'))).toBe('pi_3A')
    expect(stripeTerminalRef('pi_3A')).toBe('stripe_pi_pi_3A')
    expect(sessionFromVivaRef(vivaRefFromSession('s1'))).toBe('s1')
  })
  it('throws on empty / wrong-provider input', () => {
    expect(() => vivaCheckoutRefFromOrder('')).toThrow()
    expect(() => stripeCheckoutRef('')).toThrow()
    expect(() => stripeTerminalRef('')).toThrow()
    expect(() => orderCodeFromVivaCheckoutRef('viva_1')).toThrow()
    expect(() => stripeIdFromRef('tr_1')).toThrow()
  })
})
