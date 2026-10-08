import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/auth', () => ({
  auth: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/app/api/_lib/mollie', () => ({
  fetchMollieProfile: vi.fn(),
}))

// `@repo/data/viva` has no vitest.config.ts alias (no prisma import), mock it
// outright — same reasoning as `@/app/api/_lib/mollie` above.
vi.mock('@repo/data/viva', () => ({
  getVivaAccountsClient: vi.fn(),
}))

import { retrieveAccountSnapshot } from '@repo/data/stripe'
import { GET } from './route'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import { fetchMollieProfile } from '@/app/api/_lib/mollie'
import { getVivaAccountsClient } from '@repo/data/viva'
import { syncEffectiveProvider } from '@repo/data/payment-providers/selection'

const mockSync = vi.mocked(syncEffectiveProvider)
const mockSiteFindFirst = vi.mocked(prisma.site.findFirst)
const mockAuth = vi.mocked(auth)
const mockFetchMollieProfile = vi.mocked(fetchMollieProfile)
const mockGetVivaAccountsClient = vi.mocked(getVivaAccountsClient)
const mockAccountFindUnique = vi.mocked(prisma.partnerAccount.findUnique)
const mockAccountUpdate = vi.mocked(prisma.partnerAccount.update)
const mockSiteFindMany = vi.mocked(prisma.site.findMany)
const mockGetConnectedAccount = vi.fn()

const USER_ID = 'user-1'

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue(null)
  mockSiteFindMany.mockResolvedValue([] as any)
  mockSiteFindFirst.mockResolvedValue(null as any)
  mockGetVivaAccountsClient.mockReturnValue({
    createConnectedAccount: vi.fn(),
    getConnectedAccount: mockGetConnectedAccount,
  } as any)
})

