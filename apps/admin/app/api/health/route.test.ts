import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/auth', () => ({
  auth: vi.fn().mockResolvedValue(null),
}))

import { GET } from './route'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'

const mockAuth = vi.mocked(auth)

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue(null)
})

describe('GET /api/health', () => {
  it('returns healthy status when DB is connected (unauthenticated)', async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ '?column?': 1 }])

    const response = await GET()
    const body = await response.json()

    expect(body.status).toBe('healthy')
    expect(body.timestamp).toBeDefined()
    // Non-sudo user should NOT get db or records details
    expect(body.db).toBeUndefined()
    expect(body.records).toBeUndefined()
  })

  it('returns degraded status when DB is unreachable', async () => {
    vi.mocked(prisma.$queryRaw).mockRejectedValue(new Error('Connection refused'))

    const response = await GET()
    const body = await response.json()

    expect(body.status).toBe('degraded')
  })

  it('returns full details for sudo user', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'admin-1' } } as any)
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ sudo: true } as any)
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ '?column?': 1 }])
    vi.mocked(prisma.site.count).mockResolvedValue(42)
    vi.mocked(prisma.user.count).mockResolvedValue(100)

    const response = await GET()
    const body = await response.json()

    expect(body.status).toBe('healthy')
    expect(body.db).toBeDefined()
    expect(body.db.status).toBe('connected')
    expect(body.records.sites).toBe(42)
    expect(body.records.users).toBe(100)
  })

  it('does not expose details to non-sudo authenticated user', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ sudo: false } as any)
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ '?column?': 1 }])

    const response = await GET()
    const body = await response.json()

    expect(body.status).toBe('healthy')
    expect(body.db).toBeUndefined()
    expect(body.records).toBeUndefined()
  })

  it('handles auth error gracefully', async () => {
    mockAuth.mockRejectedValue(new Error('Auth service down'))
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ '?column?': 1 }])

    const response = await GET()
    const body = await response.json()

    // Should still return health status even when auth fails
    expect(body.status).toBe('healthy')
    expect(body.db).toBeUndefined()
  })
})
