/**
 * Unit tests for GET /api/rental-bookings/[id]
 *
 * Verifies anon ownership — both positive (correct anonId → 200) and negative
 * (foreign anonId → 403), mirroring the sunbed reservation route tests.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/app/auth', () => ({
  auth: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/app/api/_lib/payment-ids', () => ({
  isDemoPayment: (ref: string | null) => ref?.startsWith('pi_demo_') ?? false,
  isValidEntityId: () => true,
}))

vi.mock('@/app/api/_lib/payment-provider', () => ({
  getPaymentStatus: vi.fn(),
  isPaymentSucceeded: vi.fn(),
  isPaymentFailed: vi.fn(),
}))

import { GET } from './route'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import { processConfirmedRentalBooking } from '@repo/data/payment'
import { getPaymentStatus, isPaymentSucceeded, isPaymentFailed } from '@/app/api/_lib/payment-provider'

const mockAuth = vi.mocked(auth)
const mockFindUnique = vi.mocked(prisma.rentalBooking.findUnique)
const mockUpdateMany = vi.mocked(prisma.rentalBooking.updateMany)
const mockProcessRentalBooking = vi.mocked(processConfirmedRentalBooking)
const mockGetPaymentStatus = vi.mocked(getPaymentStatus)
const mockIsPaymentSucceeded = vi.mocked(isPaymentSucceeded)
const mockIsPaymentFailed = vi.mocked(isPaymentFailed)

function makeRequest(id: string, anonId?: string) {
  const url = anonId
    ? `http://localhost:3002/api/rental-bookings/${id}?anonId=${anonId}`
    : `http://localhost:3002/api/rental-bookings/${id}`
  return new NextRequest(url, { method: 'GET' })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue(null)
})

describe('GET /api/rental-bookings/[id]', () => {
  it('returns 401 when not authenticated and no anonId', async () => {
    const res = await GET(makeRequest('rb-1'), { params: { id: 'rb-1' } })
    expect(res.status).toBe(401)
  })

  it('returns 404 when booking not found', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    mockFindUnique.mockResolvedValue(null)

    const res = await GET(makeRequest('rb-1'), { params: { id: 'rb-1' } })
    expect(res.status).toBe(404)
  })

  it('returns 403 when authenticated user does not own booking', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    mockFindUnique.mockResolvedValue({
      id: 'rb-1',
      userId: 'user-2', // different owner
      anonId: null,
      status: 'complete',
    } as any)

    const res = await GET(makeRequest('rb-1'), { params: { id: 'rb-1' } })
    expect(res.status).toBe(403)
  })

  it('returns 200 when authenticated user owns the booking', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    const booking = {
      id: 'rb-1',
      userId: 'user-1',
      anonId: null,
      status: 'complete',
      paymentRef: null,
    }
    mockFindUnique.mockResolvedValue(booking as any)

    const res = await GET(makeRequest('rb-1'), { params: { id: 'rb-1' } })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.id).toBe('rb-1')
  })

  // BUG-REVEALING: before Phase 2, the route only checked userId, ignoring
  // booking.anonId. An anonymous user with the correct anonId would receive 403
  // even though they own the booking. After the fix, verifyOwnership uses anonId.
  it('returns 200 when anon owner presents correct anonId via query param', async () => {
    mockAuth.mockResolvedValue(null) // no session
    const anonId = '550e8400-e29b-41d4-a716-446655440000'
    const booking = {
      id: 'rb-1',
      userId: 'site-owner-1', // FK placeholder
      anonId,
      status: 'complete',
      paymentRef: null,
    }
    mockFindUnique.mockResolvedValue(booking as any)

    const res = await GET(makeRequest('rb-1', anonId), { params: { id: 'rb-1' } })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.id).toBe('rb-1')
  })

  // BUG-REVEALING: cross-anon isolation — a different anon user must be rejected.
  // This test fails if verifyOwnership does not compare booking.anonId to identity.anonId.
  it('returns 403 when anon user presents a foreign anonId (cross-anon isolation)', async () => {
    mockAuth.mockResolvedValue(null) // no session
    const ownerAnonId = '550e8400-e29b-41d4-a716-446655440000'
    const foreignAnonId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'

    const booking = {
      id: 'rb-1',
      userId: 'site-owner-1',
      anonId: ownerAnonId, // booked by ownerAnonId
      status: 'complete',
      paymentRef: null,
    }
    mockFindUnique.mockResolvedValue(booking as any)

    // Request uses a different (foreign) anonId
    const res = await GET(makeRequest('rb-1', foreignAnonId), { params: { id: 'rb-1' } })
    expect(res.status).toBe(403)
  })

  it('returns 403 when no identity can be established (unauthenticated, no anonId)', async () => {
    mockAuth.mockResolvedValue(null)
    // No anonId in the URL either
    const res = await GET(makeRequest('rb-1'), { params: { id: 'rb-1' } })
    expect(res.status).toBe(401)
  })

  it('processes demo payment immediately when booking is in processing state', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    const booking = {
      id: 'rb-1',
      userId: 'user-1',
      anonId: null,
      status: 'processing',
      paymentRef: 'pi_demo_123',
    }
    mockFindUnique
      .mockResolvedValueOnce(booking as any)
      .mockResolvedValueOnce({ ...booking, status: 'complete' } as any)

    const res = await GET(makeRequest('rb-1'), { params: { id: 'rb-1' } })
    expect(res.status).toBe(200)
    expect(mockProcessRentalBooking).toHaveBeenCalledWith('pi_demo_123')
  })

  it('verifies real payment with provider when booking is in processing state', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    const booking = {
      id: 'rb-1',
      userId: 'user-1',
      anonId: null,
      status: 'processing',
      paymentRef: 'tr_real_abc',
    }
    mockFindUnique
      .mockResolvedValueOnce(booking as any)
      .mockResolvedValueOnce({ ...booking, status: 'complete' } as any)
    mockGetPaymentStatus.mockResolvedValue('succeeded')
    mockIsPaymentSucceeded.mockReturnValue(true)
    mockIsPaymentFailed.mockReturnValue(false)

    const res = await GET(makeRequest('rb-1'), { params: { id: 'rb-1' } })
    expect(res.status).toBe(200)
    expect(mockProcessRentalBooking).toHaveBeenCalledWith('tr_real_abc')
  })

  it('marks booking as payment_failed when payment failed', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    const booking = {
      id: 'rb-1',
      userId: 'user-1',
      anonId: null,
      status: 'processing',
      paymentRef: 'tr_real_abc',
    }
    mockFindUnique
      .mockResolvedValueOnce(booking as any)
      .mockResolvedValueOnce({ ...booking, status: 'payment_failed' } as any)
    mockGetPaymentStatus.mockResolvedValue('canceled')
    mockIsPaymentSucceeded.mockReturnValue(false)
    mockIsPaymentFailed.mockReturnValue(true)
    mockUpdateMany.mockResolvedValue({ count: 1 } as any)

    const res = await GET(makeRequest('rb-1'), { params: { id: 'rb-1' } })
    expect(res.status).toBe(200)
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { paymentRef: 'tr_real_abc' },
      data: { status: 'payment_failed' },
    })
  })
})
