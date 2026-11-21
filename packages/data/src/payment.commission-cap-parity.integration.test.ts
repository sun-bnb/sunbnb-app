/**
 * The commission cap machinery (CR-002: EUR 199 / site / month on 2%; no published plan has a cap
 * today, so a capped plan row is set up here), pinned across
 * EVERY charge path and the PLATFORM invoice to the cent. Charge sides: the checkout intent
 * (Viva online `isvAmount` and Stripe `application_fee_amount` both take `intent.applicationFee`;
 * Stripe adds its processing pass-through on top as a separate line), the body actually sent to
 * Mollie, and the PLATFORM invoice written by `processConfirmed*`. All read one ledger entry.
 */
import { describe, it, expect, beforeEach, afterAll, afterEach, vi } from 'vitest'

vi.mock('./email', () => ({ sendEmail: vi.fn().mockResolvedValue({ id: 'mock-email' }) }))
vi.mock('./reservation-emails', () => ({ sendConfirmationEmail: vi.fn().mockResolvedValue(undefined) }))
vi.mock('./rental-emails', () => ({ sendRentalConfirmationEmail: vi.fn().mockResolvedValue(undefined) }))
vi.mock('./mollie-tokens', () => ({ getValidMollieToken: vi.fn().mockResolvedValue('access_tok') }))

import type { SubscriptionTier } from '@prisma/client'
import { cleanDatabase, disconnectDatabase, prisma } from './test/setup'
import {
  createTestUser,
  createTestPartnerAccount,
  createTestSite,
  createTestSettings,
  createTestServiceFee,
  createTestInventoryItem,
  createTestReservation,
  createTestRentalItem,
  createTestRentalBooking,
  resetCounter,
} from './test/fixtures'
import { createReservationMolliePayment } from './reservation-payment'
import { createRentalBookingMolliePayment } from './rental-payment'
import { resolveCheckoutIntent } from './checkout'
import {
  processConfirmedReservation,
  processConfirmedRentalBooking,
  resolveServiceFee,
  calculateServiceFeeAmount,
} from './payment'
import { capMonthKey, CAP_ENTRY_STATUS, releaseAbandonedCapEntries } from './commission-cap'
import { PRICING_TIERS, PRICING_TIER_ORDER, COMMISSIONED_SERVICE_CODES } from './pricing-tiers'

const OPTS = { redirectUrl: 'https://x/r', webhookUrl: 'https://x/w' }

beforeEach(async () => {
  await cleanDatabase()
  await prisma.commissionCapEntry.deleteMany({})
  resetCounter()
})
afterEach(() => vi.unstubAllGlobals())
afterAll(async () => {
  await disconnectDatabase()
})

function stubMollie(paymentId: string) {
  let sent = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body)
      sent = body.applicationFee ? Number(body.applicationFee.amount.value) : 0
      return new Response(
        JSON.stringify({ id: paymentId, _links: { checkout: { href: 'https://mollie/checkout' } } }),
        { status: 201 },
      )
    }),
  )
  return () => sent
}

/**
 * A partner on a CAPPED plan: the cap machinery stays for later even though no
 * published plan has a cap today, so the plan row is given the CR-002 terms
 * explicitly (2% on sunbeds + rentals, 0% F&B, EUR 199 per site per month).
 */
const CAPPED_RATES: Record<string, number> = { 'sunbed-rental': 2, 'equipment-rental': 2, 'food-and-beverage': 0 }
async function cappedPlanSite(accountFee?: Record<string, unknown>) {
  const user = await createTestUser()
  await createTestPartnerAccount(user.id, { mollieAccessToken: 'tok', mollieProfileId: 'pfl_1' })
  const plan = await prisma.subscriptionPlan.upsert({
    where: { tier: 'PRO' },
    create: { tier: 'PRO', name: 'Pro', monthlyPrice: 29, maxSites: 3, monthlyCommissionCapPerSite: 199 },
    update: { monthlyCommissionCapPerSite: 199 },
  })
  await prisma.subscription.create({ data: { partnerAccountId: user.id, planId: plan.id } })
  const site = await createTestSite(user.id, { vat: 21, rentalVat: 21 })
  const settings = await createTestSettings()
  for (const code of COMMISSIONED_SERVICE_CODES) {
    await createTestServiceFee(settings.id, {
      serviceCode: code, chargeType: 'percentage', feeAmount: null,
      percentage: CAPPED_RATES[code], subscriptionTier: 'PRO',
    })
  }
  if (accountFee) {
    await prisma.serviceFee.create({ data: { settingsId: settings.id, accountId: user.id, ...accountFee } as never })
  }
  return { user, site }
}

