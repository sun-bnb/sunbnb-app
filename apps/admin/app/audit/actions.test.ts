import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/auth', () => ({
  auth: vi.fn().mockResolvedValue(null),
}))

import { listImpersonationAudit } from './actions'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'

const mockAuth = vi.mocked(auth)

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue(null)
})

function authenticateAsSudo() {
  mockAuth.mockResolvedValue({ user: { id: 'admin-1' } } as any)
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ sudo: true } as any)
}

function authenticateAsNonSudo() {
  mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ sudo: false } as any)
}

describe('listImpersonationAudit', () => {
  it('rejects unauthenticated callers', async () => {
    await expect(listImpersonationAudit()).rejects.toThrow('Not authenticated')
  })

  it('rejects non-sudo callers', async () => {
    authenticateAsNonSudo()
    await expect(listImpersonationAudit()).rejects.toThrow('sudo required')
  })

  it('returns empty page with total=0 when there is no activity', async () => {
    authenticateAsSudo()
    vi.mocked(prisma.impersonationLog.count).mockResolvedValue(0)
    vi.mocked(prisma.impersonationLog.findMany).mockResolvedValue([] as any)
    vi.mocked(prisma.user.findMany).mockResolvedValue([] as any)

    const res = await listImpersonationAudit(1)
    expect(res).toEqual({ logs: [], total: 0, page: 1, pageSize: 50 })
  })

  it('joins admin and target emails via a single batch user query', async () => {
    authenticateAsSudo()
    vi.mocked(prisma.impersonationLog.count).mockResolvedValue(1)
    const startedAt = new Date('2026-05-13T10:00:00Z')
    const endedAt = new Date('2026-05-13T10:05:30Z')
    vi.mocked(prisma.impersonationLog.findMany).mockResolvedValue([
      {
        id: 'log-1',
        adminId: 'admin-1',
        targetUserId: 'target-1',
        tokenId: 'jti-1',
        app: 'partner',
        startedAt,
        endedAt,
        ip: '1.2.3.4',
        userAgent: 'Vitest',
      },
    ] as any)
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      { id: 'admin-1', email: 'admin@example.com' },
      { id: 'target-1', email: 'target@example.com' },
    ] as any)

    const res = await listImpersonationAudit(1)

    expect(res.logs).toHaveLength(1)
    expect(res.logs[0]).toMatchObject({
      adminEmail: 'admin@example.com',
      targetEmail: 'target@example.com',
      durationSeconds: 330,
      app: 'partner',
    })
    // Single batch user lookup, not one per row
    expect(vi.mocked(prisma.user.findMany)).toHaveBeenCalledTimes(1)
    const userCall = vi.mocked(prisma.user.findMany).mock.calls[0][0]
    expect(userCall.where.id.in.sort()).toEqual(['admin-1', 'target-1'])
  })

  it('reports durationSeconds=null for active sessions (endedAt null)', async () => {
    authenticateAsSudo()
    vi.mocked(prisma.impersonationLog.count).mockResolvedValue(1)
    vi.mocked(prisma.impersonationLog.findMany).mockResolvedValue([
      {
        id: 'log-1',
        adminId: 'admin-1',
        targetUserId: 'target-1',
        tokenId: 'jti-1',
        app: 'user',
        startedAt: new Date(),
        endedAt: null,
        ip: null,
        userAgent: null,
      },
    ] as any)
    vi.mocked(prisma.user.findMany).mockResolvedValue([] as any)

    const res = await listImpersonationAudit(1)
    expect(res.logs[0]?.durationSeconds).toBeNull()
    expect(res.logs[0]?.endedAt).toBeNull()
  })

  it('applies targetUserId filter', async () => {
    authenticateAsSudo()
    vi.mocked(prisma.impersonationLog.count).mockResolvedValue(0)
    vi.mocked(prisma.impersonationLog.findMany).mockResolvedValue([] as any)
    vi.mocked(prisma.user.findMany).mockResolvedValue([] as any)

    await listImpersonationAudit(1, { targetUserId: 'target-7' })

    const countCall = vi.mocked(prisma.impersonationLog.count).mock.calls[0][0]
    expect(countCall.where).toEqual({ targetUserId: 'target-7' })
    const findCall = vi.mocked(prisma.impersonationLog.findMany).mock.calls[0][0]
    expect(findCall.where).toEqual({ targetUserId: 'target-7' })
  })

  it('orders by startedAt desc and paginates correctly', async () => {
    authenticateAsSudo()
    vi.mocked(prisma.impersonationLog.count).mockResolvedValue(120)
    vi.mocked(prisma.impersonationLog.findMany).mockResolvedValue([] as any)
    vi.mocked(prisma.user.findMany).mockResolvedValue([] as any)

    await listImpersonationAudit(3)

    const findCall = vi.mocked(prisma.impersonationLog.findMany).mock.calls[0][0]
    expect(findCall.orderBy).toEqual({ startedAt: 'desc' })
    expect(findCall.skip).toBe(100) // (3-1) * 50
    expect(findCall.take).toBe(50)
  })

  it('clamps non-positive pages to 1', async () => {
    authenticateAsSudo()
    vi.mocked(prisma.impersonationLog.count).mockResolvedValue(5)
    vi.mocked(prisma.impersonationLog.findMany).mockResolvedValue([] as any)
    vi.mocked(prisma.user.findMany).mockResolvedValue([] as any)

    const res = await listImpersonationAudit(0)
    expect(res.page).toBe(1)
    const findCall = vi.mocked(prisma.impersonationLog.findMany).mock.calls[0][0]
    expect(findCall.skip).toBe(0)
  })
})
