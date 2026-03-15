import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// Mock auth
vi.mock('@/app/auth', () => ({
  auth: vi.fn().mockResolvedValue(null),
}))

// Mock Stripe client — inline the helper functions to avoid await
const mockCreate = vi.fn()
vi.mock('@/app/api/_lib/stripe', () => ({
  getStripeClient: () => ({
    paymentIntents: { create: mockCreate },
  }),
  isValidEntityId: (value: string) => {
    const cuid = /^c[a-z0-9]{24,}$/
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    return cuid.test(value) || uuid.test(value)
  },
  isDemoPayment: (ref: string | null) => ref?.startsWith('pi_demo_') ?? false,
}))

import { POST } from './route'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'

const mockAuth = vi.mocked(auth)
const mockFindUnique = vi.mocked(prisma.reservation.findUnique)
const mockUpdate = vi.mocked(prisma.reservation.update)

function makeRequest(body: Record<string, any>) {
  return new NextRequest('http://localhost:3002/api/payment/stripe/payment-intent', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.STRIPE_SECRET_KEY = 'sk_test_123'
})

describe('POST /api/payment/stripe/payment-intent', () => {
  it('returns 400 when reservationId is missing', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    const res = await POST(makeRequest({}))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('reservationId')
  })

  it('returns 400 for invalid reservationId format', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    const res = await POST(makeRequest({ reservationId: 'invalid!' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('Invalid')
  })

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await POST(
      makeRequest({ reservationId: 'cm1234567890abcdefghijklmn' })
    )
    expect(res.status).toBe(401)
  })

  it('returns 404 when reservation not found', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    mockFindUnique.mockResolvedValue(null)
    const res = await POST(
      makeRequest({ reservationId: 'cm1234567890abcdefghijklmn' })
    )
    expect(res.status).toBe(404)
  })

  it('returns 403 when user does not own reservation', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    mockFindUnique.mockResolvedValue({
      id: 'cm1234567890abcdefghijklmn',
      userId: 'user-2',
      status: 'pending',
      paymentAmount: 20,
      paymentRef: null,
      siteId: 'site-1',
    } as any)
    const res = await POST(
      makeRequest({ reservationId: 'cm1234567890abcdefghijklmn' })
    )
    expect(res.status).toBe(403)
  })

  it('returns 400 when paymentRef already exists', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    mockFindUnique.mockResolvedValue({
      id: 'cm1234567890abcdefghijklmn',
      userId: 'user-1',
      status: 'pending',
      paymentAmount: 20,
      paymentRef: 'pi_existing',
      siteId: 'site-1',
    } as any)
    const res = await POST(
      makeRequest({ reservationId: 'cm1234567890abcdefghijklmn' })
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('already created')
  })

  it('returns 400 when reservation is not pending', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    mockFindUnique.mockResolvedValue({
      id: 'cm1234567890abcdefghijklmn',
      userId: 'user-1',
      status: 'complete',
      paymentAmount: 20,
      paymentRef: null,
      siteId: 'site-1',
    } as any)
    const res = await POST(
      makeRequest({ reservationId: 'cm1234567890abcdefghijklmn' })
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('pending')
  })

  it('returns 400 when payment amount is zero', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    mockFindUnique.mockResolvedValue({
      id: 'cm1234567890abcdefghijklmn',
      userId: 'user-1',
      status: 'pending',
      paymentAmount: 0,
      paymentRef: null,
      siteId: 'site-1',
    } as any)
    const res = await POST(
      makeRequest({ reservationId: 'cm1234567890abcdefghijklmn' })
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('amount')
  })

  it('returns 500 when STRIPE_SECRET_KEY is not set', async () => {
    delete process.env.STRIPE_SECRET_KEY
    const res = await POST(
      makeRequest({ reservationId: 'cm1234567890abcdefghijklmn' })
    )
    expect(res.status).toBe(500)
  })

  it('returns clientSecret on success', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    mockFindUnique.mockResolvedValue({
      id: 'cm1234567890abcdefghijklmn',
      userId: 'user-1',
      status: 'pending',
      paymentAmount: 20.5,
      paymentRef: null,
      siteId: 'site-1',
    } as any)
    mockCreate.mockResolvedValue({
      id: 'pi_test_123',
      client_secret: 'pi_test_123_secret',
    })
    mockUpdate.mockResolvedValue({} as any)

    const res = await POST(
      makeRequest({ reservationId: 'cm1234567890abcdefghijklmn' })
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.clientSecret).toBe('pi_test_123_secret')

    // Verify Stripe was called with correct amount in cents
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 2050,
        currency: 'eur',
      }),
      expect.objectContaining({
        idempotencyKey: 'reservation-pi-cm1234567890abcdefghijklmn',
      })
    )
  })

  it('supports anonymous auth via anonId in body', async () => {
    mockAuth.mockResolvedValue(null) // no session
    mockFindUnique.mockResolvedValue({
      id: 'cm1234567890abcdefghijklmn',
      userId: 'user-1',
      anonId: 'anon-123',
      status: 'pending',
      paymentAmount: 10,
      paymentRef: null,
      siteId: 'site-1',
    } as any)
    mockCreate.mockResolvedValue({
      id: 'pi_test_456',
      client_secret: 'pi_test_456_secret',
    })
    mockUpdate.mockResolvedValue({} as any)

    const res = await POST(
      makeRequest({
        reservationId: 'cm1234567890abcdefghijklmn',
        anonId: 'anon-123',
      })
    )
    expect(res.status).toBe(200)
  })
})
