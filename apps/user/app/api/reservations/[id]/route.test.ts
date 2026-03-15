import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/app/auth', () => ({
  auth: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/app/api/_lib/stripe', () => ({
  isDemoPayment: (ref: string | null) => ref?.startsWith('pi_demo_') ?? false,
}))

vi.mock('@/app/api/_lib/payment-provider', () => ({
  getPaymentStatus: vi.fn(),
  isPaymentSucceeded: vi.fn(),
  isPaymentFailed: vi.fn(),
}))

import { GET } from './route'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import { processConfirmedReservation } from '@repo/data/payment'
import { getPaymentStatus, isPaymentSucceeded, isPaymentFailed } from '@/app/api/_lib/payment-provider'

const mockAuth = vi.mocked(auth)
const mockFindUnique = vi.mocked(prisma.reservation.findUnique)
const mockUpdate = vi.mocked(prisma.reservation.update)
const mockProcessReservation = vi.mocked(processConfirmedReservation)
const mockGetPaymentStatus = vi.mocked(getPaymentStatus)
const mockIsPaymentSucceeded = vi.mocked(isPaymentSucceeded)
const mockIsPaymentFailed = vi.mocked(isPaymentFailed)

function makeRequest(id: string, anonId?: string) {
  const url = anonId
    ? `http://localhost:3002/api/reservations/${id}?anonId=${anonId}`
    : `http://localhost:3002/api/reservations/${id}`
  return new NextRequest(url, { method: 'GET' })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue(null)
})

describe('GET /api/reservations/[id]', () => {
  it('returns 401 when not authenticated', async () => {
    const res = await GET(makeRequest('res-1'), { params: { id: 'res-1' } })
    expect(res.status).toBe(401)
  })

  it('returns 404 when reservation not found', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    mockFindUnique.mockResolvedValue(null)

    const res = await GET(makeRequest('res-1'), { params: { id: 'res-1' } })
    expect(res.status).toBe(404)
  })

  it('returns 403 when user does not own reservation', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    mockFindUnique.mockResolvedValue({
      id: 'res-1',
      userId: 'user-2',
      anonId: null,
      status: 'complete',
    } as any)

    const res = await GET(makeRequest('res-1'), { params: { id: 'res-1' } })
    expect(res.status).toBe(403)
  })

  it('returns reservation when user owns it', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    const reservation = {
      id: 'res-1',
      userId: 'user-1',
      anonId: null,
      status: 'complete',
      paymentRef: 'pi_test',
    }
    mockFindUnique.mockResolvedValue(reservation as any)

    const res = await GET(makeRequest('res-1'), { params: { id: 'res-1' } })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.id).toBe('res-1')
  })

  it('supports anonymous auth via anonId query param', async () => {
    mockAuth.mockResolvedValue(null) // no session
    const reservation = {
      id: 'res-1',
      userId: 'user-1',
      anonId: 'anon-123',
      status: 'complete',
    }
    mockFindUnique.mockResolvedValue(reservation as any)

    const res = await GET(makeRequest('res-1', 'anon-123'), {
      params: { id: 'res-1' },
    })
    expect(res.status).toBe(200)
  })

  it('processes demo payment immediately when status is processing', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    const reservation = {
      id: 'res-1',
      userId: 'user-1',
      status: 'processing',
      paymentRef: 'pi_demo_123',
    }
    // First call returns processing, second returns complete (after processing)
    mockFindUnique
      .mockResolvedValueOnce(reservation as any)
      .mockResolvedValueOnce({ ...reservation, status: 'complete' } as any)

    const res = await GET(makeRequest('res-1'), { params: { id: 'res-1' } })
    expect(res.status).toBe(200)
    expect(mockProcessReservation).toHaveBeenCalledWith('res-1')
  })

  it('verifies real payment with provider when processing', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    const reservation = {
      id: 'res-1',
      userId: 'user-1',
      status: 'processing',
      paymentRef: 'pi_real_123',
    }
    mockFindUnique
      .mockResolvedValueOnce(reservation as any)
      .mockResolvedValueOnce({ ...reservation, status: 'complete' } as any)
    mockGetPaymentStatus.mockResolvedValue('succeeded')
    mockIsPaymentSucceeded.mockReturnValue(true)
    mockIsPaymentFailed.mockReturnValue(false)

    const res = await GET(makeRequest('res-1'), { params: { id: 'res-1' } })
    expect(res.status).toBe(200)
    expect(mockProcessReservation).toHaveBeenCalledWith('res-1')
  })

  it('marks reservation as failed when payment failed', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    const reservation = {
      id: 'res-1',
      userId: 'user-1',
      status: 'processing',
      paymentRef: 'pi_real_123',
    }
    mockFindUnique
      .mockResolvedValueOnce(reservation as any)
      .mockResolvedValueOnce({
        ...reservation,
        status: 'payment_failed',
      } as any)
    mockGetPaymentStatus.mockResolvedValue('canceled')
    mockIsPaymentSucceeded.mockReturnValue(false)
    mockIsPaymentFailed.mockReturnValue(true)
    mockUpdate.mockResolvedValue({} as any)

    const res = await GET(makeRequest('res-1'), { params: { id: 'res-1' } })
    expect(res.status).toBe(200)
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'res-1' },
      data: { status: 'payment_failed' },
    })
  })

  it('returns current state when payment is still processing', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    const reservation = {
      id: 'res-1',
      userId: 'user-1',
      status: 'processing',
      paymentRef: 'pi_real_123',
    }
    mockFindUnique
      .mockResolvedValueOnce(reservation as any)
      .mockResolvedValueOnce(reservation as any)
    mockGetPaymentStatus.mockResolvedValue('processing')
    mockIsPaymentSucceeded.mockReturnValue(false)
    mockIsPaymentFailed.mockReturnValue(false)

    const res = await GET(makeRequest('res-1'), { params: { id: 'res-1' } })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('processing')
    expect(mockProcessReservation).not.toHaveBeenCalled()
  })
})
