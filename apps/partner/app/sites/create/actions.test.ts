import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/auth', () => ({
  auth: vi.fn().mockResolvedValue(null),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

vi.mock('@/lib/auth-helpers', () => ({
  requireSiteOwner: vi.fn().mockResolvedValue({ session: null, error: 'Not authenticated' }),
}))

// @vercel/blob and sharp are not needed for unit tests
vi.mock('@vercel/blob', () => ({
  put: vi.fn(),
}))

vi.mock('sharp', () => ({
  default: vi.fn().mockReturnValue({
    metadata: vi.fn().mockResolvedValue({ width: 800, height: 600 }),
  }),
}))

import { createSite } from './actions'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import { canCreateSite, getEffectiveSubscriptionForUser } from '@repo/data/subscription'

const mockAuth = vi.mocked(auth)
const mockCanCreateSite = vi.mocked(canCreateSite)
const mockGetEffective = vi.mocked(getEffectiveSubscriptionForUser)

const OWNER_ID = 'user-1'

const baseInput = {
  name: 'Beach Club',
  locationLat: '40.0',
  locationLng: '3.0',
  type: 'paid',
  price: '20',
  vat: '21',
  workingHours: [],
  description: '',
  services: [],
}

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue(null)
  mockCanCreateSite.mockResolvedValue({
    allowed: true,
    currentCount: 0,
    maxSites: 5,
    tier: 'STARTER',
    overridden: false,
  })
  mockGetEffective.mockResolvedValue({
    tier: 'STARTER',
    name: 'Starter',
    monthlyPrice: 0,
    maxSites: 1,
    isCustom: false,
    features: { OFF_PLATFORM_BILLING: false },
  } as any)
})

function authenticateUser() {
  mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
}

// ─── createSite ──────────────────────────────────────────────────────────────

describe('createSite', () => {
  it('rejects unauthenticated user', async () => {
    const res = await createSite(baseInput)
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authenticated')
  })

  it('rejects when site limit exceeded', async () => {
    authenticateUser()
    mockCanCreateSite.mockResolvedValue({
      allowed: false,
      currentCount: 1,
      maxSites: 1,
      tier: 'STARTER',
      overridden: false,
    })

    const res = await createSite(baseInput)
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toContain('plan allows up to')
  })

  it('creates site with type:paid when feature is false', async () => {
    authenticateUser()
    vi.mocked(prisma.site.create).mockResolvedValue({ id: 'new-site' } as any)
    vi.mocked(prisma.$executeRaw).mockResolvedValue(1 as any)

    const res = await createSite({ ...baseInput, type: 'paid' })

    expect(res.status).toBe('ok')
    expect(res.siteId).toBe('new-site')
    // entitlement check not needed for paid sites
    expect(mockGetEffective).not.toHaveBeenCalled()
  })

  it('rejects type:unpaid when OFF_PLATFORM_BILLING feature is false', async () => {
    authenticateUser()
    mockGetEffective.mockResolvedValue({
      tier: 'STARTER',
      name: 'Starter',
      monthlyPrice: 0,
      maxSites: 1,
      isCustom: false,
      features: { OFF_PLATFORM_BILLING: false },
    } as any)

    const res = await createSite({ ...baseInput, type: 'unpaid', price: '' })

    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toContain('Off-platform billing')
    expect(vi.mocked(prisma.site.create)).not.toHaveBeenCalled()
  })

  it('allows type:unpaid when OFF_PLATFORM_BILLING feature is true', async () => {
    authenticateUser()
    mockGetEffective.mockResolvedValue({
      tier: 'PRO',
      name: 'Pro',
      monthlyPrice: 49,
      maxSites: 5,
      isCustom: false,
      features: { OFF_PLATFORM_BILLING: true },
    } as any)
    vi.mocked(prisma.site.create).mockResolvedValue({ id: 'pro-site' } as any)
    vi.mocked(prisma.$executeRaw).mockResolvedValue(1 as any)

    const res = await createSite({ ...baseInput, type: 'unpaid', price: '' })

    expect(res.status).toBe('ok')
    expect(res.siteId).toBe('pro-site')
    expect(vi.mocked(prisma.site.create)).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: 'unpaid' }) })
    )
  })

  it('allows type:unpaid for STARTER with admin feature override (OFF_PLATFORM_BILLING: true)', async () => {
    authenticateUser()
    // Simulates a STARTER partner with an admin-granted override
    mockGetEffective.mockResolvedValue({
      tier: 'STARTER',
      name: 'Starter',
      monthlyPrice: 0,
      maxSites: 1,
      isCustom: true,
      features: { OFF_PLATFORM_BILLING: true },
    } as any)
    vi.mocked(prisma.site.create).mockResolvedValue({ id: 'override-site' } as any)
    vi.mocked(prisma.$executeRaw).mockResolvedValue(1 as any)

    const res = await createSite({ ...baseInput, type: 'unpaid', price: '' })

    expect(res.status).toBe('ok')
  })
})
