import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock auth before any imports that transitively use it.
vi.mock('@/app/auth', () => ({
  auth: vi.fn().mockResolvedValue(null),
}))

import { getTokens, getOwnedSites, createToken, deleteToken } from './actions'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'

const mockAuth = vi.mocked(auth)

const OWNER_ID = 'user-owner-1'
const OTHER_USER_ID = 'user-other-2'
const TOKEN_ID = 'token-abc-123'

beforeEach(() => {
  vi.clearAllMocks()
  // Always reset to null — clearAllMocks clears call history but not
  // implementations; auth leaks between tests if not reset here.
  mockAuth.mockResolvedValue(null)
})

// ─── getTokens ──────────────────────────────────────────────────────────────

describe('getTokens', () => {
  it('throws when unauthenticated', async () => {
    // No session set — auth returns null.
    await expect(getTokens()).rejects.toThrow('Not authenticated')
    expect(vi.mocked(prisma.securityToken.findMany)).not.toHaveBeenCalled()
  })

  it('returns only tokens belonging to the session user', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)

    const ownToken = { id: TOKEN_ID, userId: OWNER_ID, resources: ['all'] }
    vi.mocked(prisma.securityToken.findMany).mockResolvedValue([ownToken] as any)

    const result = await getTokens()

    // Must filter by the session userId — assert the where clause
    expect(vi.mocked(prisma.securityToken.findMany)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: OWNER_ID }),
      })
    )
    expect(result).toEqual([ownToken])
  })

  it('does NOT pass OTHER_USER_ID in the query', async () => {
    // A different user's session must query with their own id, not a hardcoded one.
    mockAuth.mockResolvedValue({ user: { id: OTHER_USER_ID } } as any)
    vi.mocked(prisma.securityToken.findMany).mockResolvedValue([] as any)

    await getTokens()

    const callArgs = vi.mocked(prisma.securityToken.findMany).mock.calls[0]![0] as any
    expect(callArgs.where.userId).toBe(OTHER_USER_ID)
    expect(callArgs.where.userId).not.toBe(OWNER_ID)
  })

  it('returns tokens ordered newest-first', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    vi.mocked(prisma.securityToken.findMany).mockResolvedValue([] as any)

    await getTokens()

    const callArgs = vi.mocked(prisma.securityToken.findMany).mock.calls[0]![0] as any
    expect(callArgs.orderBy).toEqual({ createdAt: 'desc' })
  })
})

// ─── getOwnedSites ──────────────────────────────────────────────────────────

describe('getOwnedSites', () => {
  it('throws when unauthenticated', async () => {
    await expect(getOwnedSites()).rejects.toThrow('Not authenticated')
    expect(vi.mocked(prisma.site.findMany)).not.toHaveBeenCalled()
  })

  it('returns only sites belonging to the session user', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)

    const ownSite = { id: 'site-1', name: 'Beach Club' }
    vi.mocked(prisma.site.findMany).mockResolvedValue([ownSite] as any)

    const result = await getOwnedSites()

    expect(vi.mocked(prisma.site.findMany)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: OWNER_ID }),
      })
    )
    expect(result).toEqual([ownSite])
  })

  it('selects only id and name fields', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    vi.mocked(prisma.site.findMany).mockResolvedValue([] as any)

    await getOwnedSites()

    const callArgs = vi.mocked(prisma.site.findMany).mock.calls[0]![0] as any
    expect(callArgs.select).toEqual({ id: true, name: true })
  })

  it('returns sites ordered alphabetically by name', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    vi.mocked(prisma.site.findMany).mockResolvedValue([] as any)

    await getOwnedSites()

    const callArgs = vi.mocked(prisma.site.findMany).mock.calls[0]![0] as any
    expect(callArgs.orderBy).toEqual({ name: 'asc' })
  })
})

// ─── createToken ────────────────────────────────────────────────────────────

