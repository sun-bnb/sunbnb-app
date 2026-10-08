/**
 * Stripe Tap to Pay collect flow — integration tests (track 028, P5a).
 * Real sunbnb_test DB + real machine; `./stripe/terminal` and the Stripe client are faked
 * (a stateful PaymentIntent) so the reverify -> finalize path runs for real on a stripe_pi_ ref.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { cleanDatabase, disconnectDatabase, prisma } from './test/setup'
import {
  createTestUser, createTestPartnerAccount, createTestSite, createTestInventoryItem,
  createTestReservation, createTestSettings, createTestServiceFee, resetCounter,
} from './test/fixtures'
import { applyTransition } from './reservation-machine-apply'
import { siteDayBounds } from './site-day'

const m = vi.hoisted(() => ({
  ensureTerminalLocation: vi.fn(),
  createTerminalPaymentIntent: vi.fn(),
  cancelTerminalPaymentIntent: vi.fn(),
  pi: { status: 'requires_payment_method' as string },
}))

vi.mock('./stripe/terminal', () => ({
  ensureTerminalLocation: m.ensureTerminalLocation,
  createTerminalPaymentIntent: m.createTerminalPaymentIntent,
  cancelTerminalPaymentIntent: m.cancelTerminalPaymentIntent,
  createConnectionToken: vi.fn(),
}))
vi.mock('./stripe/client', () => ({
  getStripeClient: () => { throw new Error('unused') },
  getStripeConnectClient: () => ({
    paymentIntents: {
      retrieve: async () => ({
        id: 'pi_tap_1', status: m.pi.status,
        latest_charge: m.pi.status === 'succeeded' ? { id: 'ch_1', refunded: false } : null,
        metadata: { type: 'reservation', entityId: 'x', collect: '1' },
      }),
    },
  }),
}))

const HELSINKI = { latitude: 60.1699, longitude: 24.9384 }
const ACCT = 'acct_tap'

let user: Awaited<ReturnType<typeof createTestUser>>
let site: Awaited<ReturnType<typeof createTestSite>>

async function setup(partner: Record<string, unknown> = { stripeConnectAccountId: ACCT, stripeConnectChargesEnabled: true }) {
  user = await createTestUser()
  await createTestPartnerAccount(user.id, partner)
  site = await createTestSite(user.id, { type: 'paid', price: 10 })
}

beforeEach(async () => {
  await cleanDatabase()
  resetCounter()
  vi.clearAllMocks()
  m.pi.status = 'requires_payment_method'
  m.ensureTerminalLocation.mockResolvedValue('tml_1')
  m.createTerminalPaymentIntent.mockResolvedValue({ paymentIntentId: 'pi_tap_1', clientSecret: 'pi_tap_1_secret_x' })
  m.cancelTerminalPaymentIntent.mockResolvedValue('canceled')
  await setup()
})
afterAll(disconnectDatabase)

async function walkIn() {
  const { start, end } = siteDayBounds(HELSINKI)
  const item = await createTestInventoryItem(user.id, site.id, { number: 1, price: 10 })
  return createTestReservation(user.id, site.id, [item.id], {
    status: 'paid-in-cash', operationalStatus: 'walked-in', checkedInAt: new Date(),
    paymentRef: null, paymentAmount: 10, from: start, to: end,
  })
}
const reload = (id: string) => prisma.reservation.findUniqueOrThrow({ where: { id } })
const startTap = async () => {
  const r = await walkIn()
  const res = await applyTransition(r.id, 'collect.start', { collect: { method: 'tap-to-pay' } })
  return { r, res }
}

describe('collect.start tap-to-pay', () => {
  it('writes stripe_pi_ ref + processing, returns the tapToPay tuple, fee = commission + pass-through', async () => {
    const { r, res } = await startTap()
    expect(res.outcome).toBe('applied')
    if (res.outcome === 'applied') {
      expect(res.data).toEqual({
        amount: 10,
        tapToPay: { paymentIntentId: 'pi_tap_1', clientSecret: 'pi_tap_1_secret_x', stripeAccount: ACCT, locationId: 'tml_1', currency: 'eur' },
      })
    }
    const after = await reload(r.id)
    expect(after.status).toBe('processing')
    expect(after.paymentRef).toBe('stripe_pi_pi_tap_1')
    expect(after.anonId).toBeNull()
    expect(m.createTerminalPaymentIntent).toHaveBeenCalledWith(expect.objectContaining({
      amount: 10, stripeAccount: ACCT,
      applicationFee: 1.4, // default fixed EUR 1.00 commission + round(10*1.5% + 0.25) = 0.40
      meta: { type: 'reservation', entityId: r.id, siteId: site.id, collect: true },
    }))
  })

  it('venue not connected -> effect-failed and reverts to cash', async () => {
    await cleanDatabase()
    await setup({ stripeConnectAccountId: null, stripeConnectChargesEnabled: false })
    const { r, res } = await startTap()
    expect(res.outcome).toBe('effect-failed')
    const after = await reload(r.id)
    expect(after.status).toBe('paid-in-cash')
    expect(after.paymentRef).toBeNull()
    expect(m.createTerminalPaymentIntent).not.toHaveBeenCalled()
  })

  it('Stripe failure -> effect-failed and reverts to cash', async () => {
    m.createTerminalPaymentIntent.mockRejectedValue(new Error('stripe down'))
    const { r, res } = await startTap()
    expect(res).toMatchObject({ outcome: 'effect-failed', effect: 'stripeTerminalIntent', error: 'stripe down' })
    expect((await reload(r.id)).status).toBe('paid-in-cash')
  })

  it('a 150% site fee is capped below the charge (Stripe rejects fee >= amount)', async () => {
    const settings = await createTestSettings()
    await createTestServiceFee(settings.id, { siteId: site.id, chargeType: 'percentage', percentage: 150 })
    await startTap()
    expect(m.createTerminalPaymentIntent.mock.calls[0]![0].applicationFee).toBe(9.99)
  })

  it('demo mode keeps the pi_demo_ short-circuit and never touches Stripe', async () => {
    const r = await walkIn()
    const res = await applyTransition(r.id, 'collect.start', { collect: { method: 'tap-to-pay', demo: true } })
    expect(res.outcome).toBe('applied')
    expect((await reload(r.id)).paymentRef).toMatch(/^pi_demo_/)
    expect(m.createTerminalPaymentIntent).not.toHaveBeenCalled()
  })
})

describe('collect.abandon tap-to-pay', () => {
  it('PI canceled -> reverts to unsettled cash, bed kept', async () => {
    const { r } = await startTap()
    const res = await applyTransition(r.id, 'collect.abandon')
    expect(res.outcome).toBe('applied')
    if (res.outcome === 'applied') expect(res.data?.paymentStatus).toBe('cash')
    expect(m.cancelTerminalPaymentIntent).toHaveBeenCalledWith('pi_tap_1', ACCT)
    const after = await reload(r.id)
    expect(after.status).toBe('paid-in-cash')
    expect(after.paymentRef).toBeNull()
    expect(after.operationalStatus).toBe('walked-in')
  })

  it('tap lands during cancel (paid race) -> complete + invoices', async () => {
    const { r } = await startTap()
    m.cancelTerminalPaymentIntent.mockImplementation(async () => { m.pi.status = 'succeeded'; return 'paid' })
    const res = await applyTransition(r.id, 'collect.abandon')
    expect(res.outcome).toBe('applied')
    if (res.outcome === 'applied') {
      expect(res.data?.paymentStatus).toBe('complete')
      expect(res.transition.event).toBe('pay.confirm')
    }
    expect((await reload(r.id)).status).toBe('complete')
    const n = await prisma.invoice.count({ where: { reservationId: r.id } })
    expect(n).toBeGreaterThanOrEqual(1)
  })

  it('already succeeded before abandon -> finalizes without cancelling', async () => {
    const { r } = await startTap()
    m.pi.status = 'succeeded'
    const res = await applyTransition(r.id, 'collect.abandon')
    expect(res.outcome === 'applied' && res.data?.paymentStatus).toBe('complete')
    expect(m.cancelTerminalPaymentIntent).not.toHaveBeenCalled()
    expect((await reload(r.id)).status).toBe('complete')
  })

  it('cancel error while still processing -> stays processing, never reverts', async () => {
    const { r } = await startTap()
    m.pi.status = 'processing'
    m.cancelTerminalPaymentIntent.mockResolvedValue('error')
    const res = await applyTransition(r.id, 'collect.abandon', { collect: { abortPollMs: 0 } })
    expect(res.outcome === 'applied' && res.data?.paymentStatus).toBe('processing')
    const after = await reload(r.id)
    expect(after.status).toBe('processing')
    expect(after.paymentRef).toBe('stripe_pi_pi_tap_1')
  })
})
