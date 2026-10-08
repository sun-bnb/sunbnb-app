import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = vi.hoisted(() => ({
  createCheckoutSession: vi.fn(),
  fetchCheckoutState: vi.fn(),
  fetchPaymentIntentState: vi.fn(),
  refundPaymentIntent: vi.fn(),
  expireCheckoutSession: vi.fn(),
}))
vi.mock('../stripe/checkout', () => m)

import { stripeAdapter } from './stripe-adapter'
import { ProviderNotReadyError, type CheckoutIntent } from './types'

const ACCT = { partnerAccountId: 'pa-1', stripeConnectAccountId: 'acct_1' }
const URLS = { redirectUrl: 'https://x/r', webhookUrl: 'https://x/w' }
const intent = (over: Partial<CheckoutIntent> = {}): CheckoutIntent => ({
  amount: 40,
  currency: 'EUR',
  serviceCode: 'sunbed-rental',
  applicationFee: 4,
  description: 'Reservation r1',
  meta: { type: 'reservation', entityId: 'r1' },
  partnerAccountId: 'pa-1',
  createdAt: new Date(),
  ...over,
})

beforeEach(() => vi.clearAllMocks())

describe('stripeAdapter', () => {
  it('createCheckout mints a stripe_cs_ ref and charges on the connected account with commission + pass-through', async () => {
    m.createCheckoutSession.mockResolvedValue({ checkoutUrl: 'https://c/1', sessionId: 'cs_test_1' })
    const r = await stripeAdapter.createCheckout(intent(), URLS, ACCT)
    expect(r).toEqual({ checkoutUrl: 'https://c/1', paymentRef: 'stripe_cs_cs_test_1' })
    expect(m.createCheckoutSession).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ redirectUrl: 'https://x/r' }), 'acct_1', 4.85)
  })

  it('a table deposit (no commission) still pays the processing pass-through', async () => {
    m.createCheckoutSession.mockResolvedValue({ checkoutUrl: 'u', sessionId: 's' })
    await stripeAdapter.createCheckout(intent({ serviceCode: null, applicationFee: 0, amount: 20 }), URLS, ACCT)
    expect(m.createCheckoutSession.mock.calls[0]![3]).toBe(0.55) // 0.30 + 0.25
  })

  it('throws ProviderNotReadyError without a connected account and never calls Stripe', async () => {
    await expect(
      stripeAdapter.createCheckout(intent(), URLS, { partnerAccountId: 'pa-1', stripeConnectAccountId: null }),
    ).rejects.toBeInstanceOf(ProviderNotReadyError)
    expect(m.createCheckoutSession).not.toHaveBeenCalled()
  })

  it('fetchState dispatches on the ref type', async () => {
    m.fetchCheckoutState.mockResolvedValue({ state: 'paid' })
    m.fetchPaymentIntentState.mockResolvedValue({ state: 'failed' })
    expect(await stripeAdapter.fetchState('stripe_cs_cs_1', ACCT)).toBe('paid')
    expect(m.fetchCheckoutState).toHaveBeenCalledWith('cs_1', 'acct_1')
    expect(await stripeAdapter.fetchState('stripe_pi_pi_1', ACCT)).toBe('failed')
    expect(m.fetchPaymentIntentState).toHaveBeenCalledWith('pi_1', 'acct_1')
  })

  it('refund of a checkout ref resolves the payment intent first; full refund passes no amount', async () => {
    m.fetchCheckoutState.mockResolvedValue({ paymentIntentId: 'pi_9' })
    await stripeAdapter.refund('stripe_cs_cs_1', ACCT)
    expect(m.refundPaymentIntent).toHaveBeenCalledWith('pi_9', 'acct_1', undefined)
  })

  it('partial refund converts EUR to cents; a terminal ref refunds its PI directly', async () => {
    await stripeAdapter.refund('stripe_pi_pi_2', ACCT, 12.5)
    expect(m.fetchCheckoutState).not.toHaveBeenCalled()
    expect(m.refundPaymentIntent).toHaveBeenCalledWith('pi_2', 'acct_1', 1250)
  })

  it('refund of a session with no payment intent throws', async () => {
    m.fetchCheckoutState.mockResolvedValue({ paymentIntentId: null })
    await expect(stripeAdapter.refund('stripe_cs_cs_1', ACCT)).rejects.toThrow()
    expect(m.refundPaymentIntent).not.toHaveBeenCalled()
  })

  it('cancel expires the session', async () => {
    m.expireCheckoutSession.mockResolvedValue('canceled')
    expect(await stripeAdapter.cancel!('stripe_cs_cs_1', ACCT)).toBe('canceled')
    expect(m.expireCheckoutSession).toHaveBeenCalledWith('cs_1', 'acct_1')
  })
})