async function usedBefore(siteId: string, amount: number, month = capMonthKey(new Date())) {
  await prisma.commissionCapEntry.create({
    data: { siteId, month, sourceKey: `reservation:seed-${month}-${amount}`, uncappedAmount: amount, amount, status: CAP_ENTRY_STATUS.TAKEN },
  })
}

/** Run every charge path + the invoice for one EUR `total` reservation; return what each took. */
async function reservationAllPaths(userId: string, siteId: string, total: number, ref: string) {
  const a = await createTestInventoryItem(userId, siteId, { number: Math.floor(Math.random() * 1e6) })
  const res = await createTestReservation(userId, siteId, [a.id], { paymentAmount: total, paymentRef: null })

  const viva = await resolveCheckoutIntent({ provider: 'viva', kind: 'reservation', reservationId: res.id, ...OPTS })
  const stripe = await resolveCheckoutIntent({ provider: 'stripe', kind: 'reservation', reservationId: res.id, ...OPTS })
  if (viva.status !== 'ok' || stripe.status !== 'ok') throw new Error('intent failed')
  const sent = stubMollie(ref)
  expect((await createReservationMolliePayment(res.id, OPTS)).status).toBe('ok')
  await processConfirmedReservation(res.id)
  const platform = await prisma.invoice.findFirst({ where: { reservationId: res.id, issuerType: 'PLATFORM' } })
  return {
    viva: viva.intent.applicationFee,
    stripe: stripe.intent.applicationFee,
    mollie: sent(),
    invoice: platform?.totalAmount ?? 0,
  }
}

