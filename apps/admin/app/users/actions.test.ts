import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/auth', () => ({
  auth: vi.fn().mockResolvedValue(null),
}))

import {
  getAdminUsers,
  addAdminUser,
  removeAdminUser,
  searchUsers,
  deleteUser,
} from './actions'
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

// ─── Auth guard: requireSudo ────────────────────────────────────────────────

describe('requireSudo guard', () => {
  it('throws when not authenticated (getAdminUsers)', async () => {
    // requireSudo throws — caller gets an unhandled throw, not { status: 'error' }
    await expect(getAdminUsers()).rejects.toThrow('Not authenticated')
  })

  it('throws when user is not sudo (getAdminUsers)', async () => {
    authenticateAsNonSudo()
    await expect(getAdminUsers()).rejects.toThrow('sudo required')
  })

  it('throws when user record not found', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'ghost' } } as any)
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null) // user deleted
    await expect(getAdminUsers()).rejects.toThrow('sudo required')
  })
})

// ─── addAdminUser ───────────────────────────────────────────────────────────

describe('addAdminUser', () => {
  it('adds admin user with normalized email', async () => {
    authenticateAsSudo()
    vi.mocked(prisma.adminUser.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.adminUser.create).mockResolvedValue({ id: 'au-1', email: 'test@example.com' } as any)

    const res = await addAdminUser('  Test@Example.COM  ')
    expect(res.status).toBe('ok')
    expect(vi.mocked(prisma.adminUser.create).mock.calls[0][0].data.email).toBe('test@example.com')
  })

  it('rejects duplicate email', async () => {
    authenticateAsSudo()
    vi.mocked(prisma.adminUser.findUnique).mockResolvedValue({ id: 'existing' } as any)

    const res = await addAdminUser('existing@test.com')
    expect(res.status).toBe('error')
    expect((res as any).errors[0]).toContain('already in the admin list')
  })

  it('rejects empty email', async () => {
    authenticateAsSudo()
    const res = await addAdminUser('')
    expect(res.status).toBe('error')
  })

  it('rejects email without @', async () => {
    authenticateAsSudo()
    const res = await addAdminUser('not-an-email')
    expect(res.status).toBe('error')
  })

  // BUG: the validation only checks for '@' — emails without a TLD should be rejected
  it('rejects "a@b" — email must have a valid domain with TLD', async () => {
    authenticateAsSudo()
    const res = await addAdminUser('a@b')
    expect(res.status).toBe('error')
  })

  // BUG: addAdminUser returns { status, error } (singular), not { status, errors } (plural)
  // Should use { errors: string[] } to match the codebase pattern
  it('returns errors array (plural) consistent with codebase pattern', async () => {
    authenticateAsSudo()
    const res = await addAdminUser('')
    expect(res).toHaveProperty('errors')
    expect(res).not.toHaveProperty('error')
  })
})

// ─── removeAdminUser ────────────────────────────────────────────────────────

describe('removeAdminUser', () => {
  it('deletes admin user', async () => {
    authenticateAsSudo()
    vi.mocked(prisma.adminUser.delete).mockResolvedValue({} as any)
    const res = await removeAdminUser('au-1')
    expect(res.status).toBe('ok')
    expect(vi.mocked(prisma.adminUser.delete)).toHaveBeenCalledWith({ where: { id: 'au-1' } })
  })

  // BUG: no check that the admin user being removed isn't the caller's own entry
  // An admin could lock themselves out of the admin panel
  it('prevents removing your own admin access', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'admin-1' } } as any)
    vi.mocked(prisma.user.findUnique)
      .mockResolvedValueOnce({ sudo: true } as any)                // requireSudo
      .mockResolvedValueOnce({ email: 'admin@test.com' } as any)   // self-check
    vi.mocked(prisma.adminUser.findUnique).mockResolvedValue({ id: 'au-self', email: 'admin@test.com' } as any)
    const res = await removeAdminUser('au-self')
    expect(res.status).toBe('error')
  })
})

// ─── searchUsers ────────────────────────────────────────────────────────────

describe('searchUsers', () => {
  it('returns empty for blank query', async () => {
    authenticateAsSudo()
    const res = await searchUsers('')
    expect(res).toEqual([])
    expect(vi.mocked(prisma.user.findMany)).not.toHaveBeenCalled()
  })

  it('returns empty for whitespace-only query', async () => {
    authenticateAsSudo()
    const res = await searchUsers('   ')
    expect(res).toEqual([])
  })

  it('searches by email and name', async () => {
    authenticateAsSudo()
    vi.mocked(prisma.user.findMany).mockResolvedValue([{ id: 'u-1', email: 'john@test.com' }] as any)

    const res = await searchUsers('john')
    expect(res).toHaveLength(1)

    const findCall = vi.mocked(prisma.user.findMany).mock.calls[0][0]
    expect(findCall.where.OR).toHaveLength(2)
    expect(findCall.take).toBe(20)
  })
})

// ─── deleteUser ─────────────────────────────────────────────────────────────

