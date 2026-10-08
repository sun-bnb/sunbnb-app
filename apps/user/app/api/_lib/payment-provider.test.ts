import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the mollie module to avoid importing the real Mollie client
vi.mock('./mollie', () => ({
  isMolliePayment: (ref: string | null) => ref?.startsWith('tr_') ?? false,
  getMolliePaymentStatus: vi.fn(),
}))

const { mockFindEntity, mockFetchCheckout, mockFetchPI, mockRefundPI, mockAcctSite, mockAcctPartner } = vi.hoisted(() => ({
  mockFindEntity: vi.fn(),
  mockFetchCheckout: vi.fn(),
  mockFetchPI: vi.fn(),
  mockRefundPI: vi.fn(),
  mockAcctSite: vi.fn(),
  mockAcctPartner: vi.fn(),
}))
vi.mock('./payment-events', () => ({ findPaymentEntity: mockFindEntity }))
vi.mock('@repo/data/stripe', () => ({
  fetchCheckoutState: mockFetchCheckout,
  fetchPaymentIntentState: mockFetchPI,
  refundPaymentIntent: mockRefundPI,
}))
vi.mock('@repo/data/payment-providers/stripe-account', () => ({
  stripeAccountForSite: mockAcctSite,
  stripeAccountForPartner: mockAcctPartner,
}))

const { mockVivaFetch, mockVivaRefund } = vi.hoisted(() => ({ mockVivaFetch: vi.fn(), mockVivaRefund: vi.fn() }))
vi.mock('@repo/data/payment-providers', () => ({
  getOnlineAdapter: () => ({ fetchState: mockVivaFetch, refund: mockVivaRefund }),
}))

vi.mock('@repo/data/reservation-payment', () => ({
  refundReservationVivaPayment: vi.fn(),
}))

import prisma from '@repo/data/PrismaCient'
import { refundReservationVivaPayment } from '@repo/data/reservation-payment'
import {
  detectProvider,
  getPaymentStatus,
  issueRefund,
  isPaymentSucceeded,
  isPaymentFailed,
} from './payment-provider'

describe('detectProvider', () => {
  it('returns demo for pi_demo_ prefix', () => {
    expect(detectProvider('pi_demo_123')).toBe('demo')
  })

  it('returns mollie for tr_ prefix', () => {
    expect(detectProvider('tr_abc123')).toBe('mollie')
  })

  it('returns null for a non-demo pi_ ref (consumer Stripe removed)', () => {
    expect(detectProvider('pi_real_123')).toBeNull()
  })

  it('returns null for null input', () => {
    expect(detectProvider(null)).toBeNull()
  })

  it('returns null for unrecognized format', () => {
    expect(detectProvider('unknown_ref')).toBeNull()
  })
})

