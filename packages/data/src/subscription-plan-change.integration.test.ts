/**
 * setPartnerPlan — the one writer of a partner's plan (2026-11-19):
 * Free ⇄ Pro is self-serve, Business is set up by us in admin only, a partner's
 * downgrade over the lower plan's limits is refused, and leaving Business drops
 * the agreement (CustomSubscription + partner-level ServiceFee rows).
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import type { SubscriptionTier } from '@prisma/client'
import { cleanDatabase, disconnectDatabase, prisma } from './test/setup'
import { createTestUser, createTestPartnerAccount, createTestSite, createTestSettings, resetCounter } from './test/fixtures'
import { PRICING_TIERS, PRICING_TIER_ORDER, planRowMaxSites, setPartnerPlan } from './subscription'

beforeEach(async () => {
  await cleanDatabase()
  resetCounter()
  for (const tier of PRICING_TIER_ORDER) {
    const spec = PRICING_TIERS[tier]
    await prisma.subscriptionPlan.upsert({
      where: { tier },
      update: {},
      create: { tier, name: spec.name, monthlyPrice: 0, maxSites: planRowMaxSites(tier), maxHamacasPerSite: spec.maxHamacasPerSite },
    })
  }
})
afterAll(async () => {
  await disconnectDatabase()
})

async function partnerOn(tier: SubscriptionTier) {
  const user = await createTestUser()
  await createTestPartnerAccount(user.id)
  const plan = await prisma.subscriptionPlan.findUniqueOrThrow({ where: { tier } })
  await prisma.subscription.create({ data: { partnerAccountId: user.id, planId: plan.id, status: 'ACTIVE' } })
  return user.id
}

async function siteWith(userId: string, sunbeds: number) {
  const site = await createTestSite(userId)
  await prisma.inventoryItem.createMany({
    data: Array.from({ length: sunbeds }, (_, i) => ({
      userId, siteId: site.id, number: i + 1, locationLat: '0', locationLng: '0', status: 'active', category: 'standard',
    })),
  })
  return site.id
}

const tierOf = async (userId: string) =>
  (await prisma.subscription.findUniqueOrThrow({ where: { partnerAccountId: userId }, include: { plan: true } })).plan.tier

describe('setPartnerPlan', () => {
  it('a Free partner switches itself to Pro, and back', async () => {
    const u = await partnerOn('GRATIS')
    await siteWith(u, 80)
    expect(await setPartnerPlan(u, 'TEMPORADA', 'partner')).toMatchObject({ status: 'ok', changed: true })
    expect(await tierOf(u)).toBe('TEMPORADA')
    expect(await setPartnerPlan(u, 'GRATIS', 'partner')).toMatchObject({ status: 'ok', changed: true })
    expect(await tierOf(u)).toBe('GRATIS')
  })

  it('a partner with no subscription row gets one', async () => {
    const user = await createTestUser()
    await createTestPartnerAccount(user.id)
    expect(await setPartnerPlan(user.id, 'TEMPORADA', 'partner')).toMatchObject({ status: 'ok' })
    expect(await tierOf(user.id)).toBe('TEMPORADA')
  })

  it('refuses a partner downgrade over the Free limits and names them', async () => {
    const u = await partnerOn('TEMPORADA')
    const big = await siteWith(u, 150)
    await siteWith(u, 10)
    const r = await setPartnerPlan(u, 'GRATIS', 'partner')
    expect(r).toMatchObject({
      status: 'error',
      code: 'over_limits',
      issues: { sites: { current: 2, limit: 1 }, hamacas: [{ siteId: big, current: 150, limit: 100 }] },
    })
    expect(await tierOf(u)).toBe('TEMPORADA')
  })

  it('a partner can neither pick Business nor leave it', async () => {
    const free = await partnerOn('GRATIS')
    expect(await setPartnerPlan(free, 'GRUPO', 'partner')).toMatchObject({ status: 'error', code: 'not_self_serve' })
    expect(await tierOf(free)).toBe('GRATIS')

    const business = await partnerOn('GRUPO')
    expect(await setPartnerPlan(business, 'TEMPORADA', 'partner')).toMatchObject({ status: 'error', code: 'custom_agreement' })
    expect(await tierOf(business)).toBe('GRUPO')
  })

  it('admin may put a partner over Free limits onto Free (existing sites stay)', async () => {
    const u = await partnerOn('TEMPORADA')
    await siteWith(u, 150)
    await siteWith(u, 10)
    expect(await setPartnerPlan(u, 'GRATIS', 'admin')).toMatchObject({ status: 'ok' })
    expect(await prisma.site.count({ where: { userId: u } })).toBe(2)
  })

  it('admin moves a partner onto Business, and leaving it drops the agreement', async () => {
    const u = await partnerOn('GRATIS')
    expect(await setPartnerPlan(u, 'GRUPO', 'admin')).toMatchObject({ status: 'ok' })
    const settings = await createTestSettings()
    await prisma.customSubscription.create({ data: { partnerAccountId: u, maxSites: 20, notes: 'deal' } })
    await prisma.serviceFee.create({
      data: { accountId: u, settingsId: settings.id, serviceCode: 'sunbed-rental', chargeType: 'percentage', percentage: 1 },
    })

    expect(await setPartnerPlan(u, 'TEMPORADA', 'admin')).toMatchObject({ status: 'ok', changed: true })
    expect(await tierOf(u)).toBe('TEMPORADA')
    expect(await prisma.customSubscription.count({ where: { partnerAccountId: u } })).toBe(0)
    expect(await prisma.serviceFee.count({ where: { accountId: u } })).toBe(0)
  })
})
