import { describe, it, expect, vi, beforeEach } from 'vitest'

const stripe = vi.hoisted(() => ({
  checkout: { sessions: { create: vi.fn(), retrieve: vi.fn(), expire: vi.fn() } },
  paymentIntents: { retrieve: vi.fn() },
  refunds: { create: vi.fn() },
}))
vi.mock('./client', () => ({ getStripeConnectClient: () => stripe, getStripeClient: () => { throw new Error('Connect code must not use the subscription client') } }))

import {
  flattenMeta,
  unflattenMeta,
  createCheckoutSession,
  fetchCheckoutState,
  fetchPaymentIntentState,
  refundPaymentIntent,
  expireCheckoutSession,
} from './checkout'
import type { CheckoutIntent, PaymentMeta } from '../payment-providers/types'

const intent = (over: Partial<CheckoutIntent> = {}): CheckoutIntent => ({
  amount: 40.1,
  currency: 'EUR',
  serviceCode: 'sunbed-rental',
  applicationFee: 4,
  description: 'Reservation r1',
  meta: { type: 'reservation', entityId: 'r1', siteId: 's1' },
  partnerAccountId: 'pa-1',
  createdAt: new Date(),
  ...over,
})

beforeEach(() => vi.clearAllMocks())

describe('meta round-trip', () => {
  it('flattens bookingIds comma-joined and collect as 1, omitting undefined', () => {
    expect(flattenMeta({ type: 'rental-booking', entityId: 'b1', bookingIds: ['b1', 'b2'], collect: true })).toEqual({
      type: 'rental-booking', entityId: 'b1', bookingIds: 'b1,b2', collect: '1',
    })
    expect(flattenMeta({ type: 'order', entityId: 'o1' })).toEqual({ type: 'order', entityId: 'o1' })
  })
  it.each<PaymentMeta>([
    { type: 'reservation', entityId: 'r1', siteId: 's1' },
    { type: 'rental-booking', entityId: 'b1', bookingIds: ['b1', 'b2'], siteId: 's1', collect: true },
    { type: 'tab', entityId: 't1', restaurantId: 'rest1' },
  ])('round-trips %o', (meta) => {
    expect(unflattenMeta(flattenMeta(meta))).toEqual(meta)
  })
  it('returns null for missing or incomplete metadata', () => {
    expect(unflattenMeta(null)).toBeNull()
    expect(unflattenMeta({})).toBeNull()
    expect(unflattenMeta({ type: 'order' })).toBeNull()
  })
})

describe('createCheckoutSession', () => {
  beforeEach(() => stripe.checkout.sessions.create.mockResolvedValue({ id: 'cs_1', url: 'https://c/1' }))

  it('builds a direct-charge session on the connected account with exact cents', async () => {
    const r = await createCheckoutSession(intent(), { redirectUrl: 'https://app/r?x=1' }, 'acct_1', 4.85)
    expect(r).toEqual({ checkoutUrl: 'https://c/1', sessionId: 'cs_1' })
    const [body, opts] = stripe.checkout.sessions.create.mock.calls[0]!
    expect(opts).toEqual({ stripeAccount: 'acct_1' })
    expect(body.mode).toBe('payment')
    expect(body.line_items).toEqual([{ quantity: 1, price_data: { currency: 'eur', unit_amount: 4010, product_data: { name: 'Reservation r1' } } }])
    expect(body.payment_intent_data.application_fee_amount).toBe(485)
    expect(body.payment_intent_data.metadata).toEqual({ type: 'reservation', entityId: 'r1', siteId: 's1' })
    expect(body.metadata).toEqual(body.payment_intent_data.metadata)
    expect(body.cancel_url).toBe('https://app/r?x=1')
  })

  it('keeps the {CHECKOUT_SESSION_ID} template literal (unencoded) in success_url', async () => {
    await createCheckoutSession(intent(), { redirectUrl: 'https://app/r' }, 'acct_1', 1)
    expect(stripe.checkout.sessions.create.mock.calls[0]![0].success_url).toBe('https://app/r?stripeSession={CHECKOUT_SESSION_ID}')
    await createCheckoutSession(intent(), { redirectUrl: 'https://app/r?a=b' }, 'acct_1', 1)
    expect(stripe.checkout.sessions.create.mock.calls[1]![0].success_url).toBe('https://app/r?a=b&stripeSession={CHECKOUT_SESSION_ID}')
  })

  it('omits application_fee_amount at a zero fee', async () => {
    await createCheckoutSession(intent(), { redirectUrl: 'https://app/r' }, 'acct_1', 0)
    expect(stripe.checkout.sessions.create.mock.calls[0]![0].payment_intent_data).not.toHaveProperty('application_fee_amount')
  })

  it('expires the session in ~30 minutes', async () => {
    const now = Math.floor(Date.now() / 1000)
    await createCheckoutSession(intent(), { redirectUrl: 'https://app/r' }, 'acct_1', 1)
    const exp = stripe.checkout.sessions.create.mock.calls[0]![0].expires_at
    expect(exp - now).toBeGreaterThanOrEqual(1799)
    expect(exp - now).toBeLessThanOrEqual(1801)
  })

  it('throws when Stripe returns no url', async () => {
    stripe.checkout.sessions.create.mockResolvedValue({ id: 'cs_1', url: null })
    await expect(createCheckoutSession(intent(), { redirectUrl: 'https://app/r' }, 'acct_1', 1)).rejects.toThrow()
  })
})