describe('isPaymentSucceeded', () => {
  it('returns true for demo succeeded', () => {
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

describe('detectProvider — new ids', () => {
  it.each([
    ['viva_sess1', 'viva-terminal'],
    ['vso_123', 'viva'],
    ['stripe_cs_abc', 'stripe'],
    ['stripe_pi_abc', 'stripe-terminal'],
  ])('%s -> %s', (ref, id) => {
    expect(detectProvider(ref)).toBe(id)
  })
})

describe('getPaymentStatus — unwired providers', () => {
  it('viva-terminal is never polled by the consumer side', async () => {
    await expect(getPaymentStatus('viva_s1')).rejects.toThrow('viva-terminal is not polled here')
  })

  it('vso_ (viva online) maps adapter state; refunded counts as paid', async () => {
    mockVivaFetch.mockResolvedValueOnce('pending')
    expect(await getPaymentStatus('vso_1')).toBe('pending')
    mockVivaFetch.mockResolvedValueOnce('refunded')
    expect(await getPaymentStatus('vso_1')).toBe('paid')
    mockVivaFetch.mockResolvedValueOnce('failed')
    expect(await getPaymentStatus('vso_1')).toBe('failed')
    expect(mockVivaFetch.mock.calls[0][0]).toBe('vso_1')
  })

  it('demo still succeeds; unknown still throws', async () => {
    expect(await getPaymentStatus('pi_demo_1')).toBe('succeeded')
    await expect(getPaymentStatus('weird')).rejects.toThrow('Unknown payment provider')
  })
})

describe('issueRefund — dispatch', () => {
  beforeEach(() => vi.mocked(refundReservationVivaPayment).mockReset())

  it('viva-terminal refunds through refundReservationVivaPayment(reservationId)', async () => {
    vi.mocked(refundReservationVivaPayment).mockResolvedValue({ status: 'ok' })
    await issueRefund('viva_s1', { reservationId: 'res-1' })
    expect(refundReservationVivaPayment).toHaveBeenCalledWith('res-1')
  })

  it('viva-terminal without a reservationId throws and never refunds', async () => {
    await expect(issueRefund('viva_s1')).rejects.toThrow('reservationId')
    expect(refundReservationVivaPayment).not.toHaveBeenCalled()
  })

  it('viva-terminal error outcome aborts (so the cancel does not proceed)', async () => {
    vi.mocked(refundReservationVivaPayment).mockResolvedValue({ status: 'error', error: 'declined' })
    await expect(issueRefund('viva_s1', { reservationId: 'res-1' })).rejects.toThrow('declined')
  })

  it('demo is a no-op; unknown refs throw', async () => {
    await expect(issueRefund('pi_demo_1')).resolves.toBeUndefined()
    await expect(issueRefund('weird')).rejects.toThrow('Unknown payment provider')
  })

  it('vso_ refunds through the adapter with the partner vivaMerchantId', async () => {
    mockFindEntity.mockResolvedValue({ type: 'reservation', entityId: 'r1', siteId: 's1' })
    vi.mocked(prisma.site.findUnique).mockResolvedValue({ userId: 'pa-1' } as never)
    vi.mocked(prisma.partnerAccount.findUnique).mockResolvedValue({ vivaMerchantId: 'm-1' } as never)
    await issueRefund('vso_1')
    expect(mockVivaRefund).toHaveBeenCalledWith('vso_1', { partnerAccountId: 'pa-1', vivaMerchantId: 'm-1' })
  })

  it('vso_ refund without a connected merchant throws and never refunds', async () => {
    mockVivaRefund.mockClear()
    mockFindEntity.mockResolvedValue({ type: 'reservation', entityId: 'r1', siteId: 's1' })
    vi.mocked(prisma.site.findUnique).mockResolvedValue({ userId: 'pa-1' } as never)
    vi.mocked(prisma.partnerAccount.findUnique).mockResolvedValue({ vivaMerchantId: null } as never)
    await expect(issueRefund('vso_1')).rejects.toThrow('No connected Viva merchant')
    expect(mockVivaRefund).not.toHaveBeenCalled()
  })
})

describe('Stripe branches', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFindEntity.mockResolvedValue({ type: 'reservation', entityId: 'r1', siteId: 'site-1' })
    mockAcctSite.mockResolvedValue('acct_1')
  })

  it.each([
    ['paid', 'paid'],
    ['failed', 'failed'],
    ['pending', 'pending'],
    ['refunded', 'paid'],
  ])('checkout state %s maps to %s', async (state, expected) => {
    mockFetchCheckout.mockResolvedValue({ state, paymentIntentId: 'pi_1' })
    expect(await getPaymentStatus('stripe_cs_cs_1')).toBe(expected)
    expect(mockFetchCheckout).toHaveBeenCalledWith('cs_1', 'acct_1')
  })

  it('terminal ref polls the payment intent on the connected account', async () => {
    mockFetchPI.mockResolvedValue({ state: 'paid' })
    expect(await getPaymentStatus('stripe_pi_pi_9')).toBe('paid')
    expect(mockFetchPI).toHaveBeenCalledWith('pi_9', 'acct_1')
  })

  it('maps through isPaymentSucceeded / isPaymentFailed', () => {
    expect(isPaymentSucceeded('paid')).toBe(true)
    expect(isPaymentFailed('failed')).toBe(true)
    expect(isPaymentSucceeded('pending') || isPaymentFailed('pending')).toBe(false)
  })

  it('throws when the connected account is missing', async () => {
    mockAcctSite.mockResolvedValue(null)
    await expect(getPaymentStatus('stripe_cs_cs_1')).rejects.toThrow('No connected Stripe account')
    expect(mockFetchCheckout).not.toHaveBeenCalled()
  })

  it('throws when no entity owns the ref', async () => {
    mockFindEntity.mockResolvedValue(null)
    await expect(getPaymentStatus('stripe_cs_cs_1')).rejects.toThrow('No payment entity')
  })

  it('standalone restaurant resolves through the restaurant partner', async () => {
    mockFindEntity.mockResolvedValue({ type: 'tab', entityId: 't1', restaurantId: 'rest-1' })
    vi.mocked(prisma.restaurant.findUnique).mockResolvedValue({ siteId: null, partnerAccountId: 'pa-1' } as never)
    mockAcctPartner.mockResolvedValue('acct_p')
    mockFetchCheckout.mockResolvedValue({ state: 'paid', paymentIntentId: 'pi_1' })
    await getPaymentStatus('stripe_cs_cs_1')
    expect(mockAcctPartner).toHaveBeenCalledWith('pa-1')
    expect(mockFetchCheckout).toHaveBeenCalledWith('cs_1', 'acct_p')
  })

  it('refund of a checkout ref resolves the PI and passes the connected account', async () => {
    mockFetchCheckout.mockResolvedValue({ state: 'paid', paymentIntentId: 'pi_77' })
    await issueRefund('stripe_cs_cs_1')
    expect(mockRefundPI).toHaveBeenCalledWith('pi_77', 'acct_1')
  })

  it('refund of a terminal ref uses the PI id directly', async () => {
    await issueRefund('stripe_pi_pi_5')
    expect(mockFetchCheckout).not.toHaveBeenCalled()
    expect(mockRefundPI).toHaveBeenCalledWith('pi_5', 'acct_1')
  })

  it('refund without a connected account never calls Stripe', async () => {
    mockAcctSite.mockResolvedValue(null)
    await expect(issueRefund('stripe_cs_cs_1')).rejects.toThrow()
    expect(mockRefundPI).not.toHaveBeenCalled()
  })
})
