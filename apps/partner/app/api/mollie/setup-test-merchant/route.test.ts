/**
 * Tests for POST /api/mollie/setup-test-merchant
 *
 * Covers: auth gate, no Mollie account, scope isolation, happy path.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/auth', () => ({
  auth: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/app/api/_lib/mollie', () => ({
  bootstrapMollieAccount: vi.fn(),
}))

import { POST } from './route'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import { bootstrapMollieAccount } from '@/app/api/_lib/mollie'

const mockAuth = vi.mocked(auth)
const mockBootstrap = vi.mocked(bootstrapMollieAccount)
const mockAccountFindUnique = vi.mocked(prisma.partnerAccount.findUnique)

const USER_ID = 'user-1'

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue(null)
  mockBootstrap.mockResolvedValue({
    onboardingStatus: 'completed',
    onboardingSubmitted: true,
    profileId: 'pfl_test',
    profileResolved: true,
    methods: { creditcard: 'enabled', ideal: 'enabled' },
  })
})

describe('POST /api/mollie/setup-test-merchant', () => {
  // ── Auth gate ────────────────────────────────────────────────────────────────

  it('returns 401 when not authenticated — does not call bootstrapMollieAccount', async () => {
    const response = await POST()
    expect(response.status).toBe(401)
    const data = await response.json()
    expect(data.error).toBe('Not authenticated')
    expect(mockBootstrap).not.toHaveBeenCalled()
  })

  // ── No Mollie account ─────────────────────────────────────────────────────────

  it('returns 400 when partner has no Mollie access token', async () => {
    mockAuth.mockResolvedValue({ user: { id: USER_ID } } as any)
    mockAccountFindUnique.mockResolvedValue({
      mollieAccessToken: null,
      mollieProfileId: null,
    } as any)

    const response = await POST()
    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toContain('No Mollie account connected')
    expect(mockBootstrap).not.toHaveBeenCalled()
  })

  // ── Scope isolation ───────────────────────────────────────────────────────────

  it('scopes the partnerAccount query to session.user.id', async () => {
    mockAuth.mockResolvedValue({ user: { id: USER_ID } } as any)
    mockAccountFindUnique.mockResolvedValue({ mollieAccessToken: null, mollieProfileId: null } as any)

    await POST()

    expect(mockAccountFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: USER_ID } }),
    )
  })

  // ── Happy path ────────────────────────────────────────────────────────────────

  it('calls bootstrapMollieAccount with the stored access token and session user', async () => {
    mockAuth.mockResolvedValue({ user: { id: USER_ID, email: 'partner@example.com' } } as any)
    mockAccountFindUnique.mockResolvedValue({
      mollieAccessToken: 'access_stored_token',
      mollieProfileId: 'pfl_existing',
    } as any)

    await POST()

    expect(mockBootstrap).toHaveBeenCalledWith(
      'access_stored_token',
      USER_ID,
      expect.objectContaining({
        email: 'partner@example.com',
        profileId: 'pfl_existing',
      }),
    )
  })

  it('returns 200 with message and bootstrap results', async () => {
    mockAuth.mockResolvedValue({ user: { id: USER_ID, email: 'p@example.com' } } as any)
    mockAccountFindUnique.mockResolvedValue({
      mollieAccessToken: 'access_stored_token',
      mollieProfileId: null,
    } as any)

    const response = await POST()
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.message).toBe('Test merchant setup complete')
    expect(data.results).toBeDefined()
    expect(data.results.onboardingStatus).toBe('completed')
    expect(data.results.methods.creditcard).toBe('enabled')
  })

  it('passes null profileId when no profile is stored (bootstrap will resolve it)', async () => {
    mockAuth.mockResolvedValue({ user: { id: USER_ID, email: 'p@example.com' } } as any)
    mockAccountFindUnique.mockResolvedValue({
      mollieAccessToken: 'access_token',
      mollieProfileId: null,
    } as any)

    await POST()

    expect(mockBootstrap).toHaveBeenCalledWith(
      'access_token',
      USER_ID,
      expect.objectContaining({ profileId: null }),
    )
  })
})