describe('fetchCheckoutState', () => {
  const session = (over: Record<string, unknown>) => ({ metadata: { type: 'reservation', entityId: 'r1' }, ...over })

  it('expands the latest charge and uses the account option', async () => {
    stripe.checkout.sessions.retrieve.mockResolvedValue(session({ status: 'open', payment_status: 'unpaid', payment_intent: null }))
    await fetchCheckoutState('cs_1', 'acct_1')
    expect(stripe.checkout.sessions.retrieve).toHaveBeenCalledWith('cs_1', { expand: ['payment_intent.latest_charge'] }, { stripeAccount: 'acct_1' })
  })
  it('complete + paid -> paid, with ids and meta', async () => {
    stripe.checkout.sessions.retrieve.mockResolvedValue(
      session({ status: 'complete', payment_status: 'paid', payment_intent: { id: 'pi_1', status: 'succeeded', latest_charge: { id: 'ch_1', refunded: false } } }),
    )
    expect(await fetchCheckoutState('cs_1', 'acct_1')).toEqual({
      state: 'paid', paymentIntentId: 'pi_1', chargeId: 'ch_1', meta: { type: 'reservation', entityId: 'r1' },
    })
  })
  it('paid but charge refunded -> refunded', async () => {
    stripe.checkout.sessions.retrieve.mockResolvedValue(
      session({ status: 'complete', payment_status: 'paid', payment_intent: { id: 'pi_1', latest_charge: { id: 'ch_1', refunded: true } } }),
    )
    expect((await fetchCheckoutState('cs_1', 'acct_1')).state).toBe('refunded')
  })
  it('expired -> failed', async () => {
    stripe.checkout.sessions.retrieve.mockResolvedValue(session({ status: 'expired', payment_status: 'unpaid', payment_intent: null }))
    expect((await fetchCheckoutState('cs_1', 'acct_1')).state).toBe('failed')
  })
  it('open session whose PI was canceled -> failed', async () => {
    stripe.checkout.sessions.retrieve.mockResolvedValue(session({ status: 'open', payment_status: 'unpaid', payment_intent: { id: 'pi_1', status: 'canceled', latest_charge: null } }))
    expect((await fetchCheckoutState('cs_1', 'acct_1')).state).toBe('failed')
  })
  it('open and unpaid -> pending (a declined attempt must not fail an open session)', async () => {
    stripe.checkout.sessions.retrieve.mockResolvedValue(session({ status: 'open', payment_status: 'unpaid', payment_intent: { id: 'pi_1', status: 'requires_payment_method', latest_charge: null } }))
    expect((await fetchCheckoutState('cs_1', 'acct_1')).state).toBe('pending')
  })
  it('complete but unpaid (async method) -> pending', async () => {
    stripe.checkout.sessions.retrieve.mockResolvedValue(session({ status: 'complete', payment_status: 'unpaid', payment_intent: 'pi_1' }))
    const r = await fetchCheckoutState('cs_1', 'acct_1')
    expect(r.state).toBe('pending')
    expect(r.paymentIntentId).toBe('pi_1')
  })
})

