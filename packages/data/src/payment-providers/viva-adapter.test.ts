import { describe, it, expect, beforeEach } from 'vitest'
import { vivaAdapter, getVivaCheckoutRefStatus } from './viva-adapter'
import { ProviderNotReadyError, type CheckoutIntent } from './types'
import { checkoutStubState } from '../viva'

process.env.VIVA_MODE = 'stub'
const URLS = { redirectUrl: 'https://x/r', webhookUrl: 'https://x/w' }
const ACCT = { partnerAccountId: 'pa', vivaMerchantId: 'm1' }
const intent = (over: Partial<CheckoutIntent> = {}): CheckoutIntent => ({
  amount: 40,
  currency: 'EUR',
  serviceCode: 'sunbed-rental',
  applicationFee: 4,
  description: 'Reservation r1',
  meta: { type: 'reservation', entityId: 'r1' },
  partnerAccountId: 'pa',
  createdAt: new Date(),
  ...over,
})

beforeEach(() => checkoutStubState.reset())

describe('vivaAdapter', () => {
  it('creates an order and returns a vso_ ref + checkout url', async () => {
    const r = await vivaAdapter.createCheckout(intent(), URLS, ACCT)
    expect(r.paymentRef).toMatch(/^vso_\d{16}$/)
    expect(r.checkoutUrl).toContain(`/payment/viva/stub?ref=${r.paymentRef.slice(4)}`)
    const order = checkoutStubState.get(r.paymentRef.slice(4))
    expect(order).toMatchObject({ amountCents: 4000, merchantTrns: 'reservation:r1' })
  })
  it('requires a connected merchant', async () => {
    await expect(vivaAdapter.createCheckout(intent(), URLS, { partnerAccountId: 'pa' })).rejects.toBeInstanceOf(ProviderNotReadyError)
  })
  it('refuses a zero fee on a fee-bearing kind (launch promotion)', async () => {
    await expect(vivaAdapter.createCheckout(intent({ applicationFee: 0 }), URLS, ACCT)).rejects.toBeInstanceOf(ProviderNotReadyError)
  })
  it('allows a deposit (serviceCode null) with ISV amount 0', async () => {
    const r = await vivaAdapter.createCheckout(intent({ serviceCode: null, applicationFee: 0 }), URLS, ACCT)
    expect(r.paymentRef).toMatch(/^vso_/)
  })
  it('rejects a fee >= amount via the ISV fee guard', async () => {
    await expect(vivaAdapter.createCheckout(intent({ applicationFee: 40 }), URLS, ACCT)).rejects.toThrow()
  })
  it('fetchState / status follow the order; cancel is unsupported', async () => {
    const { paymentRef } = await vivaAdapter.createCheckout(intent(), URLS, ACCT)
    expect(await vivaAdapter.fetchState(paymentRef, ACCT)).toBe('pending')
    checkoutStubState.pay(paymentRef.slice(4))
    expect(await getVivaCheckoutRefStatus(paymentRef)).toEqual({ status: 'ok', providerStatus: 'paid', succeeded: true, failed: false })
    expect(await vivaAdapter.cancel!(paymentRef, ACCT)).toBe('error')
  })
  it('refund without a transaction throws; with one refunds the full amount', async () => {
    const { paymentRef } = await vivaAdapter.createCheckout(intent(), URLS, ACCT)
    await expect(vivaAdapter.refund(paymentRef, ACCT)).rejects.toThrow(/no transaction/i)
    checkoutStubState.pay(paymentRef.slice(4))
    await vivaAdapter.refund(paymentRef, ACCT)
    expect(await vivaAdapter.fetchState(paymentRef, ACCT)).toBe('refunded')
  })
})
