/**
 * Launch offer (track 027 D9) against real Postgres and the real invoicing path. The offer is a
 * promise about money, so every case is a way it could silently go wrong: commission taken during
 * the free month, a free month that never ends, a test payment burning it, or payment and invoice
 * disagreeing at the 30-day boundary.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./email', () => ({ sendEmail: vi.fn().mockResolvedValue({ id: 'mock-email' }) }))
vi.mock('./reservation-emails', () => ({ sendConfirmationEmail: vi.fn().mockResolvedValue(undefined) }))
vi.mock('./rental-emails', () => ({ sendRentalConfirmationEmail: vi.fn().mockResolvedValue(undefined) }))

import { cleanDatabase, disconnectDatabase, prisma } from './test/setup'
import {
  createTestUser,
  createTestPartnerAccount,
  createTestSite,
  createTestSettings,
  createTestServiceFee,
  createTestInventoryItem,
  createTestReservation,
  createTestOrder,
  createTestOrderItem,
  createTestProduct,
  resetCounter,
} from './test/fixtures'
import { processConfirmedOrder, processConfirmedReservation } from './payment'
import { LAUNCH_PROMOTION } from './promotion'
import { grantLaunchPromotionIfEligible } from './promotion-db'

const DAY = 24 * 60 * 60 * 1000

beforeEach(async () => {
  await cleanDatabase()
  resetCounter()
  process.env.PROMOTION_CLOCK_IN_TEST = '1' // integration tests run off-production
})
afterEach(() => {
  delete process.env.PROMOTION_CLOCK_IN_TEST
})
afterAll(async () => {
  await disconnectDatabase()
})

async function partnerWithSite(opts: { promotion?: { startedAt?: Date; endsAt?: Date; revokedAt?: Date } | null } = {}) {
  const user = await createTestUser()
  await createTestPartnerAccount(user.id)
  const site = await createTestSite(user.id)
  const settings = await createTestSettings()
  await createTestServiceFee(settings.id) // €1.00 per sunbed (fixture default)
  if (opts.promotion !== null) {
    await prisma.partnerPromotion.create({
      data: { partnerAccountId: user.id, code: LAUNCH_PROMOTION.code, grantedBy: 'signup', ...(opts.promotion ?? {}) },
    })
  }
  return { user, site, settings }
}

async function paidReservation(userId: string, siteId: string, overrides: Record<string, unknown> = {}) {
  const a = await createTestInventoryItem(userId, siteId)
  const b = await createTestInventoryItem(userId, siteId)
  return createTestReservation(userId, siteId, [a.id, b.id], { paymentRef: `tr_${Math.random().toString(36).slice(2, 12)}`, ...overrides })
}

const invoicesOf = (reservationId: string) => prisma.invoice.findMany({ where: { reservationId } })
const promotionOf = (userId: string) => prisma.partnerPromotion.findFirstOrThrow({ where: { partnerAccountId: userId } })

describe('reservations during the launch offer', () => {
  it('the first LIVE paid booking is commission-free and starts the 30-day clock', async () => {
    const { user, site } = await partnerWithSite()
    const r = await paidReservation(user.id, site.id)
    const before = Date.now()

    await processConfirmedReservation(r.id)

    const invoices = await invoicesOf(r.id)
    expect(invoices.map((i) => i.issuerType)).toEqual(['PARTNER']) // no PLATFORM commission invoice
    const promo = await promotionOf(user.id)
    expect(promo.startedAt!.getTime()).toBeGreaterThanOrEqual(before)
    expect(promo.endsAt!.getTime() - promo.startedAt!.getTime()).toBe(30 * DAY)
  })

  it('the clock is write-once: a later booking does not move it', async () => {
    const { user, site } = await partnerWithSite()
    await processConfirmedReservation((await paidReservation(user.id, site.id)).id)
    const first = await promotionOf(user.id)

    await processConfirmedReservation((await paidReservation(user.id, site.id)).id)

    expect(await promotionOf(user.id)).toMatchObject({ startedAt: first.startedAt, endsAt: first.endsAt })
  })

  it('bookings created after the window are charged normally', async () => {
    const { user, site } = await partnerWithSite({
      promotion: { startedAt: new Date(Date.now() - 40 * DAY), endsAt: new Date(Date.now() - 10 * DAY) },
    })
    const r = await paidReservation(user.id, site.id)

    await processConfirmedReservation(r.id)

    const platform = (await invoicesOf(r.id)).find((i) => i.issuerType === 'PLATFORM')
    expect(platform?.totalAmount).toBe(2.0) // 2 sunbeds × €1.00
  })

  it('a booking CREATED inside the window stays free even if CONFIRMED after it ends', async () => {
    const endsAt = new Date(Date.now() - 1 * DAY)
    const { user, site } = await partnerWithSite({ promotion: { startedAt: new Date(endsAt.getTime() - 30 * DAY), endsAt } })
    const r = await paidReservation(user.id, site.id, { createdAt: new Date(endsAt.getTime() - 60 * 60 * 1000) })

    await processConfirmedReservation(r.id)

    expect((await invoicesOf(r.id)).map((i) => i.issuerType)).toEqual(['PARTNER'])
  })

  it('a DEMO payment is free but does not start the clock', async () => {
    const { user, site } = await partnerWithSite()
    const r = await paidReservation(user.id, site.id, { paymentRef: 'pi_demo_1730000000' })

    await processConfirmedReservation(r.id)

    expect((await invoicesOf(r.id)).map((i) => i.issuerType)).toEqual(['PARTNER'])
    expect((await promotionOf(user.id)).startedAt).toBeNull()
  })

  it('off production, a Mollie (test-mode) payment never starts the clock', async () => {
    delete process.env.PROMOTION_CLOCK_IN_TEST
    const { user, site } = await partnerWithSite()

    await processConfirmedReservation((await paidReservation(user.id, site.id)).id)

    expect((await promotionOf(user.id)).startedAt).toBeNull()
  })

  it('a revoked offer charges commission again', async () => {
    const { user, site } = await partnerWithSite({ promotion: { revokedAt: new Date() } })
    const r = await paidReservation(user.id, site.id)

    await processConfirmedReservation(r.id)

    expect((await invoicesOf(r.id)).some((i) => i.issuerType === 'PLATFORM')).toBe(true)
  })

  it('partners without the offer are charged as before', async () => {
    const { user, site } = await partnerWithSite({ promotion: null })
    const r = await paidReservation(user.id, site.id)

    await processConfirmedReservation(r.id)

    expect((await invoicesOf(r.id)).some((i) => i.issuerType === 'PLATFORM')).toBe(true)
  })
})

describe('orders follow the same rule', () => {
  it('an F&B order during the offer is commission-free and can start the clock', async () => {
    const { user, site, settings } = await partnerWithSite()
    await createTestServiceFee(settings.id, { serviceCode: 'food-and-beverage' })
    const product = await createTestProduct(site.id)
    const order = await createTestOrder(user.id, site.id, { price: 12, tax: 0, totalPrice: 12, paymentAmount: 12, paymentRef: 'tr_order12345' })
    await createTestOrderItem(order.id, product.id, { name: 'Cocktail', price: 12, tax: 24, totalPrice: 12, quantity: 1 })

    await processConfirmedOrder(order.id)

    expect((await prisma.invoice.findMany({ where: { orderId: order.id } })).map((i) => i.issuerType)).toEqual(['PARTNER'])
    expect((await promotionOf(user.id)).startedAt).not.toBeNull()
  })
})

describe('grantLaunchPromotionIfEligible', () => {
  it('grants new accounts, idempotently', async () => {
    const user = await createTestUser()
    await createTestPartnerAccount(user.id)
    expect(await grantLaunchPromotionIfEligible(user.id)).toBe(true)
    expect(await grantLaunchPromotionIfEligible(user.id)).toBe(true)
    expect(await prisma.partnerPromotion.count({ where: { partnerAccountId: user.id } })).toBe(1)
  })

  it('never grants test accounts or accounts created after the cut-off', async () => {
    const test = await createTestUser()
    await createTestPartnerAccount(test.id)
    await prisma.partnerAccount.update({ where: { userId: test.id }, data: { isTestAccount: true } })
    const late = await createTestUser()
    await createTestPartnerAccount(late.id)
    await prisma.partnerAccount.update({ where: { userId: late.id }, data: { createdAt: LAUNCH_PROMOTION.joinCutoff } })

    expect(await grantLaunchPromotionIfEligible(test.id)).toBe(false)
    expect(await grantLaunchPromotionIfEligible(late.id)).toBe(false)
    expect(await prisma.partnerPromotion.count()).toBe(0)
  })
})
