/**
 * Invariant (track 028, founder decision 2026-10-08): the commission COLLECTED at charge time
 * (Mollie applicationFee / checkout intent fee) equals the commission INVOICED (PLATFORM
 * invoice). Both sides go through `serviceFeeForUnits`: fixed fee per unit (bed / rental booking
 * line), percentage once on the total paid. Each case pins BOTH real code paths to one number —
 * it is not a re-test of the helper. Before the fix the invoice side summed per item
 * (fixed fee × beds correct only by luck of loop, percentage rounded per item) while the
 * charge side computed one fee on the total.
 */
import { describe, it, expect, beforeEach, afterAll, afterEach, vi } from 'vitest'

vi.mock('./email', () => ({ sendEmail: vi.fn().mockResolvedValue({ id: 'mock-email' }) }))
vi.mock('./reservation-emails', () => ({ sendConfirmationEmail: vi.fn().mockResolvedValue(undefined) }))
vi.mock('./rental-emails', () => ({ sendRentalConfirmationEmail: vi.fn().mockResolvedValue(undefined) }))
vi.mock('./mollie-tokens', () => ({ getValidMollieToken: vi.fn().mockResolvedValue('access_tok') }))

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
import { processConfirmedReservation, processConfirmedRentalBooking } from './payment'

const OPTS = { redirectUrl: 'https://x/r', webhookUrl: 'https://x/w' }

beforeEach(async () => {
  await cleanDatabase()
  resetCounter()
})
afterEach(() => vi.unstubAllGlobals())
afterAll(async () => {
  await disconnectDatabase()
})

/** Stub Mollie; returns a getter for the applicationFee value (or 0) sent in the create body. */
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

async function partnerWithFee(code: string, fee: Record<string, unknown>) {
  const user = await createTestUser()
  await createTestPartnerAccount(user.id, { mollieAccessToken: 'tok', mollieProfileId: 'pfl_1' })
  const site = await createTestSite(user.id, { vat: 25.5, rentalVat: 25.5 })
  const settings = await createTestSettings()
  await createTestServiceFee(settings.id, { serviceCode: code, ...fee })
  return { user, site }
}

async function twoBedReservation(fee: Record<string, unknown>, total: number) {
  const { user, site } = await partnerWithFee('sunbed-rental', fee)
  const a = await createTestInventoryItem(user.id, site.id, { number: 1 })
  const b = await createTestInventoryItem(user.id, site.id, { number: 2 })
  const res = await createTestReservation(user.id, site.id, [a.id, b.id], {
    paymentAmount: total,
    paymentRef: null,
  })
  return res
}

describe('reservation: collected commission === invoiced commission', () => {
  it.each([
    ['fixed 1.00 per bed, 2 beds', { chargeType: 'fixed', feeAmount: 1.0 }, 20, 2.0],
    ['1.5% once on the total (14.00)', { chargeType: 'percentage', percentage: 1.5, feeAmount: null }, 14, 0.21],
  ])('%s', async (_label, fee, total, expected) => {
    const res = await twoBedReservation(fee, total)

    // Charge side 1: checkout intent (Stripe / Viva / generic adapters).
    const intent = await resolveCheckoutIntent({
      provider: 'viva', kind: 'reservation', reservationId: res.id, ...OPTS,
    })
    if (intent.status !== 'ok') throw new Error('intent failed')
    expect(intent.intent.applicationFee).toBe(expected)

    // Charge side 2: the body actually sent to Mollie.
    const sent = stubMollie('tr_parity1')
    const created = await createReservationMolliePayment(res.id, OPTS)
    expect(created.status).toBe('ok')
    expect(sent()).toBe(expected)

    // Invoice side.
    await processConfirmedReservation(res.id)
    const platform = await prisma.invoice.findFirstOrThrow({
      where: { reservationId: res.id, issuerType: 'PLATFORM' },
    })
    expect(platform.totalAmount).toBe(expected)
    expect(platform.totalAmount).toBe(sent())
  })
})

describe('rental: collected commission === invoiced commission', () => {
  it('fixed 0.50 per booking line, 3 bookings', async () => {
    const { user, site } = await partnerWithFee('equipment-rental', { chargeType: 'fixed', feeAmount: 0.5 })
    const item = await createTestRentalItem(site.id, { name: 'Board' })
    const ids: string[] = []
    for (let i = 0; i < 3; i++) {
      const b = await createTestRentalBooking(user.id, site.id, item.id, {
        status: 'pending', paymentRef: null, paymentAmount: 5.0, totalPrice: 5.0,
      })
      ids.push(b.id)
    }

    const intent = await resolveCheckoutIntent({
      provider: 'viva', kind: 'rental', rentalBookingIds: ids, ...OPTS,
    })
    if (intent.status !== 'ok') throw new Error('intent failed')
    expect(intent.intent.applicationFee).toBe(1.5)

    const sent = stubMollie('tr_parity2')
    const created = await createRentalBookingMolliePayment(ids, OPTS)
    expect(created.status).toBe('ok')
    expect(sent()).toBe(1.5)

    await processConfirmedRentalBooking('tr_parity2')
    const platform = await prisma.invoice.findFirstOrThrow({
      where: { paymentRef: 'tr_parity2', issuerType: 'PLATFORM' },
    })
    expect(platform.totalAmount).toBe(1.5)
    expect(platform.totalAmount).toBe(sent())
  })
})
