import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/auth', () => ({
  auth: vi.fn().mockResolvedValue(null),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

// `@repo/data/mollie-tokens` imports prisma directly; mock the whole module so
// no DB connection is attempted under unit-test conditions.
vi.mock('@repo/data/mollie-tokens', () => ({
  getValidMollieToken: vi.fn(),
}))

// `@/app/api/_lib/mollie` makes real HTTP calls to Mollie; mock it entirely.
vi.mock('@/app/api/_lib/mollie', () => ({
  fetchMollieProfile: vi.fn(),
}))

import { disconnectMollie, refreshMollieTokens } from './actions'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import { getValidMollieToken } from '@repo/data/mollie-tokens'
import { fetchMollieProfile } from '@/app/api/_lib/mollie'
import { revalidatePath } from 'next/cache'

const mockAuth = vi.mocked(auth)
const mockGetValidMollieToken = vi.mocked(getValidMollieToken)
const mockFetchMollieProfile = vi.mocked(fetchMollieProfile)

const OWNER_ID = 'owner-1'
const OTHER_ID = 'other-partner'

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue(null)
})

// ─── disconnectMollie ────────────────────────────────────────────────────────

describe('disconnectMollie', () => {
  it('returns error when not authenticated', async () => {
    const result = await disconnectMollie()
    expect(result).toEqual({ status: 'error', message: 'Not authenticated' })
    expect(vi.mocked(prisma.partnerAccount.update)).not.toHaveBeenCalled()
  })

  it('clears all Mollie fields on the session user own account', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    vi.mocked(prisma.partnerAccount.update).mockResolvedValue({} as any)

    const result = await disconnectMollie()

    expect(result).toEqual({ status: 'ok' })
    expect(vi.mocked(prisma.partnerAccount.update)).toHaveBeenCalledWith({
      where: { userId: OWNER_ID },
      data: {
        mollieAccessToken: null,
        mollieRefreshToken: null,
        mollieProfileId: null,
        mollieOnboardingStatus: null,
      },
    })
  })

  /**
   * BUG-REVEALING: The where clause must use session.user.id.
   * No external id can redirect the disconnect to another partner's account.
   */
  it('scopes the update to session.user.id — cannot disconnect another partner', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    vi.mocked(prisma.partnerAccount.update).mockResolvedValue({} as any)

    await disconnectMollie()

    const [call] = vi.mocked(prisma.partnerAccount.update).mock.calls
    expect(call[0].where).toEqual({ userId: OWNER_ID })
    expect(call[0].where.userId).not.toBe(OTHER_ID)
  })

  it('revalidates /account/mollie path on success', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    vi.mocked(prisma.partnerAccount.update).mockResolvedValue({} as any)

    await disconnectMollie()

    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith('/account/mollie')
  })
})

// ─── refreshMollieTokens ─────────────────────────────────────────────────────

describe('refreshMollieTokens', () => {
  it('returns error when not authenticated', async () => {
    const result = await refreshMollieTokens()
    expect(result).toEqual({ status: 'error', message: 'Not authenticated' })
    expect(mockGetValidMollieToken).not.toHaveBeenCalled()
  })

  it('returns error (not a throw) when token refresh fails', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    mockGetValidMollieToken.mockRejectedValue(new Error('invalid_grant'))

    const result = await refreshMollieTokens()

    expect(result.status).toBe('error')
    expect((result as any).message).toMatch(/reconnect/i)
    expect(vi.mocked(prisma.partnerAccount.update)).not.toHaveBeenCalled()
  })

  it('fetches a valid token using the session user id — not any external id', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    mockGetValidMollieToken.mockResolvedValue('access-token-xyz')
    mockFetchMollieProfile.mockResolvedValue({ profileId: 'pfl-123', onboardingStatus: 'completed' })
    vi.mocked(prisma.partnerAccount.update).mockResolvedValue({} as any)

    await refreshMollieTokens()

    expect(mockGetValidMollieToken).toHaveBeenCalledWith(OWNER_ID)
  })

  it('passes the valid access token to fetchMollieProfile', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    mockGetValidMollieToken.mockResolvedValue('access-token-xyz')
    mockFetchMollieProfile.mockResolvedValue({ profileId: 'pfl-123', onboardingStatus: 'completed' })
    vi.mocked(prisma.partnerAccount.update).mockResolvedValue({} as any)

    await refreshMollieTokens()

    expect(mockFetchMollieProfile).toHaveBeenCalledWith('access-token-xyz')
  })

  it('updates account with refreshed profile id and onboarding status', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    mockGetValidMollieToken.mockResolvedValue('access-token-xyz')
    mockFetchMollieProfile.mockResolvedValue({ profileId: 'pfl-123', onboardingStatus: 'completed' })
    vi.mocked(prisma.partnerAccount.update).mockResolvedValue({} as any)

    const result = await refreshMollieTokens()

    expect(result).toEqual({ status: 'ok' })
    expect(vi.mocked(prisma.partnerAccount.update)).toHaveBeenCalledWith({
      where: { userId: OWNER_ID },
      data: {
        mollieProfileId: 'pfl-123',
        mollieOnboardingStatus: 'completed',
      },
    })
  })

  /**
   * BUG-REVEALING: The account update must be scoped to session.user.id.
   * Even if getValidMollieToken were to return a token for a different user,
   * the DB write must land on the session user's own account.
   */
  it('scopes the account update to session.user.id', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    mockGetValidMollieToken.mockResolvedValue('tok')
    mockFetchMollieProfile.mockResolvedValue({ profileId: 'pfl-x', onboardingStatus: 'in-review' })
    vi.mocked(prisma.partnerAccount.update).mockResolvedValue({} as any)

    await refreshMollieTokens()

    const [call] = vi.mocked(prisma.partnerAccount.update).mock.calls
    expect(call[0].where).toEqual({ userId: OWNER_ID })
  })

  it('stores null when the fetched profileId is an empty string', async () => {
    // fetchMollieProfile returns '' when no profile exists on the Mollie account
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    mockGetValidMollieToken.mockResolvedValue('tok')
    mockFetchMollieProfile.mockResolvedValue({ profileId: '', onboardingStatus: 'needs-data' })
    vi.mocked(prisma.partnerAccount.update).mockResolvedValue({} as any)

    const result = await refreshMollieTokens()

    expect(result.status).toBe('ok')
    expect(vi.mocked(prisma.partnerAccount.update)).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ mollieProfileId: null }),
      })
    )
  })

  it('revalidates /account/mollie path on success', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    mockGetValidMollieToken.mockResolvedValue('tok')
    mockFetchMollieProfile.mockResolvedValue({ profileId: 'pfl-1', onboardingStatus: 'completed' })
    vi.mocked(prisma.partnerAccount.update).mockResolvedValue({} as any)

    await refreshMollieTokens()

    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith('/account/mollie')
  })
})
