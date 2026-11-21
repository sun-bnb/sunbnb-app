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
  createTestRestaurant,
  resetCounter,
} from './test/fixtures'
import {
  loadFeeContext,
  loadRestaurantFeeContext,
  resolveServiceFee,
  getSiteFeeContext,
  getPartnerFeeContext,
  resolveSiteFees,
} from './payment'

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

    // Request a different service code (bootstraps a default fee as a side effect)
    await loadFeeContext(site.id, 'food-and-beverage')

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

  it('selects Settings matching partnerAccount.country', async () => {
    const user = await createTestUser()
    const partner = await createTestPartnerAccount(user.id, { country: 'ES' })
    const site = await createTestSite(user.id)
    await createTestSubscription(partner.userId, 'STARTER')

    // FI Settings — only a tier-NULL 1€ default (mirrors the production FI row)
    const fiSettings = await createTestSettings({ country: 'FI' })
    await createTestServiceFee(fiSettings.id, { feeAmount: 1.0, subscriptionTier: null })

    // ES Settings — full tier ladder
    const esSettings = await createTestSettings({ country: 'ES', vat: 21 })
    await createTestServiceFee(esSettings.id, { feeAmount: 1.0, subscriptionTier: null })
    await createTestServiceFee(esSettings.id, {
      chargeType: 'percentage',
      feeAmount: null,
      percentage: 5,
      subscriptionTier: 'STARTER',
    })

    const ctx = await loadFeeContext(site.id, 'sunbed-rental')
    expect(ctx.settings!.id).toBe(esSettings.id)
    expect(ctx.settings!.country).toBe('ES')

    const tier = ctx.partnerAccount?.subscription?.plan?.tier ?? null
    const resolved = resolveServiceFee(
      ctx.site.serviceFees,
      ctx.partnerAccount?.serviceFees ?? [],
      ctx.settings?.serviceFees ?? [],
      'sunbed-rental',
      tier
    )
    expect(resolved!.subscriptionTier).toBe('STARTER')
    expect(resolved!.chargeType).toBe('percentage')
    expect(resolved!.percentage).toBe(5)
  })

  it('falls back to any Settings when partner country has no match', async () => {
    const user = await createTestUser()
    await createTestPartnerAccount(user.id, { country: 'DE' })
    const site = await createTestSite(user.id)

    const fiSettings = await createTestSettings({ country: 'FI' })
    await createTestServiceFee(fiSettings.id, { feeAmount: 1.0 })

    const ctx = await loadFeeContext(site.id, 'sunbed-rental')
    expect(ctx.settings!.id).toBe(fiSettings.id)
  })

  it('falls back to any Settings when partnerAccount is missing', async () => {
    const user = await createTestUser()
    // No partnerAccount created — country lookup is skipped
    const site = await createTestSite(user.id)
    const settings = await createTestSettings({ country: 'FI' })
    await createTestServiceFee(settings.id, { feeAmount: 1.0 })

    const ctx = await loadFeeContext(site.id, 'sunbed-rental')
    expect(ctx.partnerAccount).toBeNull()
    expect(ctx.settings!.id).toBe(settings.id)
  })

  it('getSiteFeeContext does NOT bootstrap missing Settings', async () => {
    const user = await createTestUser()
    await createTestPartnerAccount(user.id)
    const site = await createTestSite(user.id)

    // No Settings in DB
    const ctx = await getSiteFeeContext(site.id)
    expect(ctx.settings).toBeNull()
    expect(ctx.site.id).toBe(site.id)
    expect(ctx.tier).toBeNull()

    // Confirm no Settings were created as a side effect
    expect(await prisma.settings.count()).toBe(0)
  })

  it('getSiteFeeContext does NOT bootstrap missing serviceCode fee', async () => {
    const user = await createTestUser()
    await createTestPartnerAccount(user.id, { country: 'ES' })
    const site = await createTestSite(user.id)
    const settings = await createTestSettings({ country: 'ES' })
    // Settings exist but no fees for any code

    const ctx = await getSiteFeeContext(site.id)
    expect(ctx.settings!.id).toBe(settings.id)
    expect(ctx.settings!.serviceFees).toHaveLength(0)

    // Confirm no ServiceFee row was created
    expect(await prisma.serviceFee.count()).toBe(0)
  })

  it('resolveSiteFees returns resolved fees for multiple codes', async () => {
    const user = await createTestUser()
    const partner = await createTestPartnerAccount(user.id, { country: 'ES' })
    const site = await createTestSite(user.id)
    await createTestSubscription(partner.userId, 'STARTER')
    const settings = await createTestSettings({ country: 'ES' })
    await createTestServiceFee(settings.id, {
      serviceCode: 'sunbed-rental',
      chargeType: 'percentage',
      feeAmount: null,
      percentage: 5,
      subscriptionTier: 'STARTER',
    })
    await createTestServiceFee(settings.id, {
      serviceCode: 'food-and-beverage',
      chargeType: 'percentage',
      feeAmount: null,
      percentage: 5,
      subscriptionTier: 'STARTER',
    })

    const fees = await resolveSiteFees(site.id, [
      'sunbed-rental',
      'food-and-beverage',
      'equipment-rental', // no fee configured — should be omitted
    ])

    expect(fees).toHaveLength(2)
    expect(fees.map((f) => f.serviceCode).sort()).toEqual([
      'food-and-beverage',
      'sunbed-rental',
    ])
    expect(fees.every((f) => f.subscriptionTier === 'STARTER')).toBe(true)
  })

  it('getPartnerFeeContext resolves country-matched Settings without a site', async () => {
    const user = await createTestUser()
    const partner = await createTestPartnerAccount(user.id, { country: 'ES' })
    await createTestSubscription(partner.userId, 'PRO')

    const fiSettings = await createTestSettings({ country: 'FI' })
    await createTestServiceFee(fiSettings.id, { feeAmount: 1.0 })
    const esSettings = await createTestSettings({ country: 'ES', vat: 21 })
    await createTestServiceFee(esSettings.id, {
      chargeType: 'percentage',
      feeAmount: null,
      percentage: 2,
      subscriptionTier: 'PRO',
    })

    const ctx = await getPartnerFeeContext(user.id)
    expect(ctx.settings!.id).toBe(esSettings.id)
    expect(ctx.tier).toBe('PRO')
    expect(ctx.partnerAccount?.country).toBe('ES')
  })

  it('bootstraps missing serviceCode fee on the country-matched Settings', async () => {
    const user = await createTestUser()
    await createTestPartnerAccount(user.id, { country: 'ES' })
    const site = await createTestSite(user.id)

    // Two Settings rows, only FI has the sunbed-rental fee
    const fiSettings = await createTestSettings({ country: 'FI' })
    await createTestServiceFee(fiSettings.id, { serviceCode: 'sunbed-rental' })
    const esSettings = await createTestSettings({ country: 'ES', vat: 21 })

    // Request a service code missing from ES
    const ctx = await loadFeeContext(site.id, 'food-and-beverage')

    expect(ctx.settings!.id).toBe(esSettings.id)
    const esFees = await prisma.serviceFee.findMany({ where: { settingsId: esSettings.id } })
    expect(esFees.some((f) => f.serviceCode === 'food-and-beverage')).toBe(true)
    // FI was not touched
    const fiFees = await prisma.serviceFee.findMany({ where: { settingsId: fiSettings.id } })
    expect(fiFees.some((f) => f.serviceCode === 'food-and-beverage')).toBe(false)
  })
})

