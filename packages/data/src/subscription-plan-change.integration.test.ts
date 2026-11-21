/**
 * setPartnerPlan — the one non-Stripe writer of a partner's plan: a partner may
 * only move itself onto the free plan (Starter), and only while it has no paid
 * Stripe subscription; paid plans go through checkout. A partner's downgrade over
 * Starter's limits is refused. Admin may set any plan (complimentary).
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
      create: { tier, name: spec.name, monthlyPrice: spec.monthlyPrice, maxSites: planRowMaxSites(tier), maxHamacasPerSite: spec.maxHamacasPerSite },
    })
  }
})
afterAll(async () => {
  await disconnectDatabase()
})

async function partnerOn(tier: SubscriptionTier, stripeSubscriptionId: string | null = null) {
  const user = await createTestUser()
  await createTestPartnerAccount(user.id)
  const plan = await prisma.subscriptionPlan.findUniqueOrThrow({ where: { tier } })
  await prisma.subscription.create({
    data: { partnerAccountId: user.id, planId: plan.id, status: 'ACTIVE', stripeSubscriptionId },
  })
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
  it('a partner cannot pick a paid plan here: it goes through checkout', async () => {
    const u = await partnerOn('STARTER')
    expect(await setPartnerPlan(u, 'PRO', 'partner')).toMatchObject({ status: 'error', code: 'needs_checkout' })
    expect(await setPartnerPlan(u, 'BUSINESS', 'partner')).toMatchObject({ status: 'error', code: 'needs_checkout' })
    expect(await tierOf(u)).toBe('STARTER')
  })

  it('a paying partner changes or cancels in the billing portal, not here', async () => {
    const u = await partnerOn('PRO', 'sub_123')
    expect(await setPartnerPlan(u, 'STARTER', 'partner')).toMatchObject({ status: 'error', code: 'manage_billing' })
    expect(await tierOf(u)).toBe('PRO')
  })

  it('a partner on a complimentary paid plan may move itself back to Starter', async () => {
    const u = await partnerOn('PRO')
    await siteWith(u, 80)
    expect(await setPartnerPlan(u, 'STARTER', 'partner')).toMatchObject({ status: 'ok', changed: true })
    expect(await tierOf(u)).toBe('STARTER')
  })

  it('a partner with no subscription row gets one', async () => {
    const user = await createTestUser()
    await createTestPartnerAccount(user.id)
    expect(await setPartnerPlan(user.id, 'STARTER', 'partner')).toMatchObject({ status: 'ok' })
    expect(await tierOf(user.id)).toBe('STARTER')
  })

  it('refuses a partner downgrade over the Starter site limit and names it', async () => {
    const u = await partnerOn('PRO')
    await siteWith(u, 150)
    await siteWith(u, 10)
    const r = await setPartnerPlan(u, 'STARTER', 'partner')
    expect(r).toMatchObject({ status: 'error', code: 'over_limits', issues: { sites: { current: 2, limit: 1 }, hamacas: [] } })
    expect(await tierOf(u)).toBe('PRO')
  })

  it('admin may set any plan without billing, over limits too (existing sites stay)', async () => {
    const u = await partnerOn('PRO')
    await siteWith(u, 150)
    await siteWith(u, 10)
    expect(await setPartnerPlan(u, 'STARTER', 'admin')).toMatchObject({ status: 'ok' })
    expect(await prisma.site.count({ where: { userId: u } })).toBe(2)
    expect(await setPartnerPlan(u, 'BUSINESS', 'admin')).toMatchObject({ status: 'ok', changed: true })
    expect(await tierOf(u)).toBe('BUSINESS')
  })

  it('moving between self-serve plans keeps a custom agreement', async () => {
    const u = await partnerOn('BUSINESS')
    const settings = await createTestSettings()
    await prisma.customSubscription.create({ data: { partnerAccountId: u, maxSites: 20, notes: 'deal' } })
    await prisma.serviceFee.create({
      data: { accountId: u, settingsId: settings.id, serviceCode: 'sunbed-rental', chargeType: 'percentage', percentage: 1 },
    })
    expect(await setPartnerPlan(u, 'PRO', 'admin')).toMatchObject({ status: 'ok', changed: true })
    expect(await prisma.customSubscription.count({ where: { partnerAccountId: u } })).toBe(1)
    expect(await prisma.serviceFee.count({ where: { accountId: u } })).toBe(1)
  })
})