describe('createToken', () => {
  it('throws when unauthenticated', async () => {
    await expect(createToken()).rejects.toThrow('Not authenticated')
    expect(vi.mocked(prisma.securityToken.create)).not.toHaveBeenCalled()
  })

  it('creates a token scoped to the session user', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    vi.mocked(prisma.securityToken.create).mockResolvedValue({
      id: TOKEN_ID,
      userId: OWNER_ID,
      resources: ['all'],
    } as any)

    await createToken()

    const callArgs = vi.mocked(prisma.securityToken.create).mock.calls[0]![0] as any
    expect(callArgs.data.userId).toBe(OWNER_ID)
  })

  it('assigns resources: ["all"] — not narrower scope and not empty', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    vi.mocked(prisma.securityToken.create).mockResolvedValue({
      id: TOKEN_ID,
      userId: OWNER_ID,
      resources: ['all'],
    } as any)

    await createToken()

    const callArgs = vi.mocked(prisma.securityToken.create).mock.calls[0]![0] as any
    // The Security page creates tokens with the 'all' role (comment in source says so).
    // 'all' grants access to both manage and orders gates; assert this intent is preserved.
    expect(callArgs.data.resources).toEqual(['all'])
  })

  it('assigns an expiry approximately one year from now', async () => {
    const beforeCall = new Date()
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    vi.mocked(prisma.securityToken.create).mockResolvedValue({
      id: TOKEN_ID,
      userId: OWNER_ID,
      resources: ['all'],
    } as any)

    await createToken()

    const afterCall = new Date()
    const callArgs = vi.mocked(prisma.securityToken.create).mock.calls[0]![0] as any
    const expires: Date = callArgs.data.expires

    expect(expires).toBeInstanceOf(Date)

    // The expiry should be ~365 days from now; allow a 2-second window to account
    // for test execution time. Never eternal (no expiry is a security bug).
    const oneYearMs = 365 * 24 * 60 * 60 * 1000
    const toleranceMs = 2000

    expect(expires.getTime()).toBeGreaterThanOrEqual(beforeCall.getTime() + oneYearMs - toleranceMs)
    expect(expires.getTime()).toBeLessThanOrEqual(afterCall.getTime() + oneYearMs + toleranceMs)
  })

  it('returns { status: "ok", token: id } on success', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    vi.mocked(prisma.securityToken.create).mockResolvedValue({
      id: TOKEN_ID,
      userId: OWNER_ID,
      resources: ['all'],
    } as any)

    const result = await createToken()

    expect(result.status).toBe('ok')
    expect((result as any).token).toBe(TOKEN_ID)
  })
})

// ─── deleteToken ────────────────────────────────────────────────────────────

describe('deleteToken', () => {
  it('throws when unauthenticated', async () => {
    await expect(deleteToken(TOKEN_ID)).rejects.toThrow('Not authenticated')
    expect(vi.mocked(prisma.securityToken.delete)).not.toHaveBeenCalled()
  })

  // CRITICAL ownership test: deleteToken must include userId in the where clause
  // so that Partner A cannot delete Partner B's accessKey.
  //
  // Implementation check: the code uses:
  //   prisma.securityToken.delete({ where: { id, userId: session.user.id } })
  //
  // This is a compound where — Prisma will only delete the record if BOTH id AND
  // userId match. If the token belongs to another user, Prisma throws P2025
  // (record not found) rather than silently deleting it.
  //
  // The test asserts the compound where clause is present. If someone refactors
  // to `where: { id }` only (removing userId), this test turns RED — correctly
  // surfacing the ownership hole.
  it('scopes the delete to the session user — compound where {id, userId}', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    vi.mocked(prisma.securityToken.delete).mockResolvedValue({} as any)

    await deleteToken(TOKEN_ID)

    expect(vi.mocked(prisma.securityToken.delete)).toHaveBeenCalledWith({
      where: {
        id: TOKEN_ID,
        userId: OWNER_ID,
      },
    })
  })

  it('does NOT delete using id alone — userId must be in the where clause', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    vi.mocked(prisma.securityToken.delete).mockResolvedValue({} as any)

    await deleteToken(TOKEN_ID)

    const whereArg = vi.mocked(prisma.securityToken.delete).mock.calls[0]![0].where as any
    // This is the key ownership assertion: userId must constrain the delete.
    // Without it, any authenticated partner could revoke any other partner's token.
    expect(whereArg.userId).toBe(OWNER_ID)
    expect(whereArg.userId).not.toBeUndefined()
  })

  // Cross-user scenario: Partner B tries to delete Partner A's token.
  // In the real DB, Prisma throws P2025 because the record with {id, userId: B}
  // doesn't exist. In unit tests, vi.fn() returns undefined by default — we can't
  // replicate the DB throw without a real DB. Instead we assert the WHERE clause
  // includes the session user's id (not the token owner's id), which is the
  // mechanism that causes the DB rejection.
  it('uses the SESSION user id in where (not a hardcoded or client-supplied id)', async () => {
    // Partner B is authenticated
    mockAuth.mockResolvedValue({ user: { id: OTHER_USER_ID } } as any)
    vi.mocked(prisma.securityToken.delete).mockResolvedValue({} as any)

    // Partner B tries to delete a token (which in reality belongs to Partner A)
    await deleteToken(TOKEN_ID)

    const whereArg = vi.mocked(prisma.securityToken.delete).mock.calls[0]![0].where as any
    // The where clause must use OTHER_USER_ID (Partner B's id), not OWNER_ID.
    // This means the real DB will reject the delete because {id: TOKEN_ID, userId: OTHER_USER_ID}
    // won't match a token owned by OWNER_ID — the ownership guard is in place.
    expect(whereArg.userId).toBe(OTHER_USER_ID)
    expect(whereArg.userId).not.toBe(OWNER_ID)
  })

  it('returns { status: "ok" } on success', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    vi.mocked(prisma.securityToken.delete).mockResolvedValue({} as any)

    const result = await deleteToken(TOKEN_ID)

    expect(result).toEqual({ status: 'ok' })
  })
})