describe('loadRestaurantFeeContext (dine-in v2 — standalone restaurants)', () => {
  it('resolves partner + settings without any site and returns an empty site tier', async () => {
    const user = await createTestUser()
    const partner = await createTestPartnerAccount(user.id)
    const settings = await createTestSettings()
    await createTestServiceFee(settings.id, { serviceCode: 'food-and-beverage' })
    const restaurant = await createTestRestaurant(partner.userId)

    const ctx = await loadRestaurantFeeContext(restaurant.id, 'food-and-beverage')

    expect(ctx.siteFees).toEqual([])
    expect(ctx.partnerAccount?.userId).toBe(partner.userId)
    expect(ctx.settings?.serviceFees.some((f) => f.serviceCode === 'food-and-beverage')).toBe(true)
  })

  it('account-tier fee wins the cascade when present', async () => {
    const user = await createTestUser()
    const partner = await createTestPartnerAccount(user.id)
    const settings = await createTestSettings()
    await createTestServiceFee(settings.id, {
      serviceCode: 'food-and-beverage',
      chargeType: 'fixed',
      feeAmount: 0.5,
    })
    await createTestServiceFee(settings.id, {
      serviceCode: 'food-and-beverage',
      accountId: partner.userId,
      chargeType: 'fixed',
      feeAmount: 3.0,
    })
    const restaurant = await createTestRestaurant(partner.userId)

    const ctx = await loadRestaurantFeeContext(restaurant.id, 'food-and-beverage')
    const resolved = resolveServiceFee(
      ctx.siteFees,
      ctx.partnerAccount?.serviceFees ?? [],
      ctx.settings?.serviceFees ?? [],
      'food-and-beverage',
      ctx.tier,
    )

    expect(resolved?.feeAmount).toBe(3.0)
    expect(resolved?.accountId).toBe(partner.userId)
  })

  it('bootstraps default Settings + fee when none exist', async () => {
    const user = await createTestUser()
    const partner = await createTestPartnerAccount(user.id)
    const restaurant = await createTestRestaurant(partner.userId)

    const ctx = await loadRestaurantFeeContext(restaurant.id, 'food-and-beverage')

    expect(ctx.settings).not.toBeNull()
    expect(ctx.settings?.serviceFees.some((f) => f.serviceCode === 'food-and-beverage')).toBe(true)
  })

  it('throws for an unknown restaurant', async () => {
    await expect(
      loadRestaurantFeeContext('clzzzzzzzzzzzzzzzzzzzzzzz', 'food-and-beverage'),
    ).rejects.toThrow('Restaurant not found')
  })
})