describe('commission cap (capped plan): collected === invoiced', () => {
  it('EUR 100 online takes EUR 2.00 on Mollie, Stripe, Viva and the invoice', async () => {
    const { user, site } = await cappedPlanSite()
    const r = await reservationAllPaths(user.id, site.id, 100, 'tr_cap1')
    console.log('[cap] EUR 100 on the capped plan →', JSON.stringify(r))
    expect(r).toEqual({ viva: 2, stripe: 2, mollie: 2, invoice: 2 })
  })

  it('a site already at EUR 199 this month takes 0 everywhere (no PLATFORM invoice)', async () => {
    const { user, site } = await cappedPlanSite()
    await usedBefore(site.id, 199)
    const r = await reservationAllPaths(user.id, site.id, 100, 'tr_cap2')
    console.log('[cap] at EUR 199 →', JSON.stringify(r))
    expect(r).toEqual({ viva: 0, stripe: 0, mollie: 0, invoice: 0 })
  })

  it('a booking crossing the cap takes only the headroom (EUR 198.50 used → 0.50)', async () => {
    const { user, site } = await cappedPlanSite()
    await usedBefore(site.id, 198.5)
    const r = await reservationAllPaths(user.id, site.id, 100, 'tr_cap3')
    console.log('[cap] crossing →', JSON.stringify(r))
    expect(r).toEqual({ viva: 0.5, stripe: 0.5, mollie: 0.5, invoice: 0.5 })
  })

  it('the next month restarts: EUR 199 last month does not cap this month', async () => {
    const { user, site } = await cappedPlanSite()
    await usedBefore(site.id, 199, capMonthKey(new Date(Date.now() - 40 * 24 * 3600 * 1000)))
    const r = await reservationAllPaths(user.id, site.id, 100, 'tr_cap4')
    console.log('[cap] next month →', JSON.stringify(r))
    expect(r).toEqual({ viva: 2, stripe: 2, mollie: 2, invoice: 2 })
  })

  it('the cap is per site: a second site of the same partner is unaffected', async () => {
    const { user, site } = await cappedPlanSite()
    await usedBefore(site.id, 199)
    const other = await createTestSite(user.id, { vat: 21 })
    const r = await reservationAllPaths(user.id, other.id, 100, 'tr_cap5')
    expect(r).toEqual({ viva: 2, stripe: 2, mollie: 2, invoice: 2 })
  })

  it('rentals share the site cap: at EUR 199 a rental takes 0 on intent, Mollie and invoice', async () => {
    const { user, site } = await cappedPlanSite()
    await usedBefore(site.id, 199)
    const item = await createTestRentalItem(site.id, { name: 'Board' })
    const b = await createTestRentalBooking(user.id, site.id, item.id, {
      status: 'pending', paymentRef: null, paymentAmount: 100, totalPrice: 100,
    })
    const intent = await resolveCheckoutIntent({ provider: 'viva', kind: 'rental', rentalBookingIds: [b.id], ...OPTS })
    if (intent.status !== 'ok') throw new Error('intent failed')
    const sent = stubMollie('tr_cap6')
    expect((await createRentalBookingMolliePayment([b.id], OPTS)).status).toBe('ok')
    await processConfirmedRentalBooking('tr_cap6')
    const platform = await prisma.invoice.findFirst({ where: { paymentRef: 'tr_cap6', issuerType: 'PLATFORM' } })
    expect([intent.intent.applicationFee, sent(), platform?.totalAmount ?? 0]).toEqual([0, 0, 0])
  })

  it('a rental of EUR 100 below the cap takes 2.00 on every side', async () => {
    const { user, site } = await cappedPlanSite()
    const item = await createTestRentalItem(site.id, { name: 'Kayak' })
    const b = await createTestRentalBooking(user.id, site.id, item.id, {
      status: 'pending', paymentRef: null, paymentAmount: 100, totalPrice: 100,
    })
    const intent = await resolveCheckoutIntent({ provider: 'viva', kind: 'rental', rentalBookingIds: [b.id], ...OPTS })
    if (intent.status !== 'ok') throw new Error('intent failed')
    const sent = stubMollie('tr_cap7')
    expect((await createRentalBookingMolliePayment([b.id], OPTS)).status).toBe('ok')
    await processConfirmedRentalBooking('tr_cap7')
    const platform = await prisma.invoice.findFirstOrThrow({ where: { paymentRef: 'tr_cap7', issuerType: 'PLATFORM' } })
    expect([intent.intent.applicationFee, sent(), platform.totalAmount]).toEqual([2, 2, 2])
  })

  it('a negotiated account fee wins the cascade and is NOT capped (5% at the cap → 5.00)', async () => {
    const { user, site } = await cappedPlanSite({ serviceCode: 'sunbed-rental', chargeType: 'percentage', percentage: 5, feeAmount: null })
    await usedBefore(site.id, 199)
    const r = await reservationAllPaths(user.id, site.id, 100, 'tr_cap8')
    console.log('[cap] negotiated 5% at cap →', JSON.stringify(r))
    expect(r).toEqual({ viva: 5, stripe: 5, mollie: 5, invoice: 5 })
  })

  it('an abandoned charge gives its headroom back via the cleanup sweep', async () => {
    const { user, site } = await cappedPlanSite()
    await usedBefore(site.id, 190)
    const a = await createTestInventoryItem(user.id, site.id, { number: 1 })
    const res = await createTestReservation(user.id, site.id, [a.id], { paymentAmount: 500, paymentRef: null })
    const first = await resolveCheckoutIntent({ provider: 'viva', kind: 'reservation', reservationId: res.id, ...OPTS })
    if (first.status !== 'ok') throw new Error('intent failed')
    expect(first.intent.applicationFee).toBe(9)
    await prisma.reservation.delete({ where: { id: res.id } }) // the stale-booking cron deleted it
    expect(await releaseAbandonedCapEntries(0)).toBe(1)
    const b = await createTestReservation(user.id, site.id, [a.id], { paymentAmount: 500, paymentRef: null })
    const again = await resolveCheckoutIntent({ provider: 'viva', kind: 'reservation', reservationId: b.id, ...OPTS })
    if (again.status !== 'ok') throw new Error('intent failed')
    expect(again.intent.applicationFee).toBe(9)
  })
})

