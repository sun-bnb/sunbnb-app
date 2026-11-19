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
    create: { tier, name: spec.name, monthlyPrice: 0, maxSites: planRowMaxSites(tier), maxHamacasPerSite: spec.maxHamacasPerSite },
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

describe('hamaca limits per site (CR-002)', () => {
  it('Gratis: 100 hamacas fit, the 101st is refused', async () => {
    const u = await partnerOn('GRATIS')
    const site = await seatSite(u, 99)
    expect(await checkHamacaLimit(site, 1)).toMatchObject({ allowed: true, current: 99, limit: 100 })
    await createTestInventoryItem(u, site, { number: 100 })
    expect(await checkHamacaLimit(site, 1)).toMatchObject({ allowed: false, current: 100, limit: 100, tier: 'GRATIS' })
  })

  it('parasols do not count: a SunbedGroup with two seats is 2 hamacas', async () => {
    const u = await partnerOn('GRATIS')
    const site = await seatSite(u, 0)
    const parasol = await createTestSunbedGroup(site)
    await createTestInventoryItem(u, site, { number: 1, sunbedGroupId: parasol.id })
    await createTestInventoryItem(u, site, { number: 2, sunbedGroupId: parasol.id })
    expect(await countHamacas(site)).toBe(2)
  })

  it('Temporada stops at 300', async () => {
    const u = await partnerOn('TEMPORADA')
    const site = await seatSite(u, 300)
    expect(await checkHamacaLimit(site, 1)).toMatchObject({ allowed: false, current: 300, limit: 300 })
    expect(await checkHamacaLimit(site, 0)).toMatchObject({ allowed: true })
  })

  it('Grupo limits come from the custom subscription record', async () => {
    const u = await partnerOn('GRUPO', { maxSites: 12, maxHamacasPerSite: 450 })
    const site = await seatSite(u, 450)
    expect(await checkHamacaLimit(site, 1)).toMatchObject({ allowed: false, limit: 450 })
    expect(await checkNewSiteHamacas(u, 450)).toMatchObject({ allowed: true, limit: 450 })
    expect(await canCreateSite(u)).toMatchObject({ maxSites: 12, overridden: true })
  })

  it('an over-limit venue keeps its sunbeds and only cannot add more', async () => {
    const u = await partnerOn('GRATIS')
    const site = await seatSite(u, 150)
    expect(await countHamacas(site)).toBe(150)
    expect(await checkHamacaLimit(site, 0)).toMatchObject({ allowed: true, current: 150 })
    expect(await checkHamacaLimit(site, 1)).toMatchObject({ allowed: false })
    expect(await countHamacas(site)).toBe(150)
  })

  it('copy site: a Gratis partner cannot create a 101-hamaca site', async () => {
    const u = await partnerOn('GRATIS')
    expect((await checkNewSiteHamacas(u, 100)).allowed).toBe(true)
    expect((await checkNewSiteHamacas(u, 101)).allowed).toBe(false)
  })
})

describe('site limits (CR-002)', () => {
  it('Gratis cannot create a second site; Temporada stops at 3', async () => {
    const g = await partnerOn('GRATIS')
    expect((await canCreateSite(g)).allowed).toBe(true)
    await createTestSite(g)
    expect(await canCreateSite(g)).toMatchObject({ allowed: false, currentCount: 1, maxSites: 1 })

    const t = await partnerOn('TEMPORADA')
    for (let i = 0; i < 2; i++) await createTestSite(t)
    expect((await canCreateSite(t)).allowed).toBe(true)
    await createTestSite(t)
    expect(await canCreateSite(t)).toMatchObject({ allowed: false, currentCount: 3, maxSites: 3 })
  })
})

describe('server-side charge gating (CR-002)', () => {
  it('Gratis site: no online card payment for reservations or rentals, no F&B', async () => {
    const u = await partnerOn('GRATIS')
    const site = await seatSite(u, 1)
    for (const kind of ['reservation', 'rental'] as const) {
      expect(await checkChargeAllowed(kind, { siteId: site })).toMatchObject({ allowed: false, feature: 'ONLINE_PAYMENTS' })
    }
    expect((await checkChargeAllowed('order', { siteId: site })).allowed).toBe(false)
    expect(await checkFoodOrderingAllowed({ siteId: site })).toMatchObject({ allowed: false, feature: 'FOOD_AND_BEVERAGE' })
  })

  it('Gratis restaurant: tabs and table deposits are refused via Restaurant.partnerAccountId', async () => {
    const u = await partnerOn('GRATIS')
    const r = await createTestRestaurant(u)
    expect((await checkChargeAllowed('tab', { siteId: null, restaurantId: r.id })).allowed).toBe(false)
    expect((await checkChargeAllowed('table-deposit', { restaurantId: r.id })).allowed).toBe(false)
  })

  it('Temporada allows every charge kind', async () => {
    const u = await partnerOn('TEMPORADA')
    const site = await seatSite(u, 1)
    const r = await createTestRestaurant(u)
    for (const kind of ['reservation', 'rental', 'order'] as const) {
      expect((await checkChargeAllowed(kind, { siteId: site })).allowed).toBe(true)
    }
    expect((await checkChargeAllowed('tab', { restaurantId: r.id })).allowed).toBe(true)
    expect((await checkChargeAllowed('table-deposit', { restaurantId: r.id })).allowed).toBe(true)
  })

  it('a partner with no subscription is on Gratis; an admin feature override wins', async () => {
    const user = await createTestUser()
    await createTestPartnerAccount(user.id)
    const site = await seatSite(user.id, 1)
    expect((await checkChargeAllowed('reservation', { siteId: site })).allowed).toBe(false)
    await prisma.customSubscription.create({
      data: { partnerAccountId: user.id, featureOverrides: { ONLINE_PAYMENTS: true } },
    })
    expect((await checkChargeAllowed('reservation', { siteId: site })).allowed).toBe(true)
  })

  it('an unknown site fails closed', async () => {
    expect((await checkChargeAllowed('reservation', { siteId: 'nope' })).allowed).toBe(false)
  })
})
