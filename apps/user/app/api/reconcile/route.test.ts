import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/app/auth', () => ({
  auth: vi.fn().mockResolvedValue(null),
}))

const mockRetrieve = vi.fn()
vi.mock('@/app/api/_lib/stripe', () => ({
  getStripeClient: () => ({
    paymentIntents: { retrieve: mockRetrieve },
  }),
  isDemoPayment: (ref: string | null) => ref?.startsWith('pi_demo_') ?? false,
}))

import { POST } from './route'
import prisma from '@repo/data/PrismaCient'
import { processConfirmedReservation, processConfirmedOrder } from '@repo/data/payment'

const mockProcessReservation = vi.mocked(processConfirmedReservation)
const mockProcessOrder = vi.mocked(processConfirmedOrder)

function makeRequest(secret?: string) {
  const headers: Record<string, string> = {}
  if (secret) {
    headers['authorization'] = `Bearer ${secret}`
  }
  return new NextRequest('http://localhost:3002/api/reconcile', {
    method: 'POST',
    headers,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.RECONCILIATION_SECRET = 'test-secret'
  vi.mocked(prisma.reservation.findMany).mockResolvedValue([])
  vi.mocked(prisma.order.findMany).mockResolvedValue([])
})

describe('POST /api/reconcile', () => {
  it('returns 503 when RECONCILIATION_SECRET is not configured', async () => {
    delete process.env.RECONCILIATION_SECRET
    const res = await POST(makeRequest('anything'))
    expect(res.status).toBe(503)
  })

  it('returns 401 when authorization header is missing', async () => {
    const res = await POST(makeRequest())
    expect(res.status).toBe(401)
  })

  it('returns 401 when authorization header has wrong secret', async () => {
    const res = await POST(makeRequest('wrong-secret'))
    expect(res.status).toBe(401)
  })

  it('returns ok with empty results when no stuck payments', async () => {
    const res = await POST(makeRequest('test-secret'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('ok')
    expect(body.checked.reservations).toBe(0)
    expect(body.checked.orders).toBe(0)
  })

  it('processes stuck demo reservation', async () => {
    vi.mocked(prisma.reservation.findMany).mockResolvedValue([
      {
        id: 'res-1',
        paymentRef: 'pi_demo_123',
        status: 'processing',
      } as any,
    ])

    const res = await POST(makeRequest('test-secret'))
    expect(res.status).toBe(200)
    expect(mockProcessReservation).toHaveBeenCalledWith('res-1')

    const body = await res.json()
    expect(body.results.reservations.processed).toBe(1)
  })

  it('processes stuck Stripe reservation when status is succeeded', async () => {
    vi.mocked(prisma.reservation.findMany).mockResolvedValue([
      {
        id: 'res-1',
        paymentRef: 'pi_real_123',
        status: 'processing',
      } as any,
    ])
    mockRetrieve.mockResolvedValue({ status: 'succeeded' })

    const res = await POST(makeRequest('test-secret'))
    expect(res.status).toBe(200)
    expect(mockProcessReservation).toHaveBeenCalledWith('res-1')
  })

  it('marks stuck Stripe reservation as failed when status is canceled', async () => {
    vi.mocked(prisma.reservation.findMany).mockResolvedValue([
      {
        id: 'res-1',
        paymentRef: 'pi_real_123',
        status: 'processing',
      } as any,
    ])
    mockRetrieve.mockResolvedValue({ status: 'canceled' })
    vi.mocked(prisma.reservation.update).mockResolvedValue({} as any)

    const res = await POST(makeRequest('test-secret'))
    expect(res.status).toBe(200)
    expect(prisma.reservation.update).toHaveBeenCalledWith({
      where: { id: 'res-1' },
      data: { status: 'payment_failed' },
    })
  })

  it('processes stuck demo order', async () => {
    vi.mocked(prisma.order.findMany).mockResolvedValue([
      {
        id: 'order-1',
        paymentRef: 'pi_demo_456',
        status: 'processing',
      } as any,
    ])

    const res = await POST(makeRequest('test-secret'))
    expect(res.status).toBe(200)
    expect(mockProcessOrder).toHaveBeenCalledWith('order-1')

    const body = await res.json()
    expect(body.results.orders.processed).toBe(1)
  })

  it('counts errors when processing fails', async () => {
    vi.mocked(prisma.reservation.findMany).mockResolvedValue([
      {
        id: 'res-1',
        paymentRef: 'pi_demo_123',
        status: 'processing',
      } as any,
    ])
    mockProcessReservation.mockRejectedValue(new Error('DB error'))

    const res = await POST(makeRequest('test-secret'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.results.reservations.errors).toBe(1)
  })
})