describe('CR-002 (M-68): card at the venue takes 0 commission and never touches the cap', () => {
  /** A completed card-present reservation of EUR `total`, invoiced through processConfirmedReservation. */
  async function cardPresent(userId: string, siteId: string, total: number, ref: string) {
    const a = await createTestInventoryItem(userId, siteId, { number: Math.floor(Math.random() * 1e6) })
    const res = await createTestReservation(userId, siteId, [a.id], { paymentAmount: total, paymentRef: ref, status: 'processing' })
    await processConfirmedReservation(res.id)
    const platform = await prisma.invoice.findFirst({ where: { reservationId: res.id, issuerType: 'PLATFORM' } })
    const partner = await prisma.invoice.findFirstOrThrow({ where: { reservationId: res.id, issuerType: 'PARTNER' } })
    return { res, platform, partner }
  }

  it('Viva terminal (viva_): PARTNER invoice gross, NO PLATFORM invoice, no cap entry', async () => {
    const { user, site } = await cappedPlanSite()
    const { res, platform, partner } = await cardPresent(user.id, site.id, 100, 'viva_sess-cardpresent-1')
    expect(partner.totalAmount).toBe(100)
    expect(platform).toBeNull() // collected (ISV fee 0) === invoiced (0)
    expect(await prisma.commissionCapEntry.count({ where: { sourceKey: `reservation:${res.id}` } })).toBe(0)
    expect(await prisma.commissionCapEntry.count({ where: { siteId: site.id } })).toBe(0)
  })

  it('Tap to Pay (stripe_pi_): PLATFORM invoice carries the processing pass-through only, no commission, no cap entry', async () => {
    const { user, site } = await cappedPlanSite()
    const { platform } = await cardPresent(user.id, site.id, 100, 'stripe_pi_cardpresent_1')
    // A Stripe ref still gets a processing-only PLATFORM invoice; its whole total is the pass-through.
    expect(platform).not.toBeNull()
    expect(platform!.processingFee).toBeGreaterThan(0)
    expect(platform!.totalAmount).toBe(platform!.processingFee)
    expect(await prisma.commissionCapEntry.count({ where: { siteId: site.id } })).toBe(0)
  })

  it('card-present sales leave the month\'s headroom intact: EUR 198 used + a EUR 500 card sale → the next online booking still takes the EUR 1.00 headroom', async () => {
    const { user, site } = await cappedPlanSite()
    await usedBefore(site.id, 198)
    await cardPresent(user.id, site.id, 500, 'viva_sess-cardpresent-2')
    await cardPresent(user.id, site.id, 500, 'stripe_pi_cardpresent_2')
    const r = await reservationAllPaths(user.id, site.id, 100, 'tr_cap9')
    expect(r).toEqual({ viva: 1, stripe: 1, mollie: 1, invoice: 1 })
  })

  it('even a negotiated account fee is not charged on card at the venue', async () => {
    const { user, site } = await cappedPlanSite({ serviceCode: 'sunbed-rental', chargeType: 'percentage', percentage: 5, feeAmount: null })
    const { platform } = await cardPresent(user.id, site.id, 100, 'viva_sess-cardpresent-3')
    expect(platform).toBeNull()
  })
})

describe('plan rates: the same % on F&B as on sunbeds; negotiated fees still win', () => {
  const platformRows = PRICING_TIER_ORDER.flatMap((tier) =>
    COMMISSIONED_SERVICE_CODES.map((code) => ({
      siteId: null, accountId: null, serviceCode: code, subscriptionTier: tier as SubscriptionTier,
      chargeType: 'percentage', percentage: PRICING_TIERS[tier].commissionPercent[code], feeAmount: null,
    })),
  ) as never[]

  it.each(PRICING_TIER_ORDER)('%s: a EUR 100 F&B order takes the plan rate', (tier) => {
    const fee = resolveServiceFee([], [], platformRows, 'food-and-beverage', tier)
    expect(calculateServiceFeeAmount(fee, 100)).toBe(PRICING_TIERS[tier].commissionPercent['sunbed-rental'])
  })

  it('a site fee beats an account fee beats the plan rate', () => {
    const site = [{ siteId: 's', accountId: null, serviceCode: 'sunbed-rental', chargeType: 'percentage', percentage: 1, feeAmount: null }] as never[]
    const account = [{ siteId: null, accountId: 'a', serviceCode: 'sunbed-rental', chargeType: 'percentage', percentage: 4, feeAmount: null }] as never[]
    expect(calculateServiceFeeAmount(resolveServiceFee(site, account, platformRows, 'sunbed-rental', 'PRO'), 100)).toBe(1)
    expect(calculateServiceFeeAmount(resolveServiceFee([], account, platformRows, 'sunbed-rental', 'PRO'), 100)).toBe(4)
    expect(calculateServiceFeeAmount(resolveServiceFee([], [], platformRows, 'sunbed-rental', 'PRO'), 100)).toBe(3)
  })
})
