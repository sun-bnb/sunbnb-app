import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/auth', () => ({
  auth: vi.fn().mockResolvedValue(null),
}))

import { GET } from './route'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import { NextRequest } from 'next/server'

const mockAuth = vi.mocked(auth)
const OWNER_ID = 'owner-1'
const SITE_ID = 'site-1'

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue(null)
})

function makeRequest(searchParams: string): NextRequest {
  return new NextRequest(`http://localhost/api/reservations/${SITE_ID}${searchParams}`)
}

describe('GET /api/reservations/[siteId]', () => {
  it('returns error when not authenticated', async () => {
    const request = makeRequest('?date=2025-07-01')
    const response = await GET(request, { params: { siteId: SITE_ID } })
    const data = await response.json()
    expect(data.status).toBe('error')
    expect(data.errors).toContain('Not authenticated')
  })

  // BUG-REVEALING: route.ts line 11 returns 200 instead of 401 for unauthenticated requests
  it('returns HTTP 401 status code when not authenticated', async () => {
    const request = makeRequest('?date=2025-07-01')
    const response = await GET(request, { params: { siteId: SITE_ID } })
    expect(response.status).toBe(401)
  })

  it('returns 403 when user does not own site', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'other-user' } } as any)
    vi.mocked(prisma.site.findUnique).mockResolvedValue({ userId: OWNER_ID } as any)

    const request = makeRequest('?date=2025-07-01')
    const response = await GET(request, { params: { siteId: SITE_ID } })
    expect(response.status).toBe(403)
  })

  it('returns empty object when no date or month param', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    vi.mocked(prisma.site.findUnique).mockResolvedValue({ userId: OWNER_ID } as any)

    const request = makeRequest('')
    const response = await GET(request, { params: { siteId: SITE_ID } })
    const data = await response.json()
    expect(data).toEqual({})
  })

  it('returns day reservations for date param', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    vi.mocked(prisma.site.findUnique).mockResolvedValue({ userId: OWNER_ID } as any)
    vi.mocked(prisma.reservation.findMany).mockResolvedValue([
      { id: 'res-1', items: [], user: { id: OWNER_ID, email: 'test@test.com' } },
    ] as any)

    const request = makeRequest('?date=2025-07-01')
    const response = await GET(request, { params: { siteId: SITE_ID } })
    const data = await response.json()
    expect(data.reservations).toHaveLength(1)
  })

  it('excludes canceled reservations from date query', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    vi.mocked(prisma.site.findUnique).mockResolvedValue({ userId: OWNER_ID } as any)
    vi.mocked(prisma.reservation.findMany).mockResolvedValue([] as any)

    const request = makeRequest('?date=2025-07-01')
    await GET(request, { params: { siteId: SITE_ID } })

    const findCall = vi.mocked(prisma.reservation.findMany).mock.calls[0][0]
    expect(findCall.where.status.not).toBe('canceled')
  })

  it('returns reservation counts for month param', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    vi.mocked(prisma.site.findUnique).mockResolvedValue({ userId: OWNER_ID } as any)
    vi.mocked(prisma.$queryRaw).mockResolvedValue([
      { day: new Date('2025-07-01'), count: 3 },
      { day: new Date('2025-07-15'), count: 7 },
    ] as any)

    const request = makeRequest('?month=2025-07')
    const response = await GET(request, { params: { siteId: SITE_ID } })
    const data = await response.json()
    expect(data.reservations).toHaveLength(2)
    expect(data.reservations[0].count).toBe(3)
  })
})
