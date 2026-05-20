import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/auth', () => ({
  auth: vi.fn().mockResolvedValue(null),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

// Mock saveServiceFee and getFeesByAccount from fees/actions so waiveAllServiceFees
// can be tested without the full save logic. The real saveServiceFee is tested
// separately in fees/actions.test.ts.
vi.mock('../../fees/actions', () => ({
  saveServiceFee: vi.fn().mockResolvedValue({ status: 'ok' }),
  getFeesByAccount: vi.fn().mockResolvedValue([]),
}))

import {
  upsertCustomSubscription,
  clearCustomSubscription,
  waiveAllServiceFees,
  getPartnerDetail,
  setFeatureOverride,
} from './actions'
import { saveServiceFee, getFeesByAccount } from '../../fees/actions'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'

const mockAuth = vi.mocked(auth)
const mockSaveServiceFee = vi.mocked(saveServiceFee)
const mockGetFeesByAccount = vi.mocked(getFeesByAccount)

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue(null)
  // Reset fee action mocks to defaults
  mockSaveServiceFee.mockResolvedValue({ status: 'ok' })
  mockGetFeesByAccount.mockResolvedValue([])
})

function authenticateAsSudo() {
  mockAuth.mockResolvedValue({ user: { id: 'admin-1' } } as any)
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ sudo: true } as any)
}

// ─── requireSudo guard ───────────────────────────────────────────────────────

describe('requireSudo guard', () => {
  it('rejects unauthenticated callers for upsertCustomSubscription', async () => {
    mockAuth.mockResolvedValue(null)
    await expect(upsertCustomSubscription('acc-1', { maxSites: 3 })).rejects.toThrow()
  })

  it('rejects non-sudo users for upsertCustomSubscription', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ sudo: false } as any)
    await expect(upsertCustomSubscription('acc-1', { maxSites: 3 })).rejects.toThrow()
  })

  it('rejects unauthenticated callers for clearCustomSubscription', async () => {
    mockAuth.mockResolvedValue(null)
    await expect(clearCustomSubscription('acc-1')).rejects.toThrow()
  })

  it('rejects non-sudo users for clearCustomSubscription', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ sudo: false } as any)
    await expect(clearCustomSubscription('acc-1')).rejects.toThrow()
  })

  it('rejects unauthenticated callers for waiveAllServiceFees', async () => {
    mockAuth.mockResolvedValue(null)
    await expect(waiveAllServiceFees('acc-1')).rejects.toThrow()
  })

  it('rejects non-sudo users for waiveAllServiceFees', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ sudo: false } as any)
    await expect(waiveAllServiceFees('acc-1')).rejects.toThrow()
  })

  it('rejects unauthenticated callers for getPartnerDetail', async () => {
    mockAuth.mockResolvedValue(null)
    await expect(getPartnerDetail('acc-1')).rejects.toThrow()
  })
})

// ─── upsertCustomSubscription ────────────────────────────────────────────────

describe('upsertCustomSubscription', () => {
  it('accepts a valid positive integer for maxSites', async () => {
    authenticateAsSudo()
    vi.mocked(prisma.customSubscription.upsert).mockResolvedValue({} as any)

    const res = await upsertCustomSubscription('acc-1', { maxSites: 3 })
    expect(res.status).toBe('ok')
    expect(vi.mocked(prisma.customSubscription.upsert)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { partnerAccountId: 'acc-1' },
        create: expect.objectContaining({ maxSites: 3, partnerAccountId: 'acc-1' }),
        update: expect.objectContaining({ maxSites: 3 }),
      }),
    )
  })

  it('accepts 0 as maxSites (zero sites allowed)', async () => {
    authenticateAsSudo()
    vi.mocked(prisma.customSubscription.upsert).mockResolvedValue({} as any)

    const res = await upsertCustomSubscription('acc-1', { maxSites: 0 })
    expect(res.status).toBe('ok')
  })

  it('accepts null maxSites (clear the override, fall back to base plan)', async () => {
    authenticateAsSudo()
    vi.mocked(prisma.customSubscription.upsert).mockResolvedValue({} as any)

    const res = await upsertCustomSubscription('acc-1', { maxSites: null })
    expect(res.status).toBe('ok')
    expect(vi.mocked(prisma.customSubscription.upsert)).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ maxSites: null }),
        update: expect.objectContaining({ maxSites: null }),
      }),
    )
  })

  it('rejects a negative maxSites', async () => {
    authenticateAsSudo()
    const res = await upsertCustomSubscription('acc-1', { maxSites: -1 })
    expect(res.status).toBe('error')
    expect(res.errors).toBeDefined()
    expect(res.errors![0]).toContain('non-negative integer')
  })

  it('rejects a non-integer maxSites (float)', async () => {
    authenticateAsSudo()
    const res = await upsertCustomSubscription('acc-1', { maxSites: 2.5 as any })
    expect(res.status).toBe('error')
    expect(res.errors).toBeDefined()
    expect(res.errors![0]).toContain('non-negative integer')
  })

  it('stores notes when provided', async () => {
    authenticateAsSudo()
    vi.mocked(prisma.customSubscription.upsert).mockResolvedValue({} as any)

    const res = await upsertCustomSubscription('acc-1', { maxSites: 5, notes: 'VIP partner' })
    expect(res.status).toBe('ok')
    expect(vi.mocked(prisma.customSubscription.upsert)).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ notes: 'VIP partner' }),
        update: expect.objectContaining({ notes: 'VIP partner' }),
      }),
    )
  })
})

