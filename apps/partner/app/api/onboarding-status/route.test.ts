import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/auth', () => ({
  auth: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/app/api/_lib/mollie', () => ({
  fetchMollieProfile: vi.fn(),
}))

import { GET } from './route'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import { fetchMollieProfile } from '@/app/api/_lib/mollie'

const mockAuth = vi.mocked(auth)
const mockFetchMollieProfile = vi.mocked(fetchMollieProfile)
const mockAccountFindUnique = vi.mocked(prisma.partnerAccount.findUnique)
const mockAccountUpdate = vi.mocked(prisma.partnerAccount.update)
const mockSiteFindMany = vi.mocked(prisma.site.findMany)

const USER_ID = 'user-1'

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue(null)
  mockSiteFindMany.mockResolvedValue([] as any)
})

describe('GET /api/onboarding-status', () => {
  it('returns hasAccount=false when not authenticated', async () => {
    const response = await GET()
    const data = await response.json()
    expect(data).toEqual({ hasAccount: false, hasMollie: false })
    expect(mockFetchMollieProfile).not.toHaveBeenCalled()
  })

  it('returns cached status without calling Mollie when onboarding is completed', async () => {
    mockAuth.mockResolvedValue({ user: { id: USER_ID } } as any)
    mockAccountFindUnique.mockResolvedValue({
      company: 'Acme',
      mollieAccessToken: 'access_xxx',
      mollieOnboardingStatus: 'completed',
    } as any)

    const response = await GET()
    const data = await response.json()

    expect(data.mollieOnboardingStatus).toBe('completed')
    expect(mockFetchMollieProfile).not.toHaveBeenCalled()
    expect(mockAccountUpdate).not.toHaveBeenCalled()
  })

  it('does not call Mollie when no access token is connected', async () => {
    mockAuth.mockResolvedValue({ user: { id: USER_ID } } as any)
    mockAccountFindUnique.mockResolvedValue({
      company: 'Acme',
      mollieAccessToken: null,
      mollieOnboardingStatus: null,
    } as any)

    const response = await GET()
    const data = await response.json()

    expect(data.hasMollie).toBe(false)
    expect(data.mollieOnboardingStatus).toBeNull()
    expect(mockFetchMollieProfile).not.toHaveBeenCalled()
  })

  it('live-syncs status from Mollie when not yet completed and updates DB on change', async () => {
    mockAuth.mockResolvedValue({ user: { id: USER_ID } } as any)
    mockAccountFindUnique.mockResolvedValue({
      company: 'Acme',
      mollieAccessToken: 'access_xxx',
      mollieOnboardingStatus: 'needs-data',
    } as any)
    mockFetchMollieProfile.mockResolvedValue({
      profileId: 'pfl_abc',
      onboardingStatus: 'in-review',
    })

    const response = await GET()
    const data = await response.json()

    expect(mockFetchMollieProfile).toHaveBeenCalledWith('access_xxx')
    expect(mockAccountUpdate).toHaveBeenCalledWith({
      where: { userId: USER_ID },
      data: { mollieOnboardingStatus: 'in-review' },
    })
    expect(data.mollieOnboardingStatus).toBe('in-review')
  })

  it('skips DB update when live status matches cached status', async () => {
    mockAuth.mockResolvedValue({ user: { id: USER_ID } } as any)
    mockAccountFindUnique.mockResolvedValue({
      company: 'Acme',
      mollieAccessToken: 'access_xxx',
      mollieOnboardingStatus: 'in-review',
    } as any)
    mockFetchMollieProfile.mockResolvedValue({
      profileId: 'pfl_abc',
      onboardingStatus: 'in-review',
    })

    const response = await GET()
    const data = await response.json()

    expect(mockFetchMollieProfile).toHaveBeenCalled()
    expect(mockAccountUpdate).not.toHaveBeenCalled()
    expect(data.mollieOnboardingStatus).toBe('in-review')
  })

  it('falls back to cached status when Mollie returns "unknown" (token bad or API down)', async () => {
    mockAuth.mockResolvedValue({ user: { id: USER_ID } } as any)
    mockAccountFindUnique.mockResolvedValue({
      company: 'Acme',
      mollieAccessToken: 'access_xxx',
      mollieOnboardingStatus: 'needs-data',
    } as any)
    mockFetchMollieProfile.mockResolvedValue({
      profileId: '',
      onboardingStatus: 'unknown',
    })

    const response = await GET()
    const data = await response.json()

    expect(mockAccountUpdate).not.toHaveBeenCalled()
    expect(data.mollieOnboardingStatus).toBe('needs-data')
  })

  it('falls back to cached status when fetchMollieProfile throws', async () => {
    mockAuth.mockResolvedValue({ user: { id: USER_ID } } as any)
    mockAccountFindUnique.mockResolvedValue({
      company: 'Acme',
      mollieAccessToken: 'access_xxx',
      mollieOnboardingStatus: 'needs-data',
    } as any)
    mockFetchMollieProfile.mockRejectedValue(new Error('network failure'))

    const response = await GET()
    const data = await response.json()

    expect(mockAccountUpdate).not.toHaveBeenCalled()
    expect(data.mollieOnboardingStatus).toBe('needs-data')
  })
})