describe('deleteUser', () => {
  it('prevents deleting sudo users', async () => {
    authenticateAsSudo()
    // First findUnique is in requireSudo, second is target user details (now includes sudo)
    vi.mocked(prisma.user.findUnique)
      .mockResolvedValueOnce({ sudo: true } as any) // requireSudo check — caller is sudo
      .mockResolvedValueOnce({ // target user details (now includes sudo field)
        id: 'target',
        email: 'target@test.com',
        sudo: true,
        partnerAccount: null,
        sites: [],
        accounts: [],
      } as any)

    const res = await deleteUser('target')
    expect(res.status).toBe('error')
    expect((res as any).errors[0]).toContain('sudo user')
  })

  it('returns error when user not found', async () => {
    authenticateAsSudo()
    vi.mocked(prisma.user.findUnique)
      .mockResolvedValueOnce({ sudo: true } as any) // requireSudo
      .mockResolvedValueOnce(null) // user not found

    const res = await deleteUser('nonexistent')
    expect(res.status).toBe('error')
    expect((res as any).errors[0]).toContain('User not found')
  })

  it('deletes user with related data cleanup', async () => {
    authenticateAsSudo()
    vi.mocked(prisma.user.findUnique)
      .mockResolvedValueOnce({ sudo: true } as any) // requireSudo
      .mockResolvedValueOnce({ // target user (includes sudo field)
        id: 'target',
        email: 'target@test.com',
        sudo: false,
        partnerAccount: { userId: 'target' },
        sites: [{ id: 'site-1' }, { id: 'site-2' }],
        accounts: [],
      } as any)

    vi.mocked(prisma.settlement.deleteMany).mockResolvedValue({ count: 0 } as any)
    vi.mocked(prisma.securityToken.deleteMany).mockResolvedValue({ count: 0 } as any)
    vi.mocked(prisma.user.delete).mockResolvedValue({} as any)

    const res = await deleteUser('target')
    expect(res.status).toBe('ok')
    expect((res as any).email).toBe('target@test.com')

    // Verify settlements cleaned up for both accountId and siteIds
    expect(vi.mocked(prisma.settlement.deleteMany)).toHaveBeenCalledTimes(2)
    expect(vi.mocked(prisma.settlement.deleteMany)).toHaveBeenCalledWith({
      where: { accountId: 'target' },
    })
    expect(vi.mocked(prisma.settlement.deleteMany)).toHaveBeenCalledWith({
      where: { siteId: { in: ['site-1', 'site-2'] } },
    })

    // Verify security tokens cleaned up
    expect(vi.mocked(prisma.securityToken.deleteMany)).toHaveBeenCalledWith({
      where: { userId: 'target' },
    })
  })

  it('skips settlement cleanup when user has no partner account', async () => {
    authenticateAsSudo()
    vi.mocked(prisma.user.findUnique)
      .mockResolvedValueOnce({ sudo: true } as any) // requireSudo
      .mockResolvedValueOnce({
        id: 'target',
        email: 'target@test.com',
        sudo: false,
        partnerAccount: null,
        sites: [],
        accounts: [],
      } as any)

    vi.mocked(prisma.securityToken.deleteMany).mockResolvedValue({ count: 0 } as any)
    vi.mocked(prisma.user.delete).mockResolvedValue({} as any)

    await deleteUser('target')
    // Should NOT call settlement.deleteMany for accountId
    expect(vi.mocked(prisma.settlement.deleteMany)).not.toHaveBeenCalled()
  })

  // BUG: deleteUser uses singular 'error' not 'errors' — should use errors[] for consistency
  it('returns errors array (plural) consistent with codebase pattern', async () => {
    authenticateAsSudo()
    vi.mocked(prisma.user.findUnique)
      .mockResolvedValueOnce({ sudo: true } as any)
      .mockResolvedValueOnce(null)

    const res = await deleteUser('x')
    expect(res).toHaveProperty('errors')
    expect(res).not.toHaveProperty('error')
  })

  // BUG: deleteUser makes two separate findUnique calls for the same user
  // (one for fields, one for sudo check) — should be combined into one query
  it('should combine user details and sudo check into one query (2 calls, not 3)', async () => {
    authenticateAsSudo()
    vi.mocked(prisma.user.findUnique)
      .mockResolvedValueOnce({ sudo: true } as any) // requireSudo
      .mockResolvedValueOnce({ // target user details — should include sudo field
        id: 'target',
        email: 'target@test.com',
        sudo: false,
        partnerAccount: null,
        sites: [],
        accounts: [],
      } as any)

    vi.mocked(prisma.securityToken.deleteMany).mockResolvedValue({ count: 0 } as any)
    vi.mocked(prisma.user.delete).mockResolvedValue({} as any)

    await deleteUser('target')

    // findUnique should be called 2 times: requireSudo + combined user details with sudo
    expect(vi.mocked(prisma.user.findUnique)).toHaveBeenCalledTimes(2)
  })
})