// ─── clearCustomSubscription ─────────────────────────────────────────────────

describe('clearCustomSubscription', () => {
  it('calls deleteMany for the account', async () => {
    authenticateAsSudo()
    vi.mocked(prisma.customSubscription.deleteMany).mockResolvedValue({ count: 1 } as any)

    const res = await clearCustomSubscription('acc-1')
    expect(res.status).toBe('ok')
    expect(vi.mocked(prisma.customSubscription.deleteMany)).toHaveBeenCalledWith({
      where: { partnerAccountId: 'acc-1' },
    })
  })

  it('succeeds even when no custom subscription exists (idempotent)', async () => {
    authenticateAsSudo()
    vi.mocked(prisma.customSubscription.deleteMany).mockResolvedValue({ count: 0 } as any)

    const res = await clearCustomSubscription('acc-1')
    expect(res.status).toBe('ok')
  })
})

// ─── waiveAllServiceFees ─────────────────────────────────────────────────────

describe('waiveAllServiceFees', () => {
  it('returns ok immediately when no service codes exist', async () => {
    authenticateAsSudo()
    vi.mocked(prisma.serviceCode.findMany).mockResolvedValue([])

    const res = await waiveAllServiceFees('acc-1')
    expect(res.status).toBe('ok')
    expect(mockSaveServiceFee).not.toHaveBeenCalled()
  })

  it('errors when no Settings are configured', async () => {
    authenticateAsSudo()
    vi.mocked(prisma.serviceCode.findMany).mockResolvedValue([
      { id: 'sc-1', code: 'sunbed', description: null },
    ] as any)
    vi.mocked(prisma.partnerAccount.findUnique).mockResolvedValue({
      country: null,
    } as any)
    vi.mocked(prisma.settings.findFirst).mockResolvedValue(null)

    const res = await waiveAllServiceFees('acc-1')
    expect(res.status).toBe('error')
    expect(res.errors).toContain('No Settings configured')
  })

  it('upserts 0% fee for each service code', async () => {
    authenticateAsSudo()
    vi.mocked(prisma.serviceCode.findMany).mockResolvedValue([
      { id: 'sc-1', code: 'sunbed', description: null },
      { id: 'sc-2', code: 'order', description: null },
    ] as any)
    vi.mocked(prisma.partnerAccount.findUnique).mockResolvedValue({
      country: 'ES',
    } as any)
    vi.mocked(prisma.settings.findFirst).mockResolvedValue({ id: 'settings-1' } as any)
    mockGetFeesByAccount.mockResolvedValue([])

    const res = await waiveAllServiceFees('acc-1')
    expect(res.status).toBe('ok')

    expect(mockSaveServiceFee).toHaveBeenCalledTimes(2)
    expect(mockSaveServiceFee).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'acc-1',
        chargeType: 'percentage',
        percentage: 0,
        serviceCode: 'sunbed',
        settingsId: 'settings-1',
      }),
    )
    expect(mockSaveServiceFee).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'acc-1',
        chargeType: 'percentage',
        percentage: 0,
        serviceCode: 'order',
        settingsId: 'settings-1',
      }),
    )
  })

  it('passes existing fee id to saveServiceFee for idempotent update', async () => {
    authenticateAsSudo()
    vi.mocked(prisma.serviceCode.findMany).mockResolvedValue([
      { id: 'sc-1', code: 'sunbed', description: null },
    ] as any)
    vi.mocked(prisma.partnerAccount.findUnique).mockResolvedValue({
      country: 'FI',
    } as any)
    vi.mocked(prisma.settings.findFirst).mockResolvedValue({ id: 'settings-fi' } as any)

    // Simulate existing fee for 'sunbed' — id should be passed through
    mockGetFeesByAccount.mockResolvedValue([
      {
        id: 'fee-existing-1',
        serviceCode: 'sunbed',
        accountId: 'acc-1',
        chargeType: 'percentage',
        percentage: 5,
        settings: { id: 'settings-fi' },
        site: null,
        account: null,
      },
    ] as any)

    const res = await waiveAllServiceFees('acc-1')
    expect(res.status).toBe('ok')

    // Must pass existing id so it UPDATEs rather than CREATEs (prevents duplicates)
    expect(mockSaveServiceFee).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'fee-existing-1',
        serviceCode: 'sunbed',
        percentage: 0,
      }),
    )
    expect(mockSaveServiceFee).toHaveBeenCalledTimes(1)
  })

  it('falls back to any Settings row when partner has no country', async () => {
    authenticateAsSudo()
    vi.mocked(prisma.serviceCode.findMany).mockResolvedValue([
      { id: 'sc-1', code: 'sunbed', description: null },
    ] as any)
    vi.mocked(prisma.partnerAccount.findUnique).mockResolvedValue({
      country: null,
    } as any)
    // No country-match call — should fall back to global findFirst
    vi.mocked(prisma.settings.findFirst).mockResolvedValue({ id: 'settings-global' } as any)
    mockGetFeesByAccount.mockResolvedValue([])

    const res = await waiveAllServiceFees('acc-1')
    expect(res.status).toBe('ok')
    expect(mockSaveServiceFee).toHaveBeenCalledWith(
      expect.objectContaining({ settingsId: 'settings-global', percentage: 0 }),
    )
  })
})

