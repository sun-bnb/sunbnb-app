import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = vi.hoisted(() => ({
  reservationFind: vi.fn(),
  rentalFindMany: vi.fn(),
  orderFind: vi.fn(),
  orderUpdate: vi.fn(),
  tabFind: vi.fn(),
  tabUpdate: vi.fn(),
  tabUpdateMany: vi.fn(),
  trFind: vi.fn(),
  trUpdate: vi.fn(),
  loadFeeContext: vi.fn(),
  loadTabFeeContext: vi.fn(),
  calculateTabTotal: vi.fn(),
  markResStarted: vi.fn(),
  markResFailed: vi.fn(),
  markRentalStarted: vi.fn(),
  markRentalFailed: vi.fn(),
  createCheckout: vi.fn(),
}))

vi.mock('../index', () => ({
  default: {
    reservation: { findUnique: m.reservationFind },
    rentalBooking: { findMany: m.rentalFindMany },
    order: { findUnique: m.orderFind, update: m.orderUpdate },
    tableTab: { findUnique: m.tabFind, update: m.tabUpdate, updateMany: m.tabUpdateMany },
    tableReservation: { findUnique: m.trFind, update: m.trUpdate },
  },
}))
// Keep the pure fee helpers REAL (the tests assert via them); mock only the DB loaders.
vi.mock('./payment', async () => {
  const actual = await vi.importActual<typeof import('./payment')>('./payment')
  return {
    ...actual,
    loadFeeContext: m.loadFeeContext,
    loadTabFeeContext: m.loadTabFeeContext,
    calculateTabTotal: m.calculateTabTotal,
  }
})
vi.mock('./reservation-payment', () => ({
  markReservationCheckoutStarted: m.markResStarted,
  markReservationCheckoutFailed: m.markResFailed,
}))
vi.mock('./rental-payment', () => ({
  markRentalCheckoutStarted: m.markRentalStarted,
  markRentalCheckoutFailed: m.markRentalFailed,
}))
vi.mock('./payment-providers', async () => {
  const actual = await vi.importActual<typeof import('./payment-providers/types')>('./payment-providers/types')
  return {
    ...actual,
    getOnlineAdapter: () => ({ id: 'viva', createCheckout: m.createCheckout }),
  }
})

import {
  resolveCheckoutIntent,
  createOnlineCheckout,
  claimTabForPayment,
  releaseTabClaim,
  type CheckoutInput,
} from './checkout'
import { ProviderNotReadyError, ProviderNotWiredError } from './payment-providers/types'
import { resolveServiceFee, chargeableServiceFee, calculateServiceFeeAmount, round } from './payment'

const CREATED = new Date('2026-07-01T10:00:00Z')
const PCT_FEE = { id: 'f1', serviceCode: 'x', chargeType: 'percentage', percentage: 10, feeAmount: null, subscriptionTier: null, siteId: null, accountId: null }

/** A 10% settings-level fee for any service code, no site/account overrides. */
function feeCtx(serviceCode: string) {
  const settingsFees = [{ ...PCT_FEE, serviceCode }]
  return {
    site: { serviceFees: [] },
    partnerAccount: {
      userId: 'pa-1',
      serviceFees: [],
      promotions: [],
      vivaMerchantId: 'merchant-1',
      vivaSourceCode: 'src-1',
      vivaVerificationStatus: 'verified',
      subscription: { plan: { tier: 'STARTER' } },
    },
    settings: { serviceFees: settingsFees },
  }
}

/** The number the Mollie paths compute for this fixture, via the same helpers. */
function expectedFee(serviceCode: string, amount: number) {
  const c = feeCtx(serviceCode)
  const fee = chargeableServiceFee(
    resolveServiceFee(c.site.serviceFees as any, c.partnerAccount.serviceFees as any, c.settings.serviceFees as any, serviceCode, 'STARTER' as any),
    c.partnerAccount as any,
    CREATED,
  )
  return round(calculateServiceFeeAmount(fee, amount))
}

const base = { provider: 'viva' as const, redirectUrl: 'https://x/r', webhookUrl: 'https://x/w' }
const reservationInput: CheckoutInput = { ...base, kind: 'reservation', reservationId: 'res-1' }

