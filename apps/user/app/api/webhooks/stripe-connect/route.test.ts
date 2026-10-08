import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/app/auth', () => ({ auth: vi.fn().mockResolvedValue(null) }))

const { mockConstruct, mockSessionsList, mockFetchCheckout, mockFetchPI, mockOnState, mockFindEntity } =
  vi.hoisted(() => ({
    mockConstruct: vi.fn(),
    mockSessionsList: vi.fn(),
    mockFetchCheckout: vi.fn(),
    mockFetchPI: vi.fn(),
    mockOnState: vi.fn(),
    mockFindEntity: vi.fn(),
  }))

vi.mock('@repo/data/stripe', () => ({
  getStripeConnectClient: () => ({
    webhooks: { constructEvent: mockConstruct },
    checkout: { sessions: { list: mockSessionsList } },
  }),
  fetchCheckoutState: mockFetchCheckout,
  fetchPaymentIntentState: mockFetchPI,
  unflattenMeta: (m: Record<string, string> | null) =>
    m?.type && m?.entityId ? { type: m.type, entityId: m.entityId } : null,
}))
vi.mock('@/app/api/_lib/payment-events', () => ({
  onPaymentState: mockOnState,
  findPaymentEntity: mockFindEntity,
}))

import { POST } from './route'

const META = { type: 'reservation', entityId: 'r1' }

function req() {
  return new NextRequest('http://localhost:3002/api/webhooks/stripe-connect', {
    method: 'POST',
    body: '{}',
    headers: { 'stripe-signature': 'sig' },
  })
}
function event(type: string, object: unknown, account: string | null = 'acct_1') {
  mockConstruct.mockReturnValue({ type, account: account ?? undefined, data: { object } })
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.STRIPE_CONNECT_WEBHOOK_SECRET = 'whsec_test'
  mockOnState.mockResolvedValue(undefined)
  mockFindEntity.mockResolvedValue(null)
})
afterEach(() => {
  delete process.env.STRIPE_CONNECT_WEBHOOK_SECRET
})

describe('POST /api/webhooks/stripe-connect', () => {
  it('503 when the secret is unset', async () => {
    delete process.env.STRIPE_CONNECT_WEBHOOK_SECRET
    expect((await POST(req())).status).toBe(503)
  })

  it('400 on a bad signature', async () => {
    mockConstruct.mockImplementation(() => {
      throw new Error('bad sig')
    })
    expect((await POST(req())).status).toBe(400)
    expect(mockOnState).not.toHaveBeenCalled()
  })

  it('ignores events without event.account', async () => {
    event('checkout.session.completed', { id: 'cs_1' }, null)
    const res = await POST(req())
    expect(res.status).toBe(200)
    expect((await res.json()).ignored).toBe('not a connect event')
    expect(mockFetchCheckout).not.toHaveBeenCalled()
  })

  it('session.completed -> paid from the re-fetched state, using event.account', async () => {
    event('checkout.session.completed', { id: 'cs_1', metadata: {} })
    mockFetchCheckout.mockResolvedValue({ state: 'paid', meta: META })
    expect((await POST(req())).status).toBe(200)
    expect(mockFetchCheckout).toHaveBeenCalledWith('cs_1', 'acct_1')
    expect(mockOnState).toHaveBeenCalledWith(META, 'stripe_cs_cs_1', 'paid')
  })

  it('completed but re-fetch still pending -> no state call', async () => {
    event('checkout.session.completed', { id: 'cs_1' })
    mockFetchCheckout.mockResolvedValue({ state: 'pending', meta: META })
    expect((await POST(req())).status).toBe(200)
    expect(mockOnState).not.toHaveBeenCalled()
  })

  it('session.expired -> failed', async () => {
    event('checkout.session.expired', { id: 'cs_1' })
    mockFetchCheckout.mockResolvedValue({ state: 'failed', meta: META })
    await POST(req())
    expect(mockOnState).toHaveBeenCalledWith(META, 'stripe_cs_cs_1', 'failed')
  })

  it('unknown payment (no meta, no entity) -> 200 ignored', async () => {
    event('checkout.session.completed', { id: 'cs_1' })
    mockFetchCheckout.mockResolvedValue({ state: 'paid', meta: null })
    const res = await POST(req())
    expect((await res.json()).ignored).toBe('unknown payment')
    expect(mockOnState).not.toHaveBeenCalled()
  })

  it('terminal PI succeeded -> paid', async () => {
    event('payment_intent.succeeded', { id: 'pi_1' })
    mockFindEntity.mockResolvedValue(META)
    mockFetchPI.mockResolvedValue({ state: 'paid', meta: null })
    await POST(req())
    expect(mockFetchPI).toHaveBeenCalledWith('pi_1', 'acct_1')
    expect(mockOnState).toHaveBeenCalledWith(META, 'stripe_pi_pi_1', 'paid')
  })

  it('Checkout-created PI succeeded is ignored', async () => {
    event('payment_intent.succeeded', { id: 'pi_1' })
    mockFindEntity.mockResolvedValue(null)
    const res = await POST(req())
    expect(res.status).toBe(200)
    expect(mockFetchPI).not.toHaveBeenCalled()
    expect(mockOnState).not.toHaveBeenCalled()
  })

  it('charge.refunded on a Checkout PI -> refunded via the session lookup on event.account', async () => {
    event('charge.refunded', { payment_intent: 'pi_9' })
    mockFindEntity.mockImplementation(async (ref: string) => (ref === 'stripe_cs_cs_9' ? META : null))
    mockSessionsList.mockResolvedValue({ data: [{ id: 'cs_9' }] })
    await POST(req())
    expect(mockSessionsList).toHaveBeenCalledWith({ payment_intent: 'pi_9' }, { stripeAccount: 'acct_1' })
    expect(mockOnState).toHaveBeenCalledWith(META, 'stripe_cs_cs_9', 'refunded')
  })

  it('charge.refunded on a terminal PI -> refunded without a session lookup', async () => {
    event('charge.refunded', { payment_intent: 'pi_9' })
    mockFindEntity.mockResolvedValue(META)
    await POST(req())
    expect(mockSessionsList).not.toHaveBeenCalled()
    expect(mockOnState).toHaveBeenCalledWith(META, 'stripe_pi_pi_9', 'refunded')
  })

  it('other event types -> 200 no-op', async () => {
    event('customer.created', {})
    expect((await POST(req())).status).toBe(200)
    expect(mockOnState).not.toHaveBeenCalled()
  })

  it('handler error -> 500', async () => {
    event('checkout.session.completed', { id: 'cs_1' })
    mockFetchCheckout.mockResolvedValue({ state: 'paid', meta: META })
    mockOnState.mockRejectedValue(new Error('boom'))
    expect((await POST(req())).status).toBe(500)
  })
})
