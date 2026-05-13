import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/auth', () => ({
  auth: vi.fn().mockResolvedValue(null),
}))

vi.mock('@repo/data/impersonation', () => ({
  createImpersonationToken: vi.fn(),
}))

import {
  getAdminUsers,
  addAdminUser,
  removeAdminUser,
  searchUsers,
  deleteUser,
  listUsers,
  startImpersonation,
} from './actions'
import { LIST_USERS_PAGE_SIZE } from './constants'
import { createImpersonationToken } from '@repo/data/impersonation'

const mockCreateToken = vi.mocked(createImpersonationToken)
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
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      {
        id: 'u-1',
        name: null,
        email: 'john@test.com',
        createdAt: new Date(),
        partnerAccount: null,
        _count: { reservations: 0, orders: 0, sites: 0 },
      },
    ] as any)

    const res = await searchUsers('john')
    expect(res).toHaveLength(1)

    const findCall = vi.mocked(prisma.user.findMany).mock.calls[0][0]
    expect(findCall.where.OR).toHaveLength(2)
    expect(findCall.take).toBe(20)
  })
})

// ─── listUsers ──────────────────────────────────────────────────────────────

describe('listUsers', () => {
  it('rejects non-sudo users', async () => {
    authenticateAsNonSudo()
    await expect(listUsers(1)).rejects.toThrow('sudo required')
  })

  it('returns first page with total and pageSize', async () => {
    authenticateAsSudo()
    vi.mocked(prisma.user.count).mockResolvedValue(42)
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      {
        id: 'u-1',
        name: null,
        email: 'a@test.com',
        createdAt: new Date(),
        partnerAccount: null,
        _count: { reservations: 0, orders: 0, sites: 0 },
      },
      {
        id: 'u-2',
        name: null,
        email: 'b@test.com',
        createdAt: new Date(),
        partnerAccount: null,
        _count: { reservations: 0, orders: 0, sites: 0 },
      },
    ] as any)

    const res = await listUsers(1)
    expect(res.total).toBe(42)
    expect(res.page).toBe(1)
    expect(res.pageSize).toBe(LIST_USERS_PAGE_SIZE)
    expect(res.users).toHaveLength(2)

    const call = vi.mocked(prisma.user.findMany).mock.calls[0][0]
    expect(call.skip).toBe(0)
    expect(call.take).toBe(20)
    expect(call.orderBy).toEqual({ createdAt: 'desc' })
  })

  it('skips correctly for page 3 (page-1 * pageSize)', async () => {
    authenticateAsSudo()
    vi.mocked(prisma.user.count).mockResolvedValue(100)
    vi.mocked(prisma.user.findMany).mockResolvedValue([] as any)

    await listUsers(3)
    const call = vi.mocked(prisma.user.findMany).mock.calls[0][0]
    expect(call.skip).toBe(40)
    expect(call.take).toBe(20)
  })

  it('clamps non-positive pages to 1', async () => {
    authenticateAsSudo()
    vi.mocked(prisma.user.count).mockResolvedValue(5)
    vi.mocked(prisma.user.findMany).mockResolvedValue([] as any)

    const res = await listUsers(0)
    expect(res.page).toBe(1)
    expect(vi.mocked(prisma.user.findMany).mock.calls[0][0].skip).toBe(0)
  })

  it('defaults to page 1 when called with no argument', async () => {
    authenticateAsSudo()
    vi.mocked(prisma.user.count).mockResolvedValue(5)
    vi.mocked(prisma.user.findMany).mockResolvedValue([] as any)

    const res = await listUsers()
    expect(res.page).toBe(1)
  })

  it('returns the _count select shape (sites, reservations, orders)', async () => {
    authenticateAsSudo()
    vi.mocked(prisma.user.count).mockResolvedValue(1)
    vi.mocked(prisma.user.findMany).mockResolvedValue([] as any)

    await listUsers(1)
    const call = vi.mocked(prisma.user.findMany).mock.calls[0][0]
    expect(call.select._count.select).toEqual({
      reservations: true,
      orders: true,
      sites: true,
    })
    expect(call.select.partnerAccount).toEqual({ select: { userId: true } })
  })
})

// ─── appRole derivation ─────────────────────────────────────────────────────