beforeEach(() => {
  vi.clearAllMocks()
  m.loadFeeContext.mockImplementation(async (_s: string, code: string) => feeCtx(code))
})

describe('resolveCheckoutIntent — reservation', () => {
  const res = (over = {}) => ({ id: 'res-1', siteId: 's1', status: 'pending', paymentRef: null, paymentAmount: 40, createdAt: CREATED, _count: { items: 1 }, ...over })

  it('computes amount and fee exactly like the Mollie path', async () => {
    m.reservationFind.mockResolvedValue(res())
    const r = await resolveCheckoutIntent(reservationInput)
    expect(r.status).toBe('ok')
    if (r.status !== 'ok') return
    expect(r.intent.amount).toBe(40)
    expect(r.intent.applicationFee).toBe(expectedFee('sunbed-rental', 40))
    expect(r.intent.applicationFee).toBe(4)
    expect(r.intent.serviceCode).toBe('sunbed-rental')
    expect(r.intent.meta).toEqual({ type: 'reservation', entityId: 'res-1', siteId: 's1' })
    expect(r.account).toEqual({ partnerAccountId: 'pa-1', stripeConnectAccountId: null, stripeConnectChargesEnabled: false, vivaMerchantId: 'merchant-1', vivaSourceCode: 'src-1', vivaVerificationStatus: 'verified' })
    expect(m.loadFeeContext).toHaveBeenCalledWith('s1', 'sunbed-rental')
  })
  it('bad_state when a paymentRef already exists', async () => {
    m.reservationFind.mockResolvedValue(res({ paymentRef: 'tr_1' }))
    expect(await resolveCheckoutIntent(reservationInput)).toMatchObject({ reason: 'bad_state' })
  })
  it('bad_state when status is not payable', async () => {
    m.reservationFind.mockResolvedValue(res({ status: 'complete' }))
    expect(await resolveCheckoutIntent(reservationInput)).toMatchObject({ reason: 'bad_state' })
  })
  it('accepts a cash walk-in being collected by QR (paid-in-cash)', async () => {
    m.reservationFind.mockResolvedValue(res({ status: 'paid-in-cash' }))
    expect((await resolveCheckoutIntent({ ...reservationInput, metadataExtra: { collect: true } })).status).toBe('ok')
  })
  it('invalid_amount when amount <= 0', async () => {
    m.reservationFind.mockResolvedValue(res({ paymentAmount: 0 }))
    expect(await resolveCheckoutIntent(reservationInput)).toMatchObject({ reason: 'invalid_amount' })
  })
  it('not_found', async () => {
    m.reservationFind.mockResolvedValue(null)
    expect(await resolveCheckoutIntent(reservationInput)).toMatchObject({ reason: 'not_found' })
  })
  it('merges metadataExtra into meta', async () => {
    m.reservationFind.mockResolvedValue(res())
    const r = await resolveCheckoutIntent({ ...reservationInput, metadataExtra: { collect: true } })
    expect(r.status === 'ok' && r.intent.meta.collect).toBe(true)
  })
})

describe('resolveCheckoutIntent — rental', () => {
  const b = (id: string, over = {}) => ({ id, siteId: 's1', status: 'pending', paymentRef: null, paymentAmount: 10.1, createdAt: CREATED, ...over })
  const input: CheckoutInput = { ...base, kind: 'rental', rentalBookingIds: ['b1', 'b2'] }

  it('sums the group with round() and matches the Mollie fee', async () => {
    m.rentalFindMany.mockResolvedValue([b('b1'), b('b2', { paymentAmount: 20.2 })])
    const r = await resolveCheckoutIntent(input)
    expect(r.status).toBe('ok')
    if (r.status !== 'ok') return
    expect(r.intent.amount).toBe(30.3)
    expect(r.intent.applicationFee).toBe(expectedFee('equipment-rental', 30.3))
    expect(r.intent.meta).toEqual({ type: 'rental-booking', entityId: 'b1', bookingIds: ['b1', 'b2'], siteId: 's1' })
  })
  it('bad_state when any booking already has a ref', async () => {
    m.rentalFindMany.mockResolvedValue([b('b1'), b('b2', { paymentRef: 'tr_1' })])
    expect(await resolveCheckoutIntent(input)).toMatchObject({ reason: 'bad_state' })
  })
  it('invalid_amount when the total is 0', async () => {
    m.rentalFindMany.mockResolvedValue([b('b1', { paymentAmount: 0 }), b('b2', { paymentAmount: 0 })])
    expect(await resolveCheckoutIntent(input)).toMatchObject({ reason: 'invalid_amount' })
  })
})

