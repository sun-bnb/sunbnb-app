/**
 * Sanctioned checkout writers (track 028): reservation + rental `mark*` helpers,
 * and the by-ref status dispatch for ids that are not wired yet.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { resUpdate, resFind, rentalUpdateMany, rentalFind, getStripeRefStatus, stripeAccountForPartner, stripeCancel } = vi.hoisted(() => ({
  getStripeRefStatus: vi.fn(),
  stripeAccountForPartner: vi.fn(),
  stripeCancel: vi.fn(),
  resUpdate: vi.fn(),
  resFind: vi.fn(),
  rentalUpdateMany: vi.fn(),
  rentalFind: vi.fn(),
}))

vi.mock('../index', () => ({
  default: {
    reservation: { update: resUpdate, findUnique: resFind },
    rentalBooking: { updateMany: rentalUpdateMany, findUnique: rentalFind },
    partnerAccount: { findUnique: vi.fn() },
  },
}))
vi.mock('./mollie-tokens', () => ({ getValidMollieToken: vi.fn() }))
vi.mock('./env', () => ({ isTestMode: vi.fn().mockReturnValue(false) }))
vi.mock('./payment', () => ({
  loadFeeContext: vi.fn(),
  resolveServiceFee: vi.fn(),
  chargeableServiceFee: vi.fn(),
  calculateServiceFeeAmount: vi.fn(),
  round: vi.fn(),
  processConfirmedReservation: vi.fn(),
  processConfirmedRentalBooking: vi.fn(),
}))
vi.mock('./reservation-emails', () => ({}))
vi.mock('./payment-providers/stripe-account', () => ({ getStripeRefStatus, stripeAccountForPartner }))
vi.mock('./payment-providers/stripe-adapter', () => ({ stripeAdapter: { cancel: stripeCancel } }))

import {
  markReservationCheckoutStarted,
  markReservationCheckoutFailed,
  getReservationPaymentStatus,
  cancelReservationMolliePayment,
} from './reservation-payment'
import {
  markRentalCheckoutStarted,
  markRentalCheckoutFailed,
  getRentalBookingPaymentStatus,
} from './rental-payment'

beforeEach(() => vi.clearAllMocks())

describe('markReservationCheckout*', () => {
  it('started: writes the ref and moves to processing', async () => {
    await markReservationCheckoutStarted('r1', 'vso_123')
    expect(resUpdate).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: { paymentRef: 'vso_123', status: 'processing' },
    })
  })
  it('failed: moves to payment_failed and writes no ref', async () => {
    await markReservationCheckoutFailed('r1')
    expect(resUpdate).toHaveBeenCalledWith({ where: { id: 'r1' }, data: { status: 'payment_failed' } })
  })
})

describe('markRentalCheckout*', () => {
  it('started: the SAME ref on every booking in the group', async () => {
    await markRentalCheckoutStarted(['b1', 'b2'], 'stripe_cs_1')
    expect(rentalUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ['b1', 'b2'] } },
      data: { paymentRef: 'stripe_cs_1', status: 'processing' },
    })
  })
  it('failed: marks the whole group payment_failed', async () => {
    await markRentalCheckoutFailed(['b1', 'b2'])
    expect(rentalUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ['b1', 'b2'] } },
      data: { status: 'payment_failed' },
    })
  })
})

describe('by-ref dispatch for providers not wired yet', () => {
  it('reservation status for a vso_ ref goes through the Viva checkout adapter (stub: unknown order = pending)', async () => {
    resFind.mockResolvedValue({ paymentRef: 'vso_1', site: { userId: 'u' } })
    expect(await getReservationPaymentStatus('r1')).toEqual({ status: 'ok', providerStatus: 'pending', succeeded: false, failed: false })
  })
  it('reservation cancel for a vso_ ref never reaches Mollie', async () => {
    resFind.mockResolvedValue({ paymentRef: 'vso_1', site: { userId: 'u' } })
    global.fetch = vi.fn() as unknown as typeof fetch
    expect(await cancelReservationMolliePayment('r1')).toEqual({ status: 'error', error: 'Viva online checkout cannot be cancelled; poll for the outcome' })
    expect(global.fetch).not.toHaveBeenCalled()
  })
  it('rental status for viva_ (terminal) is an explicit error', async () => {
    rentalFind.mockResolvedValue({ paymentRef: 'viva_1', site: { userId: 'u' } })
    expect(await getRentalBookingPaymentStatus('b1')).toEqual({ status: 'error', error: 'provider not wired yet (track 028)' })
  })
  it('rental status for vso_ goes through the Viva checkout adapter', async () => {
    rentalFind.mockResolvedValue({ paymentRef: 'vso_1', site: { userId: 'u' } })
    expect(await getRentalBookingPaymentStatus('b1')).toMatchObject({ status: 'ok', providerStatus: 'pending' })
  })
})

describe('by-ref dispatch for Stripe', () => {
  const ok = { status: 'ok', providerStatus: 'paid', succeeded: true, failed: false }

  it.each(['stripe_cs_1', 'stripe_pi_1'])('reservation status for %s resolves via the site owner, never Mollie', async (ref) => {
    resFind.mockResolvedValue({ paymentRef: ref, site: { userId: 'owner-1' } })
    getStripeRefStatus.mockResolvedValue(ok)
    global.fetch = vi.fn() as unknown as typeof fetch
    expect(await getReservationPaymentStatus('r1')).toEqual(ok)
    expect(getStripeRefStatus).toHaveBeenCalledWith(ref, 'owner-1')
    expect(global.fetch).not.toHaveBeenCalled()
  })
  it('rental status resolves via the site owner', async () => {
    rentalFind.mockResolvedValue({ paymentRef: 'stripe_cs_1', site: { userId: 'owner-1' } })
    getStripeRefStatus.mockResolvedValue(ok)
    expect(await getRentalBookingPaymentStatus('b1')).toEqual(ok)
    expect(getStripeRefStatus).toHaveBeenCalledWith('stripe_cs_1', 'owner-1')
  })
  it.each([['canceled'], ['paid']])('reservation cancel of a stripe_cs_ ref passes %s through', async (outcome) => {
    resFind.mockResolvedValue({ paymentRef: 'stripe_cs_1', site: { userId: 'owner-1' } })
    stripeAccountForPartner.mockResolvedValue('acct_1')
    stripeCancel.mockResolvedValue(outcome)
    expect(await cancelReservationMolliePayment('r1')).toEqual({ status: outcome })
    expect(stripeCancel).toHaveBeenCalledWith('stripe_cs_1', { partnerAccountId: 'owner-1', stripeConnectAccountId: 'acct_1' })
  })
  it('cancel error and a missing Stripe account both surface as errors', async () => {
    resFind.mockResolvedValue({ paymentRef: 'stripe_cs_1', site: { userId: 'owner-1' } })
    stripeAccountForPartner.mockResolvedValue('acct_1')
    stripeCancel.mockResolvedValue('error')
    expect((await cancelReservationMolliePayment('r1')).status).toBe('error')
    stripeAccountForPartner.mockResolvedValue(null)
    expect((await cancelReservationMolliePayment('r1')).status).toBe('error')
  })
})

describe('demo', () => {
  it('demo refs still read as paid', async () => {
    resFind.mockResolvedValue({ paymentRef: 'pi_demo_1', site: { userId: 'u' } })
    expect(await getReservationPaymentStatus('r1')).toMatchObject({ status: 'ok', succeeded: true })
    rentalFind.mockResolvedValue({ paymentRef: 'pi_demo_1', site: { userId: 'u' } })
    expect(await getRentalBookingPaymentStatus('b1')).toMatchObject({ status: 'ok', succeeded: true })
  })
})
