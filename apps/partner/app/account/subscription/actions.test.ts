import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/auth', () => ({
  auth: vi.fn().mockResolvedValue(null),
}))

import { getSubscriptionData } from './actions'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import { getPartnerSubscription, resolveEffectiveSubscription } from '@repo/data/subscription'

const mockAuth = vi.mocked(auth)
const mockGetPartnerSubscription = vi.mocked(getPartnerSubscription)
const mockResolveEffectiveSubscription = vi.mocked(resolveEffectiveSubscription)

const OWNER_ID = 'owner-1'
const OTHER_ID = 'other-partner'

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue(null)
})

// ─── getSubscriptionData ──────────────────────────────────────────────────────

describe('getSubscriptionData', () => {

  // ── Authentication ──────────────────────────────────────────────────────────

  it('returns null (not an error) when not authenticated', async () => {
    const result = await getSubscriptionData()
    expect(result).toBeNull()
    // No DB queries should fire for an unauthenticated caller
    expect(mockGetPartnerSubscription).not.toHaveBeenCalled()
    expect(vi.mocked(prisma.site.count)).not.toHaveBeenCalled()
    expect(vi.mocked(prisma.subscriptionPlan.findMany)).not.toHaveBeenCalled()
  })

  // ── Ownership / scoping ─────────────────────────────────────────────────────

  /**
   * BUG-REVEALING: All queries must be scoped to the session user's id.
   * Passing a foreign userId would not be possible via the action signature,
   * but we assert the DB calls themselves use the correct id.
   */
  it('queries subscription using session.user.id', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    mockGetPartnerSubscription.mockResolvedValue(null)
    vi.mocked(prisma.subscriptionPlan.findMany).mockResolvedValue([])
    vi.mocked(prisma.site.count).mockResolvedValue(0)
    vi.mocked(prisma.customSubscription.findUnique).mockResolvedValue(null)

    await getSubscriptionData()

    expect(mockGetPartnerSubscription).toHaveBeenCalledWith(OWNER_ID)
    expect(mockGetPartnerSubscription).not.toHaveBeenCalledWith(OTHER_ID)
  })

  it('counts only the session user own sites', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    mockGetPartnerSubscription.mockResolvedValue(null)
    vi.mocked(prisma.subscriptionPlan.findMany).mockResolvedValue([])
    vi.mocked(prisma.site.count).mockResolvedValue(3)
    vi.mocked(prisma.customSubscription.findUnique).mockResolvedValue(null)

    await getSubscriptionData()

    expect(vi.mocked(prisma.site.count)).toHaveBeenCalledWith({
      where: { userId: OWNER_ID },
    })
  })

  it('queries custom subscription using session.user.id', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    mockGetPartnerSubscription.mockResolvedValue(null)
    vi.mocked(prisma.subscriptionPlan.findMany).mockResolvedValue([])
    vi.mocked(prisma.site.count).mockResolvedValue(0)
    vi.mocked(prisma.customSubscription.findUnique).mockResolvedValue(null)

    await getSubscriptionData()

    expect(vi.mocked(prisma.customSubscription.findUnique)).toHaveBeenCalledWith({
      where: { partnerAccountId: OWNER_ID },
      select: { maxSites: true },
    })
  })

  // ── Happy path ──────────────────────────────────────────────────────────────

  it('returns subscription, plans, siteCount, effectiveMaxSites and isCustomMaxSites', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    const fakeSub = { plan: { tier: 'PRO', name: 'Pro', monthlyPrice: 49, maxSites: 5 } }
    const fakePlans = [{ id: 'plan-pro', tier: 'PRO' }]
    mockGetPartnerSubscription.mockResolvedValue(fakeSub as any)
    vi.mocked(prisma.subscriptionPlan.findMany).mockResolvedValue(fakePlans as any)
    vi.mocked(prisma.site.count).mockResolvedValue(2)
    vi.mocked(prisma.customSubscription.findUnique).mockResolvedValue(null)
    mockResolveEffectiveSubscription.mockReturnValue({
      tier: 'PRO',
      name: 'Pro',
      monthlyPrice: 49,
      maxSites: 5,
      isCustom: false,
      features: { OFF_PLATFORM_BILLING: false },
    })

    const result = await getSubscriptionData()

    expect(result).not.toBeNull()
    expect(result!.subscription).toEqual(fakeSub)
    expect(result!.plans).toEqual(fakePlans)
    expect(result!.siteCount).toBe(2)
    expect(result!.effectiveMaxSites).toBe(5)
    expect(result!.isCustomMaxSites).toBe(false)
  })

  it('resolves effective subscription from the plan and custom override', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    mockGetPartnerSubscription.mockResolvedValue(null)
    vi.mocked(prisma.subscriptionPlan.findMany).mockResolvedValue([])
    vi.mocked(prisma.site.count).mockResolvedValue(1)
    const customSub = { maxSites: 20 }
    vi.mocked(prisma.customSubscription.findUnique).mockResolvedValue(customSub as any)
    mockResolveEffectiveSubscription.mockReturnValue({
      tier: 'STARTER',
      name: 'Starter',
      monthlyPrice: 0,
      maxSites: 20,
      isCustom: true,
      features: { OFF_PLATFORM_BILLING: false },
    })

    const result = await getSubscriptionData()

    expect(result!.effectiveMaxSites).toBe(20)
    expect(result!.isCustomMaxSites).toBe(true)
    // resolveEffectiveSubscription must receive the plan and the customSub object
    expect(mockResolveEffectiveSubscription).toHaveBeenCalledWith(null, customSub)
  })

  it('passes plan from subscription to resolveEffectiveSubscription', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    const fakePlan = { tier: 'PRO', name: 'Pro', monthlyPrice: 49, maxSites: 5 }
    mockGetPartnerSubscription.mockResolvedValue({ plan: fakePlan } as any)
    vi.mocked(prisma.subscriptionPlan.findMany).mockResolvedValue([])
    vi.mocked(prisma.site.count).mockResolvedValue(0)
    vi.mocked(prisma.customSubscription.findUnique).mockResolvedValue(null)

    await getSubscriptionData()

    expect(mockResolveEffectiveSubscription).toHaveBeenCalledWith(fakePlan, null)
  })

  it('returns siteCount from the count of sites owned by the session user', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    mockGetPartnerSubscription.mockResolvedValue(null)
    vi.mocked(prisma.subscriptionPlan.findMany).mockResolvedValue([])
    vi.mocked(prisma.site.count).mockResolvedValue(7)
    vi.mocked(prisma.customSubscription.findUnique).mockResolvedValue(null)

    const result = await getSubscriptionData()

    expect(result!.siteCount).toBe(7)
  })
})