describe('resolveCheckoutIntent — order', () => {
  const o = (over = {}) => ({ id: 'o1', siteId: 's1', status: 'pending', paymentRef: null, paymentAmount: 25, createdAt: CREATED, ...over })
  const input: CheckoutInput = { ...base, kind: 'order', orderId: 'o1' }

  it('uses food-and-beverage and the Mollie fee number', async () => {
    m.orderFind.mockResolvedValue(o())
    const r = await resolveCheckoutIntent(input)
    expect(r.status === 'ok' && r.intent.applicationFee).toBe(expectedFee('food-and-beverage', 25))
    expect(r.status === 'ok' && r.intent.meta).toEqual({ type: 'order', entityId: 'o1', siteId: 's1' })
  })
  it('bad_state with a ref', async () => {
    m.orderFind.mockResolvedValue(o({ paymentRef: 'tr_1' }))
    expect(await resolveCheckoutIntent(input)).toMatchObject({ reason: 'bad_state' })
  })
  it('invalid_amount', async () => {
    m.orderFind.mockResolvedValue(o({ paymentAmount: null }))
    expect(await resolveCheckoutIntent(input)).toMatchObject({ reason: 'invalid_amount' })
  })
  it('not_found for a site-less (tab) order', async () => {
    m.orderFind.mockResolvedValue(o({ siteId: null }))
    expect(await resolveCheckoutIntent(input)).toMatchObject({ reason: 'not_found' })
  })
})

describe('resolveCheckoutIntent — tab', () => {
  const t = (over = {}) => ({ id: 't1', siteId: null, restaurantId: 'rest-1', status: 'pending_payment', paymentRef: null, createdAt: CREATED, ...over })
  const input: CheckoutInput = { ...base, kind: 'tab', tabId: 't1' }
  beforeEach(() => {
    const c = feeCtx('food-and-beverage')
    m.loadTabFeeContext.mockResolvedValue({ siteFees: [], partnerAccount: c.partnerAccount, settings: c.settings, tier: 'STARTER' })
  })

  it('charges payableTotal (menu prices only) with the Mollie fee', async () => {
    m.tabFind.mockResolvedValue(t())
    m.calculateTabTotal.mockResolvedValue({ payableTotal: 55.5 })
    const r = await resolveCheckoutIntent(input)
    expect(r.status === 'ok' && r.intent.amount).toBe(55.5)
    expect(r.status === 'ok' && r.intent.applicationFee).toBe(expectedFee('food-and-beverage', 55.5))
    expect(r.status === 'ok' && r.intent.meta).toEqual({ type: 'tab', entityId: 't1', restaurantId: 'rest-1' })
    expect(m.loadTabFeeContext).toHaveBeenCalledWith({ siteId: null, restaurantId: 'rest-1' }, 'food-and-beverage')
  })
  it('bad_state for a closed tab and for one with a ref', async () => {
    m.tabFind.mockResolvedValue(t({ status: 'paid' }))
    expect(await resolveCheckoutIntent(input)).toMatchObject({ reason: 'bad_state' })
    m.tabFind.mockResolvedValue(t({ paymentRef: 'tr_1' }))
    expect(await resolveCheckoutIntent(input)).toMatchObject({ reason: 'bad_state' })
  })
  it('invalid_amount for an empty tab', async () => {
    m.tabFind.mockResolvedValue(t())
    m.calculateTabTotal.mockResolvedValue({ payableTotal: 0 })
    expect(await resolveCheckoutIntent(input)).toMatchObject({ reason: 'invalid_amount' })
  })
})