describe('fetchPaymentIntentState', () => {
  const pi = (over: Record<string, unknown>) => ({ metadata: { type: 'order', entityId: 'o1' }, latest_charge: null, ...over })
  it('succeeded -> paid; refunded charge -> refunded', async () => {
    stripe.paymentIntents.retrieve.mockResolvedValueOnce(pi({ status: 'succeeded', latest_charge: { id: 'ch_1', refunded: false } }))
    expect(await fetchPaymentIntentState('pi_1', 'acct_1')).toEqual({ state: 'paid', chargeId: 'ch_1', meta: { type: 'order', entityId: 'o1' } })
    stripe.paymentIntents.retrieve.mockResolvedValueOnce(pi({ status: 'succeeded', latest_charge: { id: 'ch_1', refunded: true } }))
    expect((await fetchPaymentIntentState('pi_1', 'acct_1')).state).toBe('refunded')
    expect(stripe.paymentIntents.retrieve).toHaveBeenCalledWith('pi_1', { expand: ['latest_charge'] }, { stripeAccount: 'acct_1' })
  })
  it('canceled -> failed', async () => {
    stripe.paymentIntents.retrieve.mockResolvedValue(pi({ status: 'canceled' }))
    expect((await fetchPaymentIntentState('pi_1', 'acct_1')).state).toBe('failed')
  })
  it('requires_payment_method: fresh -> pending, after a failed attempt -> failed', async () => {
    stripe.paymentIntents.retrieve.mockResolvedValueOnce(pi({ status: 'requires_payment_method', last_payment_error: null }))
    expect((await fetchPaymentIntentState('pi_1', 'acct_1')).state).toBe('pending')
    stripe.paymentIntents.retrieve.mockResolvedValueOnce(pi({ status: 'requires_payment_method', last_payment_error: { code: 'card_declined' } }))
    expect((await fetchPaymentIntentState('pi_1', 'acct_1')).state).toBe('failed')
  })
  it('processing -> pending', async () => {
    stripe.paymentIntents.retrieve.mockResolvedValue(pi({ status: 'processing' }))
    expect((await fetchPaymentIntentState('pi_1', 'acct_1')).state).toBe('pending')
  })
})

describe('refundPaymentIntent', () => {
  it('refunds the application fee too, on the connected account; full refund has no amount', async () => {
    await refundPaymentIntent('pi_1', 'acct_1')
    expect(stripe.refunds.create).toHaveBeenCalledWith({ payment_intent: 'pi_1', refund_application_fee: true }, { stripeAccount: 'acct_1' })
  })
  it('partial refund passes cents', async () => {
    await refundPaymentIntent('pi_1', 'acct_1', 1250)
    expect(stripe.refunds.create).toHaveBeenCalledWith({ payment_intent: 'pi_1', amount: 1250, refund_application_fee: true }, { stripeAccount: 'acct_1' })
  })
})

describe('expireCheckoutSession', () => {
  it('already paid -> paid, never expires', async () => {
    stripe.checkout.sessions.retrieve.mockResolvedValue({ status: 'complete', payment_status: 'paid' })
    expect(await expireCheckoutSession('cs_1', 'acct_1')).toBe('paid')
    expect(stripe.checkout.sessions.expire).not.toHaveBeenCalled()
  })
  it('open -> expires on the connected account -> canceled', async () => {
    stripe.checkout.sessions.retrieve.mockResolvedValue({ status: 'open', payment_status: 'unpaid' })
    expect(await expireCheckoutSession('cs_1', 'acct_1')).toBe('canceled')
    expect(stripe.checkout.sessions.expire).toHaveBeenCalledWith('cs_1', undefined, { stripeAccount: 'acct_1' })
  })
  it('already expired -> canceled without a second expire call', async () => {
    stripe.checkout.sessions.retrieve.mockResolvedValue({ status: 'expired', payment_status: 'unpaid' })
    expect(await expireCheckoutSession('cs_1', 'acct_1')).toBe('canceled')
    expect(stripe.checkout.sessions.expire).not.toHaveBeenCalled()
  })
  it('API error -> error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    stripe.checkout.sessions.retrieve.mockRejectedValue(new Error('network'))
    expect(await expireCheckoutSession('cs_1', 'acct_1')).toBe('error')
  })
})