describe('appRole derivation (via listUsers)', () => {
  function rowWith(opts: {
    partner: boolean
    sites?: number
    reservations?: number
    orders?: number
  }) {
    return {
      id: `u-${Math.random()}`,
      name: null,
      email: 't@test.com',
      createdAt: new Date(),
      partnerAccount: opts.partner ? { userId: 'p-1' } : null,
      _count: {
        sites: opts.sites ?? 0,
        reservations: opts.reservations ?? 0,
        orders: opts.orders ?? 0,
      },
    }
  }

  async function runListAndGet(role: 'partner' | 'user' | 'both' | 'none', row: any) {
    authenticateAsSudo()
    vi.mocked(prisma.user.count).mockResolvedValue(1)
    vi.mocked(prisma.user.findMany).mockResolvedValue([row] as any)
    const res = await listUsers(1)
    expect(res.users[0]?.appRole).toBe(role)
  }

  it('classifies as "partner" when only partnerAccount is present', async () => {
    await runListAndGet('partner', rowWith({ partner: true }))
  })

  it('classifies as "user" when only reservations exist', async () => {
    await runListAndGet('user', rowWith({ partner: false, reservations: 3 }))
  })

  it('classifies as "user" when only orders exist', async () => {
    await runListAndGet('user', rowWith({ partner: false, orders: 1 }))
  })

  it('classifies as "both" when partnerAccount AND consumer activity exist', async () => {
    await runListAndGet('both', rowWith({ partner: true, reservations: 2 }))
  })

  it('classifies as "none" when no partner account and no consumer activity', async () => {
    await runListAndGet('none', rowWith({ partner: false }))
  })

  it('classifies as "partner" defensively when sites > 0 even without partnerAccount row', async () => {
    await runListAndGet('partner', rowWith({ partner: false, sites: 1 }))
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

// ─── startImpersonation ─────────────────────────────────────────────────────

describe('startImpersonation', () => {
  function mockTarget(opts: {
    id?: string
    sudo?: boolean
    partner?: boolean
    sites?: number
    reservations?: number
    orders?: number
  }) {
    vi.mocked(prisma.user.findUnique)
      .mockResolvedValueOnce({ sudo: true } as any) // requireSudo
      .mockResolvedValueOnce({
        id: opts.id ?? 'target',
        email: 't@test.com',
        sudo: opts.sudo ?? false,
        partnerAccount: opts.partner ? { userId: 't' } : null,
        _count: {
          sites: opts.sites ?? 0,
          reservations: opts.reservations ?? 0,
          orders: opts.orders ?? 0,
        },
      } as any)
  }

  beforeEach(() => {
    mockCreateToken.mockReset()
    mockCreateToken.mockReturnValue({
      token: 'signed.token',
      tokenId: 'jti-1',
      expiresAt: new Date(),
    })
  })

  it('rejects non-sudo callers (via requireSudo)', async () => {
    authenticateAsNonSudo()
    await expect(startImpersonation('target', 'partner')).rejects.toThrow(
      'sudo required',
    )
  })

  it('rejects invalid app values', async () => {
    authenticateAsSudo()
    const res = await startImpersonation('target', 'admin' as never)
    expect(res.status).toBe('error')
    expect((res as { errors: string[] }).errors[0]).toContain('Invalid app')
  })

  it('rejects missing target id', async () => {
    authenticateAsSudo()
    const res = await startImpersonation('', 'partner')
    expect(res.status).toBe('error')
  })

  it('rejects self-impersonation', async () => {
    authenticateAsSudo()
    // session.user.id is 'admin-1' from helper
    const res = await startImpersonation('admin-1', 'partner')
    expect(res.status).toBe('error')
    expect((res as { errors: string[] }).errors[0]).toMatch(/yourself/)
  })

  it('rejects when target user does not exist', async () => {
    authenticateAsSudo()
    // requireSudo's findUnique → sudo:true; the target lookup returns null
    vi.mocked(prisma.user.findUnique)
      .mockResolvedValueOnce({ sudo: true } as any)
      .mockResolvedValueOnce(null as any)
    const res = await startImpersonation('ghost', 'partner')
    expect(res.status).toBe('error')
    expect((res as { errors: string[] }).errors[0]).toMatch(/not found/i)
  })

  it('rejects impersonating a sudo target', async () => {
    authenticateAsSudo()
    mockTarget({ sudo: true, partner: true })
    const res = await startImpersonation('target', 'partner')
    expect(res.status).toBe('error')
    expect((res as { errors: string[] }).errors[0]).toMatch(/sudo/i)
  })

  it('rejects partner impersonation when target has no partner activity', async () => {
    authenticateAsSudo()
    mockTarget({ partner: false, reservations: 3 })
    const res = await startImpersonation('target', 'partner')
    expect(res.status).toBe('error')
    expect((res as { errors: string[] }).errors[0]).toMatch(/partner/i)
  })

  it('rejects user impersonation when target has no consumer activity', async () => {
    authenticateAsSudo()
    mockTarget({ partner: true })
    const res = await startImpersonation('target', 'user')
    expect(res.status).toBe('error')
    expect((res as { errors: string[] }).errors[0]).toMatch(/consumer/i)
  })

  it('allows partner impersonation when partnerAccount exists', async () => {
    authenticateAsSudo()
    mockTarget({ partner: true })
    const res = await startImpersonation('target', 'partner')
    expect(res.status).toBe('ok')
    expect((res as { url: string }).url).toMatch(/\/api\/auth\/impersonate\?token=signed\.token$/)
    expect(mockCreateToken).toHaveBeenCalledWith({
      adminId: 'admin-1',
      targetUserId: 'target',
      app: 'partner',
    })
  })

  it('allows user impersonation when reservations exist', async () => {
    authenticateAsSudo()
    mockTarget({ reservations: 1 })
    const res = await startImpersonation('target', 'user')
    expect(res.status).toBe('ok')
    expect((res as { url: string }).url).toContain('/api/auth/impersonate?token=')
  })

  it('uses PARTNER_APP_URL for partner and USER_APP_URL for user', async () => {
    authenticateAsSudo()
    mockTarget({ partner: true })
    const partnerRes = await startImpersonation('target', 'partner')
    expect((partnerRes as { url: string }).url.startsWith('https://local.sunbnb.app:3001')).toBe(true)

    mockTarget({ orders: 1 })
    const userRes = await startImpersonation('target', 'user')
    expect((userRes as { url: string }).url.startsWith('https://local.sunbnb.app:3002')).toBe(true)
  })
})