describe('resolveCheckoutIntent — table-deposit', () => {
  const d = (over = {}) => ({
    id: 'tr1', status: 'pending_payment', depositAmount: 15, depositStatus: 'pending', paymentRef: null,
    restaurantId: 'rest-1', createdAt: CREATED,
    restaurant: { partnerAccount: { userId: 'pa-9', vivaMerchantId: 'm9', vivaSourceCode: 's9', vivaVerificationStatus: 'verified' } },
    ...over,
  })
  const input: CheckoutInput = { ...base, kind: 'table-deposit', tableReservationId: 'tr1' }

  it('has NO commission and a null service code, and never loads a fee context', async () => {
    m.trFind.mockResolvedValue(d())
    const r = await resolveCheckoutIntent(input)
    expect(r.status).toBe('ok')
    if (r.status !== 'ok') return
    expect(r.intent.applicationFee).toBe(0)
    expect(r.intent.serviceCode).toBeNull()
    expect(r.intent.amount).toBe(15)
    expect(r.intent.partnerAccountId).toBe('pa-9')
    expect(r.intent.meta).toEqual({ type: 'table-deposit', entityId: 'tr1', restaurantId: 'rest-1' })
    expect(m.loadFeeContext).not.toHaveBeenCalled()
  })
  it('bad_state when a ref exists or the deposit is not pending', async () => {
    m.trFind.mockResolvedValue(d({ paymentRef: 'tr_1' }))
    expect(await resolveCheckoutIntent(input)).toMatchObject({ reason: 'bad_state' })
    m.trFind.mockResolvedValue(d({ depositStatus: 'held' }))
    expect(await resolveCheckoutIntent(input)).toMatchObject({ reason: 'bad_state' })
  })
  it('invalid_amount', async () => {
    m.trFind.mockResolvedValue(d({ depositAmount: 0 }))
    expect(await resolveCheckoutIntent(input)).toMatchObject({ reason: 'invalid_amount' })
  })
})

