import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import type { SubscriptionTier } from '@prisma/client'
import { cleanDatabase, disconnectDatabase, prisma } from './test/setup'
import {
  createTestUser, createTestPartnerAccount, createTestSite, createTestInventoryItem,
  createTestRestaurant, createTestSunbedGroup, resetCounter,
} from './test/fixtures'
import { checkChargeAllowed, checkFoodOrderingAllowed, checkHamacaLimit, checkNewSiteHamacas, countHamacas } from './plan-gate'
import { canCreateSite, PRICING_TIERS, planRowMaxSites } from './subscription'

beforeEach(async () => {
  await cleanDatabase()
  resetCounter()
})
afterAll(async () => {
  await disconnectDatabase()
})

/** A partner on `tier` with the catalogue's plan row (limits as seeded). */
async function partnerOn(tier: SubscriptionTier, custom?: { maxSites?: number; maxHamacasPerSite?: number }) {
  const user = await createTestUser()
  await createTestPartnerAccount(user.id)
  const spec = PRICING_TIERS[tier]
  const plan = await prisma.subscriptionPlan.upsert({
    where: { tier },
    update: { maxSites: planRowMaxSites(tier), maxHamacasPerSite: spec.maxHamacasPerSite },
    create: { tier, name: spec.name, monthlyPrice: spec.monthlyPrice, maxSites: planRowMaxSites(tier), maxHamacasPerSite: spec.maxHamacasPerSite },
  })
  await prisma.subscription.create({ data: { partnerAccountId: user.id, planId: plan.id, status: 'ACTIVE' } })
  if (custom) {
    await prisma.customSubscription.create({
      data: { partnerAccountId: user.id, maxSites: custom.maxSites ?? null, maxHamacasPerSite: custom.maxHamacasPerSite ?? null },
    })
  }
  return user.id
}

async function seatSite(userId: string, n: number) {
  const site = await createTestSite(userId)
  await prisma.inventoryItem.createMany({
    data: Array.from({ length: n }, (_, i) => ({
      userId, siteId: site.id, number: i + 1, locationLat: '0', locationLng: '0', status: 'active', category: 'standard',
    })),
  })
  return site.id
}

describe('hamaca limits per site (no plan limits today; an agreement can set one)', () => {
  it('no plan limits sunbeds: a Starter site takes any number', async () => {
    const u = await partnerOn('STARTER')
    const site = await seatSite(u, 400)
    expect(await checkHamacaLimit(site, 100)).toMatchObject({ allowed: true, current: 400, limit: null })
    expect((await checkNewSiteHamacas(u, 1000)).allowed).toBe(true)
  })

  it('an agreement limit of 100: 100 hamacas fit, the 101st is refused', async () => {
    const u = await partnerOn('STARTER', { maxHamacasPerSite: 100 })
    const site = await seatSite(u, 99)
    expect(await checkHamacaLimit(site, 1)).toMatchObject({ allowed: true, current: 99, limit: 100 })
    await createTestInventoryItem(u, site, { number: 100 })
    expect(await checkHamacaLimit(site, 1)).toMatchObject({ allowed: false, current: 100, limit: 100, tier: 'STARTER' })
  })

  it('parasols do not count: a SunbedGroup with two seats is 2 hamacas', async () => {
    const u = await partnerOn('STARTER')
    const site = await seatSite(u, 0)
    const parasol = await createTestSunbedGroup(site)
    await createTestInventoryItem(u, site, { number: 1, sunbedGroupId: parasol.id })
    await createTestInventoryItem(u, site, { number: 2, sunbedGroupId: parasol.id })
    expect(await countHamacas(site)).toBe(2)
  })

  it('agreement limits come from the custom subscription record', async () => {
    const u = await partnerOn('BUSINESS', { maxSites: 12, maxHamacasPerSite: 450 })
    const site = await seatSite(u, 450)
    expect(await checkHamacaLimit(site, 1)).toMatchObject({ allowed: false, limit: 450 })
    expect(await checkNewSiteHamacas(u, 450)).toMatchObject({ allowed: true, limit: 450 })
    expect(await canCreateSite(u)).toMatchObject({ maxSites: 12, overridden: true })
  })

  it('an over-limit venue keeps its sunbeds and only cannot add more', async () => {
    const u = await partnerOn('STARTER', { maxHamacasPerSite: 100 })
    const site = await seatSite(u, 150)
    expect(await checkHamacaLimit(site, 0)).toMatchObject({ allowed: true, current: 150 })
    expect(await checkHamacaLimit(site, 1)).toMatchObject({ allowed: false })
    expect(await countHamacas(site)).toBe(150)
  })
})

describe('site limits', () => {
  it('Starter cannot create a second site; Pro stops at 3; Business at 10', async () => {
    const g = await partnerOn('STARTER')
    expect((await canCreateSite(g)).allowed).toBe(true)
    await createTestSite(g)
    expect(await canCreateSite(g)).toMatchObject({ allowed: false, currentCount: 1, maxSites: 1 })

    const t = await partnerOn('PRO')
    for (let i = 0; i < 2; i++) await createTestSite(t)
    expect((await canCreateSite(t)).allowed).toBe(true)
    await createTestSite(t)
    expect(await canCreateSite(t)).toMatchObject({ allowed: false, currentCount: 3, maxSites: 3 })

    const b = await partnerOn('BUSINESS')
    expect(await canCreateSite(b)).toMatchObject({ allowed: true, maxSites: 10 })
  })
})

describe('server-side charge gating', () => {
  it('every plan allows every charge kind, on sites and restaurants', async () => {
    for (const tier of ['STARTER', 'PRO', 'BUSINESS'] as const) {
      const u = await partnerOn(tier)
      const site = await seatSite(u, 1)
      const r = await createTestRestaurant(u)
      for (const kind of ['reservation', 'rental', 'order'] as const) {
        expect((await checkChargeAllowed(kind, { siteId: site })).allowed).toBe(true)
      }
      expect((await checkFoodOrderingAllowed({ siteId: site })).allowed).toBe(true)
      expect((await checkChargeAllowed('tab', { restaurantId: r.id })).allowed).toBe(true)
      expect((await checkChargeAllowed('table-deposit', { restaurantId: r.id })).allowed).toBe(true)
    }
  })

  it('a partner with no subscription is on Starter; an admin feature override wins', async () => {
    const user = await createTestUser()
    await createTestPartnerAccount(user.id)
    const site = await seatSite(user.id, 1)
    const r = await createTestRestaurant(user.id)
    expect((await checkChargeAllowed('reservation', { siteId: site })).allowed).toBe(true)
    await prisma.customSubscription.create({
      data: { partnerAccountId: user.id, featureOverrides: { ONLINE_PAYMENTS: false, FOOD_AND_BEVERAGE: false } },
    })
    expect(await checkChargeAllowed('reservation', { siteId: site })).toMatchObject({ allowed: false, feature: 'ONLINE_PAYMENTS' })
    expect(await checkFoodOrderingAllowed({ siteId: site })).toMatchObject({ allowed: false, feature: 'FOOD_AND_BEVERAGE' })
    expect((await checkChargeAllowed('tab', { siteId: null, restaurantId: r.id })).allowed).toBe(false)
  })

  it('an unknown site fails closed', async () => {
    expect((await checkChargeAllowed('reservation', { siteId: 'nope' })).allowed).toBe(false)
  })
})