describe('GET /api/onboarding-status', () => {
  it('returns hasAccount=false when not authenticated', async () => {
    const response = await GET()
    const data = await response.json()
    expect(data).toEqual({ hasAccount: false, hasMollie: false, hasViva: false })
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
    // Connection state changed -> effective provider re-synced.
    expect(mockSync).toHaveBeenCalledWith(USER_ID)
    // Readiness reflects the LIVE value, not the stale cached 'needs-data'.
    expect(data.readiness).toMatchObject({ provider: 'mollie', status: 'in_review', ready: false })
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
    expect(mockSync).not.toHaveBeenCalled()
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

  it('does not call Viva when no vivaAccountId is connected', async () => {
    mockAuth.mockResolvedValue({ user: { id: USER_ID } } as any)
    mockAccountFindUnique.mockResolvedValue({
      company: 'Acme',
      mollieAccessToken: null,
      mollieOnboardingStatus: null,
      vivaAccountId: null,
      vivaVerificationStatus: null,
    } as any)

    const response = await GET()
    const data = await response.json()

    expect(data.hasViva).toBe(false)
    expect(mockGetConnectedAccount).not.toHaveBeenCalled()
  })

  it('live-syncs Viva verification status and writes merchantId on change', async () => {
    mockAuth.mockResolvedValue({ user: { id: USER_ID } } as any)
    mockAccountFindUnique.mockResolvedValue({
      company: 'Acme',
      mollieAccessToken: null,
      mollieOnboardingStatus: null,
      vivaAccountId: 'acct-1',
      vivaVerificationStatus: 'pending',
    } as any)
    mockGetConnectedAccount.mockResolvedValue({
      accountId: 'acct-1',
      verificationStatus: 'verified',
      merchantId: 'merchant-xyz',
      raw: {},
    })

    const response = await GET()
    const data = await response.json()

    expect(mockGetConnectedAccount).toHaveBeenCalledWith('acct-1')
    expect(mockAccountUpdate).toHaveBeenCalledWith({
      where: { userId: USER_ID },
      data: { vivaVerificationStatus: 'verified', vivaMerchantId: 'merchant-xyz' },
    })
    expect(data.hasViva).toBe(true)
    expect(data.vivaVerificationStatus).toBe('verified')
    expect(mockSync).toHaveBeenCalledWith(USER_ID)
  })

  it('does not poll Viva once verification status is already verified', async () => {
    mockAuth.mockResolvedValue({ user: { id: USER_ID } } as any)
    mockAccountFindUnique.mockResolvedValue({
      company: 'Acme',
      mollieAccessToken: null,
      mollieOnboardingStatus: null,
      vivaAccountId: 'acct-1',
      vivaVerificationStatus: 'verified',
    } as any)

    const response = await GET()
    const data = await response.json()

    expect(mockGetConnectedAccount).not.toHaveBeenCalled()
    expect(data.vivaVerificationStatus).toBe('verified')
  })

  it('falls back to cached Viva status when the lookup throws', async () => {
    mockAuth.mockResolvedValue({ user: { id: USER_ID } } as any)
    mockAccountFindUnique.mockResolvedValue({
      company: 'Acme',
      mollieAccessToken: null,
      mollieOnboardingStatus: null,
      vivaAccountId: 'acct-1',
      vivaVerificationStatus: 'pending',
    } as any)
    mockGetConnectedAccount.mockRejectedValue(new Error('network failure'))

    const response = await GET()
    const data = await response.json()

    expect(mockAccountUpdate).not.toHaveBeenCalled()
    expect(data.vivaVerificationStatus).toBe('pending')
  })

  describe('provider-neutral contract (track 028)', () => {
    it('reports the EFFECTIVE provider from the first site and the SELECTED one separately', async () => {
      mockAuth.mockResolvedValue({ user: { id: USER_ID } } as any)
      mockAccountFindUnique.mockResolvedValue({
        company: 'Acme',
        paymentProvider: 'viva',
        mollieAccessToken: 'access_xxx',
        mollieOnboardingStatus: 'completed',
        vivaAccountId: 'acct-1',
        vivaMerchantId: null,
        vivaVerificationStatus: 'verified',
      } as any)
      mockSiteFindFirst.mockResolvedValue({ paymentProvider: 'mollie' } as any)

      const data = await (await GET()).json()

      expect(data.provider).toBe('mollie')
      expect(data.selected).toBe('viva')
      expect(data.readiness).toMatchObject({ provider: 'mollie', ready: true, connectPath: '/account/mollie' })
      // verified but no merchant id yet -> still in review, so Viva is selected-but-not-ready.
      expect(data.selectedReadiness).toMatchObject({ provider: 'viva', ready: false, status: 'in_review' })
      expect(data.selectedDiffersFromEffective).toBe(true)
      // Legacy fields stay.
      expect(data.hasMollie).toBe(true)
      expect(data.mollieOnboardingStatus).toBe('completed')
      // The token never leaks into the response.
      expect(JSON.stringify(data)).not.toContain('access_xxx')
    })

    it('falls back to the selected provider when the account has no site', async () => {
      mockAuth.mockResolvedValue({ user: { id: USER_ID } } as any)
      mockAccountFindUnique.mockResolvedValue({ company: 'Acme', paymentProvider: 'stripe' } as any)

      const data = await (await GET()).json()

      expect(data.provider).toBe('stripe')
      expect(data.selectedDiffersFromEffective).toBe(false)
      expect(data.readiness).toMatchObject({ provider: 'stripe', status: 'not_connected', nextStep: 'connect' })
    })
  })

  it('live-syncs Stripe Connect while onboarding is incomplete and persists columns', async () => {
    mockAuth.mockResolvedValue({ user: { id: USER_ID } } as any)
    mockAccountFindUnique.mockResolvedValue({
      company: 'Acme',
      stripeConnectAccountId: 'acct_1',
      stripeConnectOnboardingStatus: 'in_progress',
    } as any)
    vi.mocked(retrieveAccountSnapshot).mockResolvedValue({
      accountId: 'acct_1', chargesEnabled: true, payoutsEnabled: true, detailsSubmitted: true,
      currentlyDue: [], eventuallyDue: [], pastDue: [], disabledReason: null, errors: [], status: 'complete',
    })
    await GET()
    expect(retrieveAccountSnapshot).toHaveBeenCalledWith('acct_1')
    expect(mockAccountUpdate).toHaveBeenCalledWith({
      where: { userId: USER_ID },
      data: expect.objectContaining({ stripeConnectOnboardingStatus: 'complete', stripeConnectChargesEnabled: true }),
    })
    expect(mockSync).toHaveBeenCalledWith(USER_ID)
  })

  it('does not call Stripe once Connect onboarding is complete', async () => {
    mockAuth.mockResolvedValue({ user: { id: USER_ID } } as any)
    mockAccountFindUnique.mockResolvedValue({
      company: 'Acme', stripeConnectAccountId: 'acct_1', stripeConnectOnboardingStatus: 'complete',
    } as any)
    await GET()
    expect(retrieveAccountSnapshot).not.toHaveBeenCalled()
  })
})