describe('createOnlineCheckout', () => {
  beforeEach(() => {
    m.reservationFind.mockResolvedValue({ id: 'res-1', siteId: 's1', status: 'pending', paymentRef: null, paymentAmount: 40, createdAt: CREATED, _count: { items: 1 } })
  })

  it('records the ref through markReservationCheckoutStarted', async () => {
    m.createCheckout.mockResolvedValue({ checkoutUrl: 'https://pay/x', paymentRef: 'vso_9' })
    const r = await createOnlineCheckout(reservationInput)
    expect(r).toEqual({ status: 'ok', checkoutUrl: 'https://pay/x', paymentRef: 'vso_9' })
    expect(m.markResStarted).toHaveBeenCalledWith('res-1', 'vso_9')
    expect(m.markResFailed).not.toHaveBeenCalled()
    expect(m.createCheckout).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 40, applicationFee: 4 }),
      { redirectUrl: 'https://x/r', webhookUrl: 'https://x/w' },
      expect.objectContaining({ partnerAccountId: 'pa-1' }),
    )
  })
  it('ProviderNotWiredError -> provider_unavailable, state untouched', async () => {
    m.createCheckout.mockRejectedValue(new ProviderNotWiredError('viva'))
    const r = await createOnlineCheckout(reservationInput)
    expect(r).toMatchObject({ status: 'error', reason: 'provider_unavailable' })
    expect(m.markResStarted).not.toHaveBeenCalled()
    expect(m.markResFailed).not.toHaveBeenCalled()
  })
  it('other adapter errors -> provider_error and markReservationCheckoutFailed', async () => {
    m.createCheckout.mockRejectedValue(new Error('boom'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await createOnlineCheckout(reservationInput)).toMatchObject({ reason: 'provider_error' })
    expect(m.markResFailed).toHaveBeenCalledWith('res-1')
  })
  it('viva without a connected merchant -> provider_not_ready, adapter not called', async () => {
    m.loadFeeContext.mockImplementation(async (_s: string, code: string) => {
      const c = feeCtx(code)
      return { ...c, partnerAccount: { ...c.partnerAccount, vivaMerchantId: null } }
    })
    expect(await createOnlineCheckout(reservationInput)).toMatchObject({ reason: 'provider_not_ready' })
    expect(m.createCheckout).not.toHaveBeenCalled()
  })
  it.each([null, 'pending', 'rejected'])('viva verification %s -> provider_not_ready, adapter not called', async (status) => {
    m.loadFeeContext.mockImplementation(async (_s: string, code: string) => {
      const c = feeCtx(code)
      return { ...c, partnerAccount: { ...c.partnerAccount, vivaVerificationStatus: status } }
    })
    expect(await createOnlineCheckout(reservationInput)).toMatchObject({ reason: 'provider_not_ready' })
    expect(m.createCheckout).not.toHaveBeenCalled()
  })
  describe('stripe readiness', () => {
    const stripeInput: CheckoutInput = { ...reservationInput, provider: 'stripe' }
    const withStripe = (over: Record<string, unknown>) =>
      m.loadFeeContext.mockImplementation(async (_s: string, code: string) => {
        const c = feeCtx(code)
        return { ...c, partnerAccount: { ...c.partnerAccount, ...over } }
      })

    it.each([
      ['no connected account', { stripeConnectAccountId: null, stripeConnectChargesEnabled: false }],
      ['account but charges not enabled', { stripeConnectAccountId: 'acct_1', stripeConnectChargesEnabled: false }],
      ['charges enabled flag without an account id', { stripeConnectAccountId: null, stripeConnectChargesEnabled: true }],
    ])('%s -> provider_not_ready, adapter not called', async (_n, over) => {
      withStripe(over)
      expect(await createOnlineCheckout(stripeInput)).toMatchObject({ status: 'error', reason: 'provider_not_ready' })
      expect(m.createCheckout).not.toHaveBeenCalled()
    })

    it('ready account: id is passed to the adapter', async () => {
      withStripe({ stripeConnectAccountId: 'acct_1', stripeConnectChargesEnabled: true })
      m.createCheckout.mockResolvedValue({ checkoutUrl: 'https://s/x', paymentRef: 'stripe_cs_1' })
      expect(await createOnlineCheckout(stripeInput)).toMatchObject({ status: 'ok', paymentRef: 'stripe_cs_1' })
      expect(m.createCheckout).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ stripeConnectAccountId: 'acct_1' }),
      )
    })

    it('adapter ProviderNotReadyError -> provider_not_ready without marking the entity failed', async () => {
      withStripe({ stripeConnectAccountId: 'acct_1', stripeConnectChargesEnabled: true })
      m.createCheckout.mockRejectedValue(new ProviderNotReadyError('Stripe'))
      expect(await createOnlineCheckout(stripeInput)).toMatchObject({ reason: 'provider_not_ready' })
      expect(m.markResFailed).not.toHaveBeenCalled()
    })
  })
  it('resolve failures pass through without touching the adapter', async () => {
    m.reservationFind.mockResolvedValue({ id: 'res-1', siteId: 's1', status: 'pending', paymentRef: 'tr_1', paymentAmount: 40, createdAt: CREATED, _count: { items: 1 } })
    expect(await createOnlineCheckout(reservationInput)).toMatchObject({ reason: 'bad_state' })
    expect(m.createCheckout).not.toHaveBeenCalled()
  })
  it('rental success/failure use the rental writers with the whole group', async () => {
    m.rentalFindMany.mockResolvedValue([
      { id: 'b1', siteId: 's1', status: 'pending', paymentRef: null, paymentAmount: 10, createdAt: CREATED },
      { id: 'b2', siteId: 's1', status: 'pending', paymentRef: null, paymentAmount: 5, createdAt: CREATED },
    ])
    const input: CheckoutInput = { ...base, kind: 'rental', rentalBookingIds: ['b1', 'b2'] }
    m.createCheckout.mockResolvedValueOnce({ checkoutUrl: 'u', paymentRef: 'vso_r' })
    await createOnlineCheckout(input)
    expect(m.markRentalStarted).toHaveBeenCalledWith(['b1', 'b2'], 'vso_r')
    m.createCheckout.mockRejectedValueOnce(new Error('x'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await createOnlineCheckout(input)
    expect(m.markRentalFailed).toHaveBeenCalledWith(['b1', 'b2'])
  })
  it('order: writes ref + processing; tab: ref only; deposit: ref on the table reservation', async () => {
    m.createCheckout.mockResolvedValue({ checkoutUrl: 'u', paymentRef: 'vso_z' })
    m.orderFind.mockResolvedValue({ id: 'o1', siteId: 's1', status: 'pending', paymentRef: null, paymentAmount: 25, createdAt: CREATED })
    await createOnlineCheckout({ ...base, kind: 'order', orderId: 'o1' })
    expect(m.orderUpdate).toHaveBeenCalledWith({ where: { id: 'o1' }, data: { paymentRef: 'vso_z', status: 'processing' } })

    const c = feeCtx('food-and-beverage')
    m.loadTabFeeContext.mockResolvedValue({ siteFees: [], partnerAccount: c.partnerAccount, settings: c.settings, tier: 'STARTER' })
    m.tabFind.mockResolvedValue({ id: 't1', siteId: null, restaurantId: 'r', status: 'pending_payment', paymentRef: null, createdAt: CREATED })
    m.calculateTabTotal.mockResolvedValue({ payableTotal: 10 })
    await createOnlineCheckout({ ...base, kind: 'tab', tabId: 't1' })
    expect(m.tabUpdate).toHaveBeenCalledWith({ where: { id: 't1' }, data: { paymentRef: 'vso_z' } })

    m.trFind.mockResolvedValue({
      id: 'tr1', status: 'pending_payment', depositAmount: 15, depositStatus: 'pending', paymentRef: null,
      restaurantId: 'r', createdAt: CREATED, restaurant: { partnerAccount: { userId: 'pa', vivaMerchantId: 'm', vivaSourceCode: 's', vivaVerificationStatus: 'verified' } },
    })
    await createOnlineCheckout({ ...base, kind: 'table-deposit', tableReservationId: 'tr1' })
    expect(m.trUpdate).toHaveBeenCalledWith({ where: { id: 'tr1' }, data: { paymentRef: 'vso_z' } })
  })
  it('tab provider failure releases the claim', async () => {
    const c = feeCtx('food-and-beverage')
    m.loadTabFeeContext.mockResolvedValue({ siteFees: [], partnerAccount: c.partnerAccount, settings: c.settings, tier: 'STARTER' })
    m.tabFind.mockResolvedValue({ id: 't1', siteId: null, restaurantId: 'r', status: 'pending_payment', paymentRef: null, createdAt: CREATED })
    m.calculateTabTotal.mockResolvedValue({ payableTotal: 10 })
    m.createCheckout.mockRejectedValue(new Error('x'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await createOnlineCheckout({ ...base, kind: 'tab', tabId: 't1' })
    expect(m.tabUpdateMany).toHaveBeenCalledWith({
      where: { id: 't1', status: 'pending_payment' },
      data: { status: 'open', paymentRef: null },
    })
  })
})

describe('tab claim', () => {
  it('claimed when the guarded updateMany hits a row', async () => {
    m.tabUpdateMany.mockResolvedValue({ count: 1 })
    expect(await claimTabForPayment('t1')).toBe('claimed')
    expect(m.tabUpdateMany).toHaveBeenCalledWith({ where: { id: 't1', status: 'open' }, data: { status: 'pending_payment' } })
    expect(m.tabFind).not.toHaveBeenCalled()
  })
  it.each([
    [null, 'not_found'],
    ['pending_payment', 'in_progress'],
    ['paid', 'closed'],
    ['settled_cash', 'closed'],
    ['discarded', 'closed'],
    ['weird', 'invalid'],
  ])('count 0 and current status %s -> %s', async (status, expected) => {
    m.tabUpdateMany.mockResolvedValue({ count: 0 })
    m.tabFind.mockResolvedValue(status ? { id: 't1', status } : null)
    expect(await claimTabForPayment('t1')).toBe(expected)
  })
  it('release only reverts a pending_payment tab', async () => {
    await releaseTabClaim('t1')
    expect(m.tabUpdateMany).toHaveBeenCalledWith({
      where: { id: 't1', status: 'pending_payment' },
      data: { status: 'open', paymentRef: null },
    })
  })
})
