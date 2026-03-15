import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// Mock auth (not used directly but imported transitively)
vi.mock('@/app/auth', () => ({
  auth: vi.fn().mockResolvedValue(null),
}))

// Mock Stripe client
const mockConstructEvent = vi.fn()
vi.mock('@/app/api/_lib/stripe', () => ({
  getStripeClient: () => ({
    webhooks: { constructEvent: mockConstructEvent },
  }),
}))

import { POST } from './route'
import prisma from '@repo/data/PrismaCient'
import { processConfirmedReservation, processConfirmedOrder } from '@repo/data/payment'

const mockReservationUpdateMany = vi.mocked(prisma.reservation.updateMany)
const mockOrderUpdateMany = vi.mocked(prisma.order.updateMany)
const mockProcessReservation = vi.mocked(processConfirmedReservation)
const mockProcessOrder = vi.mocked(processConfirmedOrder)

function makeWebhookRequest(body: string, signature = 'sig_test') {
  return new NextRequest('http://localhost:3002/api/webhooks/stripe', {
    method: 'POST',
    body,
    headers: {
      'content-type': 'application/json',
      'stripe-signature': signature,
    },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test'
})

describe('POST /api/webhooks/stripe', () => {
  it('returns 500 when STRIPE_WEBHOOK_SECRET is not set', async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET
    const res = await POST(makeWebhookRequest('{}'))
    expect(res.status).toBe(500)
  })

  it('returns 400 when stripe-signature header is missing', async () => {
    const req = new NextRequest('http://localhost:3002/api/webhooks/stripe', {
      method: 'POST',
      body: '{}',
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('stripe-signature')
  })

  it('returns 400 when signature verification fails', async () => {
    mockConstructEvent.mockImplementation(() => {
      throw new Error('Invalid signature')
    })
    const res = await POST(makeWebhookRequest('{}', 'bad_sig'))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('Invalid signature')
  })

  it('processes payment_intent.succeeded for reservation', async () => {
    mockConstructEvent.mockReturnValue({
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: 'pi_test',
          metadata: { type: 'reservation', entityId: 'res-1' },
        },
      },
    })

    const res = await POST(makeWebhookRequest('{}'))
    expect(res.status).toBe(200)
    expect(mockProcessReservation).toHaveBeenCalledWith('res-1')
  })

  it('processes payment_intent.succeeded for order', async () => {
    mockConstructEvent.mockReturnValue({
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: 'pi_test',
          metadata: { type: 'order', entityId: 'order-1' },
        },
      },
    })

    const res = await POST(makeWebhookRequest('{}'))
    expect(res.status).toBe(200)
    expect(mockProcessOrder).toHaveBeenCalledWith('order-1')
  })

  it('marks reservation as payment_failed on payment_intent.payment_failed', async () => {
    mockConstructEvent.mockReturnValue({
      type: 'payment_intent.payment_failed',
      data: {
        object: {
          id: 'pi_test',
          metadata: { type: 'reservation', entityId: 'res-1' },
        },
      },
    })
    mockReservationUpdateMany.mockResolvedValue({ count: 1 } as any)

    const res = await POST(makeWebhookRequest('{}'))
    expect(res.status).toBe(200)
    expect(mockReservationUpdateMany).toHaveBeenCalledWith({
      where: { id: 'res-1' },
      data: { status: 'payment_failed' },
    })
  })

  it('marks order as payment_failed on payment_intent.payment_failed', async () => {
    mockConstructEvent.mockReturnValue({
      type: 'payment_intent.payment_failed',
      data: {
        object: {
          id: 'pi_test',
          metadata: { type: 'order', entityId: 'order-1' },
        },
      },
    })
    mockOrderUpdateMany.mockResolvedValue({ count: 1 } as any)

    const res = await POST(makeWebhookRequest('{}'))
    expect(res.status).toBe(200)
    expect(mockOrderUpdateMany).toHaveBeenCalledWith({
      where: { id: 'order-1' },
      data: { status: 'payment_failed' },
    })
  })

  it('marks reservation as refunded on charge.refunded', async () => {
    mockConstructEvent.mockReturnValue({
      type: 'charge.refunded',
      data: {
        object: {
          id: 'ch_test',
          payment_intent: 'pi_test',
        },
      },
    })
    mockReservationUpdateMany.mockResolvedValue({ count: 1 } as any)
    mockOrderUpdateMany.mockResolvedValue({ count: 0 } as any)

    const res = await POST(makeWebhookRequest('{}'))
    expect(res.status).toBe(200)
    expect(mockReservationUpdateMany).toHaveBeenCalledWith({
      where: { paymentRef: 'pi_test' },
      data: { status: 'refunded' },
    })
  })

  it('returns 200 for unhandled event types', async () => {
    mockConstructEvent.mockReturnValue({
      type: 'customer.created',
      data: { object: {} },
    })

    const res = await POST(makeWebhookRequest('{}'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.received).toBe(true)
  })

  it('returns 500 when handler throws (triggers Stripe retry)', async () => {
    mockConstructEvent.mockReturnValue({
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: 'pi_test',
          metadata: { type: 'reservation', entityId: 'res-1' },
        },
      },
    })
    mockProcessReservation.mockRejectedValue(new Error('DB error'))

    const res = await POST(makeWebhookRequest('{}'))
    expect(res.status).toBe(500)
  })

  it('gracefully handles missing metadata', async () => {
    mockConstructEvent.mockReturnValue({
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: 'pi_test',
          metadata: {},
        },
      },
    })

    const res = await POST(makeWebhookRequest('{}'))
    expect(res.status).toBe(200)
    expect(mockProcessReservation).not.toHaveBeenCalled()
    expect(mockProcessOrder).not.toHaveBeenCalled()
  })
})
