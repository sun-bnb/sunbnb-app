import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'

vi.mock('./email', () => ({
  sendEmail: vi.fn().mockResolvedValue({ id: 'mock-email' }),
}))

import { cleanDatabase, disconnectDatabase, prisma } from './test/setup'
import {
  createTestUser,
  createTestPartnerAccount,
  createTestSite,
  createTestSettings,
  createTestServiceFee,
  createTestSubscription,
  resetCounter,
} from './test/fixtures'
import { loadFeeContext, resolveServiceFee } from './payment'

beforeEach(async () => {
  await cleanDatabase()
  resetCounter()
})

afterAll(async () => {
  await disconnectDatabase()
})

describe('loadFeeContext', () => {
  it('returns site, partnerAccount, and settings with service fees', async () => {
    const user = await createTestUser()
    await createTestPartnerAccount(user.id)
    const site = await createTestSite(user.id)
    const settings = await createTestSettings()
    await createTestServiceFee(settings.id)

    const ctx = await loadFeeContext(site.id, 'sunbed-rental')

    expect(ctx.site.id).toBe(site.id)
    expect(ctx.partnerAccount).not.toBeNull()
    expect(ctx.settings).not.toBeNull()
    expect(ctx.settings!.serviceFees.length).toBeGreaterThanOrEqual(1)
  })

  it('bootstraps Settings when none exist', async () => {
    const user = await createTestUser()
    await createTestPartnerAccount(user.id)
    const site = await createTestSite(user.id)

    // No Settings in DB — loadFeeContext should create one
    const ctx = await loadFeeContext(site.id, 'sunbed-rental')

    expect(ctx.settings).not.toBeNull()
    expect(ctx.settings!.country).toBe('FI')
    expect(ctx.settings!.currency).toBe('EUR')

    const allSettings = await prisma.settings.findMany()
    expect(allSettings).toHaveLength(1)

    // Should also have bootstrapped a service fee
    const fees = await prisma.serviceFee.findMany({
      where: { settingsId: allSettings[0]!.id },
    })
    expect(fees.length).toBeGreaterThanOrEqual(1)
    expect(fees.some((f) => f.serviceCode === 'sunbed-rental')).toBe(true)
  })

  it('bootstraps ServiceFee for new service code', async () => {
    const user = await createTestUser()
    await createTestPartnerAccount(user.id)
    const site = await createTestSite(user.id)
    const settings = await createTestSettings()
    await createTestServiceFee(settings.id, { serviceCode: 'sunbed-rental' })

    // Request a different service code
    const ctx = await loadFeeContext(site.id, 'food-and-beverage')

    const fees = await prisma.serviceFee.findMany({
      where: { settingsId: settings.id },
    })
    expect(fees.some((f) => f.serviceCode === 'food-and-beverage')).toBe(true)
  })

  it('site fee wins in three-tier cascade', async () => {
    const user = await createTestUser()
    const partner = await createTestPartnerAccount(user.id)
    const site = await createTestSite(user.id)
    const settings = await createTestSettings()

    // Create fees at all three levels
    await createTestServiceFee(settings.id, {
      siteId: site.id,
      feeAmount: 3.0,
    })
    await createTestServiceFee(settings.id, {
      accountId: partner.userId,
      feeAmount: 2.0,
    })
    await createTestServiceFee(settings.id, { feeAmount: 1.0 })

    const ctx = await loadFeeContext(site.id, 'sunbed-rental')

    const resolved = resolveServiceFee(
      ctx.site.serviceFees,
      ctx.partnerAccount?.serviceFees ?? [],
      ctx.settings?.serviceFees ?? [],
      'sunbed-rental'
    )

    expect(resolved!.feeAmount).toBe(3.0)
    expect(resolved!.siteId).toBe(site.id)
  })

  it('account fee wins when no site fee', async () => {
    const user = await createTestUser()
    const partner = await createTestPartnerAccount(user.id)
    const site = await createTestSite(user.id)
    const settings = await createTestSettings()

    await createTestServiceFee(settings.id, {
      accountId: partner.userId,
      feeAmount: 2.0,
    })
    await createTestServiceFee(settings.id, { feeAmount: 1.0 })

    const ctx = await loadFeeContext(site.id, 'sunbed-rental')

    const resolved = resolveServiceFee(
      ctx.site.serviceFees,
      ctx.partnerAccount?.serviceFees ?? [],
      ctx.settings?.serviceFees ?? [],
      'sunbed-rental'
    )

    expect(resolved!.feeAmount).toBe(2.0)
    expect(resolved!.accountId).toBe(partner.userId)
  })

  it('subscription tier affects platform fee selection', async () => {
    const user = await createTestUser()
    const partner = await createTestPartnerAccount(user.id)
    const site = await createTestSite(user.id)
    const settings = await createTestSettings()
    await createTestSubscription(partner.userId, 'STARTER')

    // Tier-specific fee
    await createTestServiceFee(settings.id, {
      feeAmount: 0.5,
      subscriptionTier: 'STARTER',
    })
    // Default (null-tier) fee
    await createTestServiceFee(settings.id, {
      feeAmount: 1.0,
      subscriptionTier: null,
    })

    const ctx = await loadFeeContext(site.id, 'sunbed-rental')
    const tier = ctx.partnerAccount?.subscription?.plan?.tier ?? null

    const resolved = resolveServiceFee(
      ctx.site.serviceFees,
      ctx.partnerAccount?.serviceFees ?? [],
      ctx.settings?.serviceFees ?? [],
      'sunbed-rental',
      tier
    )

    expect(resolved!.feeAmount).toBe(0.5)
    expect(resolved!.subscriptionTier).toBe('STARTER')
  })

  it('throws for non-existent site', async () => {
    await expect(loadFeeContext('nonexistent', 'sunbed-rental')).rejects.toThrow(
      'Site not found'
    )
  })
})