// ─── setFeatureOverride ──────────────────────────────────────────────────────

describe('setFeatureOverride', () => {
  it('rejects unauthenticated callers', async () => {
    mockAuth.mockResolvedValue(null)
    await expect(setFeatureOverride('acc-1', 'OFF_PLATFORM_BILLING', true)).rejects.toThrow()
  })

  it('rejects non-sudo users', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ sudo: false } as any)
    await expect(setFeatureOverride('acc-1', 'OFF_PLATFORM_BILLING', true)).rejects.toThrow()
  })

  it('rejects an unknown feature key', async () => {
    authenticateAsSudo()
    const res = await setFeatureOverride('acc-1', 'NONEXISTENT_FEATURE', true)
    expect(res.status).toBe('error')
    expect(res.errors).toBeDefined()
    expect(res.errors![0]).toContain('Unknown feature key')
  })

  it('force-on: upserts { OFF_PLATFORM_BILLING: true }', async () => {
    authenticateAsSudo()
    vi.mocked(prisma.customSubscription.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.customSubscription.upsert).mockResolvedValue({} as any)

    const res = await setFeatureOverride('acc-1', 'OFF_PLATFORM_BILLING', true)
    expect(res.status).toBe('ok')
    expect(vi.mocked(prisma.customSubscription.upsert)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { partnerAccountId: 'acc-1' },
        create: expect.objectContaining({
          partnerAccountId: 'acc-1',
          featureOverrides: { OFF_PLATFORM_BILLING: true },
        }),
        update: expect.objectContaining({
          featureOverrides: { OFF_PLATFORM_BILLING: true },
        }),
      }),
    )
  })

  it('force-off: upserts { OFF_PLATFORM_BILLING: false }', async () => {
    authenticateAsSudo()
    vi.mocked(prisma.customSubscription.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.customSubscription.upsert).mockResolvedValue({} as any)

    const res = await setFeatureOverride('acc-1', 'OFF_PLATFORM_BILLING', false)
    expect(res.status).toBe('ok')
    expect(vi.mocked(prisma.customSubscription.upsert)).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          featureOverrides: { OFF_PLATFORM_BILLING: false },
        }),
      }),
    )
  })

  it('inherit (null): removes key from override map', async () => {
    authenticateAsSudo()
    // Simulate existing overrides that include OFF_PLATFORM_BILLING
    vi.mocked(prisma.customSubscription.findUnique).mockResolvedValue({
      featureOverrides: { OFF_PLATFORM_BILLING: true },
    } as any)
    vi.mocked(prisma.customSubscription.upsert).mockResolvedValue({} as any)

    const res = await setFeatureOverride('acc-1', 'OFF_PLATFORM_BILLING', null)
    expect(res.status).toBe('ok')

    const upsertArgs = vi.mocked(prisma.customSubscription.upsert).mock.calls[0]![0] as any
    const upsertedMap = upsertArgs.update.featureOverrides as Record<string, boolean>
    expect(upsertedMap).not.toHaveProperty('OFF_PLATFORM_BILLING')
  })

  it('preserves other keys when removing one override', async () => {
    authenticateAsSudo()
    vi.mocked(prisma.customSubscription.findUnique).mockResolvedValue({
      featureOverrides: { OFF_PLATFORM_BILLING: true, ANOTHER_KEY: false },
    } as any)
    vi.mocked(prisma.customSubscription.upsert).mockResolvedValue({} as any)

    await setFeatureOverride('acc-1', 'OFF_PLATFORM_BILLING', null)

    const upsertArgs = vi.mocked(prisma.customSubscription.upsert).mock.calls[0]![0] as any
    const upsertedMap = upsertArgs.update.featureOverrides as Record<string, boolean>
    expect(upsertedMap).not.toHaveProperty('OFF_PLATFORM_BILLING')
    expect(upsertedMap).toHaveProperty('ANOTHER_KEY', false)
  })

  it('creates a new CustomSubscription row when none exists', async () => {
    authenticateAsSudo()
    vi.mocked(prisma.customSubscription.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.customSubscription.upsert).mockResolvedValue({} as any)

    await setFeatureOverride('acc-1', 'OFF_PLATFORM_BILLING', true)

    expect(vi.mocked(prisma.customSubscription.upsert)).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ partnerAccountId: 'acc-1' }),
      }),
    )
  })
})
