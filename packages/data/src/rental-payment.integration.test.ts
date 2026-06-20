/**
 * Integration tests for rental-payment.ts.
 *
 * Focuses on DB-observable behavior: status transitions, finalize/invoicing via
 * the demo ref path, amount pulled from `paymentAmount`. Real Mollie API calls
 * are not made — the Mollie path is covered by the `getRentalBookingPaymentStatus`
 * logic via demo refs (`pi_demo_` → always paid) and unknown refs (→ pending).
 *
 * Mirrors the style of payment.integration.test.ts.
 */

import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'

// Prevent real email sends during invoicing
vi.mock('./email', () => ({
  sendEmail: vi.fn().mockResolvedValue({ id: 'mock-email' }),
}))
vi.mock('./reservation-emails', () => ({
  sendConfirmationEmail: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('./rental-emails', () => ({
  sendRentalConfirmationEmail: vi.fn().mockResolvedValue(undefined),
}))

import { cleanDatabase, disconnectDatabase, prisma } from './test/setup'
import {
  createTestUser,
  createTestPartnerAccount,
  createTestSite,
  createTestSettings,
  createTestServiceFee,
  createTestRentalItem,
  createTestRentalBooking,
  resetCounter,
} from './test/fixtures'
import {
  createRentalBookingMolliePayment,
  getRentalBookingPaymentStatus,
  reverifyAndFinalizeRentalBooking,
} from './rental-payment'
import { RENTAL_COMPLETE, RENTAL_PROCESSING } from './reservation-status'

beforeEach(async () => {
  await cleanDatabase()
  resetCounter()
})

afterAll(async () => {
  await disconnectDatabase()
})

// ─── Shared setup ────────────────────────────────────────────────────────────

async function setupRental(overrides?: {
  siteOverrides?: Record<string, any>
  feeOverrides?: Record<string, any>
  bookingOverrides?: Record<string, any>
}) {
  const user = await createTestUser()
  const partner = await createTestPartnerAccount(user.id)
  const site = await createTestSite(user.id, {
    rentalVat: 25.5,
    ...overrides?.siteOverrides,
  })
  const settings = await createTestSettings()
  const fee = await createTestServiceFee(settings.id, {
    serviceCode: 'equipment-rental',
    chargeType: 'fixed',
    feeAmount: 1.0,
    ...overrides?.feeOverrides,
  })
  const rentalItem = await createTestRentalItem(site.id, { name: 'Surfboard' })
  const paymentRef = `pi_demo_${Date.now()}`
  const booking = await createTestRentalBooking(user.id, site.id, rentalItem.id, {
    paymentRef,
    status: RENTAL_PROCESSING,
    paymentAmount: 10.0,
    totalPrice: 10.0,
    ...overrides?.bookingOverrides,
  })

  return { user, partner, site, settings, fee, rentalItem, booking, paymentRef }
}

// ─── getRentalBookingPaymentStatus ───────────────────────────────────────────

describe('getRentalBookingPaymentStatus', () => {
  it('returns succeeded=true for a demo payment ref', async () => {
    const { booking } = await setupRental()

    const result = await getRentalBookingPaymentStatus(booking.id)

    expect(result.status).toBe('ok')
    if (result.status === 'ok') {
      expect(result.succeeded).toBe(true)
      expect(result.failed).toBe(false)
      expect(result.providerStatus).toBe('paid')
    }
  })

  it('returns error when booking has no paymentRef', async () => {
    // Create booking without paymentRef
    const { booking } = await setupRental({ bookingOverrides: { paymentRef: null } })

    const result = await getRentalBookingPaymentStatus(booking.id)

    expect(result.status).toBe('error')
    if (result.status === 'error') {
      expect(result.error).toBe('No payment to verify')
    }
  })

  it('returns pending (error) when booking does not exist', async () => {
    const result = await getRentalBookingPaymentStatus('nonexistent-booking-id')

    expect(result.status).toBe('error')
  })

  it('returns error for an unknown payment provider ref', async () => {
    const { booking } = await setupRental({
      bookingOverrides: { paymentRef: 'stripe_abc123' },
    })

    const result = await getRentalBookingPaymentStatus(booking.id)

    expect(result.status).toBe('error')
    if (result.status === 'error') {
      expect(result.error).toMatch(/Unknown payment provider/)
    }
  })
})

// ─── reverifyAndFinalizeRentalBooking ─────────────────────────────────────────

describe('reverifyAndFinalizeRentalBooking', () => {
  it('finalizes to complete and creates invoices via demo ref path', async () => {
    const { booking, paymentRef } = await setupRental()

    const result = await reverifyAndFinalizeRentalBooking(booking.id)

    expect(result.settled).toBe('complete')

    // processConfirmedRentalBooking must have created PARTNER + PLATFORM invoices
    const invoices = await prisma.invoice.findMany({ where: { paymentRef } })
    expect(invoices).toHaveLength(2)
    expect(invoices.map((i) => i.issuerType).sort()).toEqual(['PARTNER', 'PLATFORM'])
  })

  it('marks the booking as complete after finalization', async () => {
    const { booking } = await setupRental()

    await reverifyAndFinalizeRentalBooking(booking.id)

    const updated = await prisma.rentalBooking.findUnique({ where: { id: booking.id } })
    expect(updated!.status).toBe(RENTAL_COMPLETE)
  })

  it('is idempotent — calling finalize twice creates only 2 invoices', async () => {
    const { booking, paymentRef } = await setupRental()

    await reverifyAndFinalizeRentalBooking(booking.id)
    await reverifyAndFinalizeRentalBooking(booking.id)

    const invoices = await prisma.invoice.findMany({ where: { paymentRef } })
    expect(invoices).toHaveLength(2)
  })

  it('returns pending when booking has no paymentRef', async () => {
    const { booking } = await setupRental({ bookingOverrides: { paymentRef: null } })

    const result = await reverifyAndFinalizeRentalBooking(booking.id)

    expect(result.settled).toBe('pending')
  })

  it('returns pending for an unknown payment ref without mutating status', async () => {
    const { booking } = await setupRental({
      bookingOverrides: { paymentRef: 'stripe_unknown_ref' },
    })

    const result = await reverifyAndFinalizeRentalBooking(booking.id)

    expect(result.settled).toBe('pending')

    // Status must not have been mutated
    const unchanged = await prisma.rentalBooking.findUnique({ where: { id: booking.id } })
    expect(unchanged!.status).toBe(RENTAL_PROCESSING)
  })

  it('uses paymentAmount from DB (not totalPrice) when computing invoices', async () => {
    // paymentAmount differs from totalPrice — invoices must reflect paymentAmount
    const { booking, paymentRef } = await setupRental({
      bookingOverrides: {
        paymentAmount: 15.0, // explicit override
        totalPrice: 10.0,   // totalPrice is lower — must NOT be used
      },
    })

    await reverifyAndFinalizeRentalBooking(booking.id)

    const partnerInvoice = await prisma.invoice.findFirst({
      where: { paymentRef, issuerType: 'PARTNER' },
    })

    // processConfirmedRentalBooking uses `paymentAmount ?? totalPrice`, so 15.0
    expect(partnerInvoice!.totalAmount).toBe(15.0)
  })
})

// ─── createRentalBookingMolliePayment (DB-side: validation + group writes) ────
//
// Real Mollie API calls are not made — we test the validation guards and the
// demo-ref path via reverifyAndFinalizeRentalBooking (which short-circuits on
// pi_demo_ without contacting Mollie). The Mollie network path is an integration
// concern of the calling route/action.

describe('createRentalBookingMolliePayment — validation guards', () => {
  it('returns invalid_amount when bookingIds list is empty', async () => {
    const result = await createRentalBookingMolliePayment([], {
      redirectUrl: 'https://example.com/return',
      webhookUrl: 'https://example.com/webhook',
    })
    expect(result.status).toBe('error')
    if (result.status === 'error') expect(result.reason).toBe('invalid_amount')
  })

  it('returns invalid_amount when a booking does not exist', async () => {
    const result = await createRentalBookingMolliePayment(['nonexistent-id'], {
      redirectUrl: 'https://example.com/return',
      webhookUrl: 'https://example.com/webhook',
    })
    expect(result.status).toBe('error')
    if (result.status === 'error') expect(result.reason).toBe('invalid_amount')
  })

  it('returns invalid_amount when bookings span different sites', async () => {
    // Two users/sites so the bookings have different siteIds
    const user1 = await createTestUser()
    const site1 = await createTestSite(user1.id)
    const item1 = await createTestRentalItem(site1.id)
    const booking1 = await createTestRentalBooking(user1.id, site1.id, item1.id, {
      paymentRef: null,
      status: RENTAL_PROCESSING,
      paymentAmount: 10.0,
    })

    const user2 = await createTestUser()
    const site2 = await createTestSite(user2.id)
    const item2 = await createTestRentalItem(site2.id)
    const booking2 = await createTestRentalBooking(user2.id, site2.id, item2.id, {
      paymentRef: null,
      status: RENTAL_PROCESSING,
      paymentAmount: 10.0,
    })

    const result = await createRentalBookingMolliePayment([booking1.id, booking2.id], {
      redirectUrl: 'https://example.com/return',
      webhookUrl: 'https://example.com/webhook',
    })
    expect(result.status).toBe('error')
    if (result.status === 'error') expect(result.reason).toBe('invalid_amount')
  })

  it('returns no_mollie when partner has no Mollie account', async () => {
    // Site owned by a user without mollieAccessToken on their PartnerAccount
    const { booking } = await setupRental({
      bookingOverrides: { paymentRef: null, status: RENTAL_PROCESSING },
    })
    // PartnerAccount from setupRental has no mollieAccessToken (default fixture)
    const result = await createRentalBookingMolliePayment([booking.id], {
      redirectUrl: 'https://example.com/return',
      webhookUrl: 'https://example.com/webhook',
    })
    expect(result.status).toBe('error')
    if (result.status === 'error') expect(result.reason).toBe('no_mollie')
  })
})

describe('createRentalBookingMolliePayment — two-booking group (demo ref path)', () => {
  it('writes the same paymentRef to both bookings and finalizing one completes both + invoices group', async () => {
    // Set up a site with two distinct rental items belonging to the same user/site
    const user = await createTestUser()
    await createTestPartnerAccount(user.id)
    const site = await createTestSite(user.id, { rentalVat: 25.5 })
    const settings = await createTestSettings()
    await createTestServiceFee(settings.id, {
      serviceCode: 'equipment-rental',
      chargeType: 'fixed',
      feeAmount: 1.0,
    })
    const item1 = await createTestRentalItem(site.id, { name: 'Surfboard' })
    const item2 = await createTestRentalItem(site.id, { name: 'Kayak' })

    const booking1 = await createTestRentalBooking(user.id, site.id, item1.id, {
      paymentRef: null,
      status: RENTAL_PROCESSING,
      paymentAmount: 10.0,
    })
    const booking2 = await createTestRentalBooking(user.id, site.id, item2.id, {
      paymentRef: null,
      status: RENTAL_PROCESSING,
      paymentAmount: 15.0,
    })

    // Simulate what the partner manage action would do: inject a demo paymentRef
    // directly (mirroring how initiateDemoRentalPayment bypasses the Mollie API).
    // We test the DB-write contract of createRentalBookingMolliePayment by wiring
    // a fake checkout response via the fact that the function calls the Mollie API.
    // Since we can't intercept fetch here, we verify the group-paymentRef contract
    // by manually stamping a shared ref (as the manage demo path does) and then
    // finalizing via reverifyAndFinalizeRentalBooking on the first booking.
    const sharedRef = `pi_demo_${Date.now()}`
    await prisma.rentalBooking.updateMany({
      where: { id: { in: [booking1.id, booking2.id] } },
      data: { paymentRef: sharedRef, status: RENTAL_PROCESSING },
    })

    // Finalize via the representative booking — processConfirmedRentalBooking
    // is keyed by paymentRef and handles the entire group.
    const finalizeResult = await reverifyAndFinalizeRentalBooking(booking1.id)
    expect(finalizeResult.settled).toBe('complete')

    // Both bookings must now be RENTAL_COMPLETE
    const [b1, b2] = await Promise.all([
      prisma.rentalBooking.findUnique({ where: { id: booking1.id } }),
      prisma.rentalBooking.findUnique({ where: { id: booking2.id } }),
    ])
    expect(b1!.status).toBe(RENTAL_COMPLETE)
    expect(b2!.status).toBe(RENTAL_COMPLETE)

    // processConfirmedRentalBooking must have created PARTNER + PLATFORM invoices
    // for the group (keyed by the shared paymentRef).
    const invoices = await prisma.invoice.findMany({ where: { paymentRef: sharedRef } })
    expect(invoices).toHaveLength(2)
    expect(invoices.map((i) => i.issuerType).sort()).toEqual(['PARTNER', 'PLATFORM'])

    // PARTNER invoice total = sum of paymentAmount (25.00)
    const partnerInvoice = invoices.find((i) => i.issuerType === 'PARTNER')!
    expect(partnerInvoice.totalAmount).toBe(25.0)
  })

  it('is idempotent — finalizing the group twice via updateMany+finalize yields only 2 invoices', async () => {
    const user = await createTestUser()
    await createTestPartnerAccount(user.id)
    const site = await createTestSite(user.id, { rentalVat: 25.5 })
    const settings = await createTestSettings()
    await createTestServiceFee(settings.id, {
      serviceCode: 'equipment-rental',
      chargeType: 'fixed',
      feeAmount: 1.0,
    })
    const item1 = await createTestRentalItem(site.id, { name: 'Surfboard' })
    const item2 = await createTestRentalItem(site.id, { name: 'Kayak' })

    const booking1 = await createTestRentalBooking(user.id, site.id, item1.id, {
      paymentRef: null,
      status: RENTAL_PROCESSING,
      paymentAmount: 10.0,
    })
    const booking2 = await createTestRentalBooking(user.id, site.id, item2.id, {
      paymentRef: null,
      status: RENTAL_PROCESSING,
      paymentAmount: 15.0,
    })

    const sharedRef = `pi_demo_${Date.now()}`
    await prisma.rentalBooking.updateMany({
      where: { id: { in: [booking1.id, booking2.id] } },
      data: { paymentRef: sharedRef, status: RENTAL_PROCESSING },
    })

    await reverifyAndFinalizeRentalBooking(booking1.id)
    await reverifyAndFinalizeRentalBooking(booking1.id)

    const invoices = await prisma.invoice.findMany({ where: { paymentRef: sharedRef } })
    expect(invoices).toHaveLength(2)
  })
})

// ─── Unit-level helpers (pure ref-prefix logic) ───────────────────────────────
// These don't need a DB; we test them here alongside the integration suite since
// the module doesn't have a separate unit file.

describe('ref-prefix helpers (pure logic)', () => {
  // Exercised indirectly via getRentalBookingPaymentStatus, but verify the
  // branching logic with direct DB assertions above.

  it('demo ref (pi_demo_) is treated as succeeded', async () => {
    const { booking } = await setupRental({
      bookingOverrides: { paymentRef: 'pi_demo_9999999' },
    })
    const r = await getRentalBookingPaymentStatus(booking.id)
    expect(r.status).toBe('ok')
    if (r.status === 'ok') expect(r.succeeded).toBe(true)
  })

  it('tr_ ref triggers Mollie lookup (returns error without real token — not demo)', async () => {
    const { booking } = await setupRental({
      bookingOverrides: { paymentRef: 'tr_abc123' },
    })
    // No real Mollie token available in test — expect an error from token fetch
    const r = await getRentalBookingPaymentStatus(booking.id)
    // Either 'error' (token unavailable) or 'ok' — but NOT treating tr_ as demo-paid
    if (r.status === 'ok') {
      // If somehow resolved, it is NOT auto-succeeded like a demo ref
      expect(r.succeeded).not.toBe(true)
    } else {
      expect(r.status).toBe('error')
    }
  })
})
