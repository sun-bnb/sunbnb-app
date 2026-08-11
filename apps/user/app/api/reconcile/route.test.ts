import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/app/auth', () => ({
  auth: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/app/api/_lib/payment-provider', () => ({
  getPaymentStatus: vi.fn(),
  isPaymentSucceeded: (s: string) => s === 'paid' || s === 'succeeded',
  isPaymentFailed: (s: string) => ['canceled', 'expired', 'failed'].includes(s),
}))

import { POST } from './route'
import prisma from '@repo/data/PrismaCient'
import { applyTransition } from '@repo/data/reservation-machine-apply'
import { processConfirmedReservation, processConfirmedOrder } from '@repo/data/payment'
import { getPaymentStatus } from '@/app/api/_lib/payment-provider'

const mockProcessReservation = vi.mocked(processConfirmedReservation)
const mockProcessOrder = vi.mocked(processConfirmedOrder)
const mockGetPaymentStatus = vi.mocked(getPaymentStatus)

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
  mockGetPaymentStatus.mockResolvedValue('paid')
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

  it('processes a stuck reservation whose payment succeeded (incl. demo)', async () => {
    vi.mocked(prisma.reservation.findMany).mockResolvedValue([
      { id: 'res-1', paymentRef: 'pi_demo_123', status: 'processing' } as any,
    ])
    mockGetPaymentStatus.mockResolvedValue('succeeded')

    const res = await POST(makeRequest('test-secret'))
    expect(res.status).toBe(200)
    expect(mockProcessReservation).toHaveBeenCalledWith('res-1')
    const body = await res.json()
    expect(body.results.reservations.processed).toBe(1)
  })

  it('marks a stuck reservation as failed when the payment failed', async () => {
    vi.mocked(prisma.reservation.findMany).mockResolvedValue([
      { id: 'res-1', paymentRef: 'tr_abc', status: 'processing' } as any,
    ])
    mockGetPaymentStatus.mockResolvedValue('canceled')

    const res = await POST(makeRequest('test-secret'))
    expect(res.status).toBe(200)
    // Machine pay.fail (track 018): the revert (online → payment_failed,
    // collect → unsettled cash) is state-derived inside the interpreter.
    expect(vi.mocked(applyTransition)).toHaveBeenCalledWith('res-1', 'pay.fail')
  })

  it('leaves a still-pending reservation untouched', async () => {
    vi.mocked(prisma.reservation.findMany).mockResolvedValue([
      { id: 'res-1', paymentRef: 'tr_abc', status: 'processing' } as any,
    ])
    mockGetPaymentStatus.mockResolvedValue('pending')

    const res = await POST(makeRequest('test-secret'))
    expect(res.status).toBe(200)
    expect(mockProcessReservation).not.toHaveBeenCalled()
    expect(prisma.reservation.update).not.toHaveBeenCalled()
  })

  it('processes a stuck order whose payment succeeded', async () => {
    vi.mocked(prisma.order.findMany).mockResolvedValue([
      { id: 'order-1', paymentRef: 'tr_def', status: 'processing' } as any,
    ])
    mockGetPaymentStatus.mockResolvedValue('paid')

    const res = await POST(makeRequest('test-secret'))
    expect(res.status).toBe(200)
    expect(mockProcessOrder).toHaveBeenCalledWith('order-1')
    const body = await res.json()
    expect(body.results.orders.processed).toBe(1)
  })

  it('counts errors when processing fails', async () => {
    vi.mocked(prisma.reservation.findMany).mockResolvedValue([
      { id: 'res-1', paymentRef: 'pi_demo_123', status: 'processing' } as any,
    ])
    mockGetPaymentStatus.mockResolvedValue('succeeded')
    mockProcessReservation.mockRejectedValue(new Error('DB error'))

    const res = await POST(makeRequest('test-secret'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.results.reservations.errors).toBe(1)
  })
})
