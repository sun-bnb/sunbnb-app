import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/auth', () => ({
  auth: vi.fn().mockResolvedValue(null),
}))

vi.hoisted(() => {
  process.env.CRON_SECRET = 'test-cron-secret'
})

import { GET } from './route'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'

const mockAuth = vi.mocked(auth)

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue(null)
})

describe('GET /api/reservations-cleanup', () => {
  it('allows access with valid CRON_SECRET', async () => {
    vi.mocked(prisma.reservation.deleteMany).mockResolvedValue({ count: 3 } as any)

    const request = new Request('http://localhost/api/reservations-cleanup', {
      headers: { authorization: 'Bearer test-cron-secret' },
    })

    const response = await GET(request)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.deleted).toBe(3)
  })

  it('allows access with authenticated session (no cron header)', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    vi.mocked(prisma.reservation.deleteMany).mockResolvedValue({ count: 0 } as any)

    const request = new Request('http://localhost/api/reservations-cleanup')
    const response = await GET(request)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.deleted).toBe(0)
  })

  it('returns 401 with no auth and no cron secret', async () => {
    const request = new Request('http://localhost/api/reservations-cleanup')
    const response = await GET(request)

    expect(response.status).toBe(401)
    const data = await response.json()
    expect(data.error).toBe('Unauthorized')
  })

  it('rejects wrong cron secret', async () => {
    const request = new Request('http://localhost/api/reservations-cleanup', {
      headers: { authorization: 'Bearer wrong-secret' },
    })

    const response = await GET(request)
    expect(response.status).toBe(401)
  })

  it('deletes stale reservations with correct status filters', async () => {
    vi.mocked(prisma.reservation.deleteMany).mockResolvedValue({ count: 5 } as any)

    const request = new Request('http://localhost/api/reservations-cleanup', {
      headers: { authorization: 'Bearer test-cron-secret' },
    })

    await GET(request)

    const deleteCall = vi.mocked(prisma.reservation.deleteMany).mock.calls[0][0]
    const orConditions = deleteCall.where.OR

    // Should have 3 conditions: pending/processing, payment_failed, paid-in-cash
    expect(orConditions).toHaveLength(3)

    // First condition: pending + processing
    expect(orConditions[0].status.in).toContain('pending')
    expect(orConditions[0].status.in).toContain('processing')

    // Second condition: payment_failed
    expect(orConditions[1].status).toBe('payment_failed')

    // Third condition: paid-in-cash
    expect(orConditions[2].status.in).toContain('paid-in-cash')
  })
})
