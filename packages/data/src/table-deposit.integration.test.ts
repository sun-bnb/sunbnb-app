import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'

// Prevent real email/Resend calls
vi.mock('./email', () => ({
  sendEmail: vi.fn().mockResolvedValue({ id: 'mock-email' }),
}))
vi.mock('./reservation-emails', () => ({
  sendConfirmationEmail: vi.fn().mockResolvedValue(undefined),
}))

import { cleanDatabase, disconnectDatabase, prisma } from './test/setup'
import {
  createTestUser,
  createTestPartnerAccount,
  createTestSite,
  createTestSettings,
  createTestServiceFee,
  createTestRestaurant,
  createTestTableReservation,
  resetCounter,
} from './test/fixtures'
import {
  processChargedTableDeposit,
  computeVatAndBaseAmounts,
} from './payment'

beforeEach(async () => {
  await cleanDatabase()
  resetCounter()
})

afterAll(async () => {
  await disconnectDatabase()
})

// ─── processChargedTableDeposit ─────────────────────────────────────────────

describe('processChargedTableDeposit', () => {
  /**
   * Creates a site-linked restaurant with a table reservation that has a
   * charged deposit ready for invoice processing.
   *
   * Defaults:
   *   depositAmount = 50.0 (partner books gross 50.0; commission 1.0 fixed, separate)
   *   site.vat      = 25.5 (from createTestSite default)
   */
  async function setupDeposit(overrides?: {
    siteOverrides?: Record<string, any>
    feeOverrides?: Record<string, any>
    tableReservationOverrides?: Record<string, any>
    restaurantOverrides?: Record<string, any>
    /** Skip creating an explicit service fee; rely on loadFeeContext bootstrap */
    skipFee?: boolean
  }) {
    const user = await createTestUser()
    const partner = await createTestPartnerAccount(user.id)
    const site = await createTestSite(user.id, overrides?.siteOverrides)
    const settings = await createTestSettings()

    // Explicit no-show-deposit fee so the amount is deterministic (1.0 fixed)
    let fee = null
    if (!overrides?.skipFee) {
      fee = await createTestServiceFee(settings.id, {
        serviceCode: 'no-show-deposit',
        chargeType: 'fixed',
        feeAmount: 1.0,
        ...overrides?.feeOverrides,
      })
    }

    // Restaurant is linked to the Site via siteId
    const restaurant = await createTestRestaurant(partner.userId, {
      siteId: site.id,
      ...overrides?.restaurantOverrides,
    })

    const tableReservation = await createTestTableReservation(restaurant.id, {
      depositAmount: 50.0,
      depositStatus: 'charged',
      paymentRef: `pi_demo_${Date.now()}`,
      ...overrides?.tableReservationOverrides,
    })

    return { user, partner, site, settings, fee, restaurant, tableReservation }
  }

  // ── Core split-merchant assertions ────────────────────────────────────────

  it('creates exactly 2 invoices — PARTNER and PLATFORM', async () => {
    const { tableReservation } = await setupDeposit()

    await processChargedTableDeposit(tableReservation.id)

    const invoices = await prisma.invoice.findMany({
      where: { tableReservationId: tableReservation.id },
    })

    expect(invoices).toHaveLength(2)
    const types = invoices.map((i) => i.issuerType).sort()
    expect(types).toEqual(['PARTNER', 'PLATFORM'])
  })

  it('books the full kept deposit as partner revenue, commission separately', async () => {
    const { tableReservation } = await setupDeposit()

    await processChargedTableDeposit(tableReservation.id)

    const partnerInvoice = await prisma.invoice.findFirst({
      where: { tableReservationId: tableReservation.id, issuerType: 'PARTNER' },
    })
    const platformInvoice = await prisma.invoice.findFirst({
      where: { tableReservationId: tableReservation.id, issuerType: 'PLATFORM' },
    })

    // Agent model: partner books the full kept deposit (gross 50.0); the
    // commission (fixed 1.0) is billed separately on the PLATFORM invoice.
    expect(partnerInvoice!.totalAmount).toBe(50.0)
    expect(platformInvoice!.totalAmount).toBe(1.0)
  })

  // ── VAT reverse-calculation ────────────────────────────────────────────────

  it('applies reverse-VAT using the linked Site vat rate on partner invoice line', async () => {
    const { tableReservation, site } = await setupDeposit()

    await processChargedTableDeposit(tableReservation.id)

    const partnerInvoice = await prisma.invoice.findFirst({
      where: { tableReservationId: tableReservation.id, issuerType: 'PARTNER' },
      include: { invoiceLines: true },
    })

    expect(partnerInvoice!.invoiceLines).toHaveLength(1)
    const line = partnerInvoice!.invoiceLines[0]!

    // partnerAmount = 50.0 (gross kept deposit), siteVat = 25.5
    const expected = computeVatAndBaseAmounts(50.0, site.vat ?? 0)
    expect(line.vatRate).toBe(site.vat)
    expect(line.charge).toBe(expected.baseAmount)
    expect(line.tax).toBe(expected.vatAmount)
    expect(line.amount).toBe(50.0)
    expect(line.productCode).toBe('no-show-deposit')
  })

  it('applies reverse-VAT on platform invoice line using settings vat rate', async () => {
    const { tableReservation } = await setupDeposit()

    await processChargedTableDeposit(tableReservation.id)

    const platformInvoice = await prisma.invoice.findFirst({
      where: { tableReservationId: tableReservation.id, issuerType: 'PLATFORM' },
      include: { invoiceLines: true },
    })

    expect(platformInvoice!.invoiceLines).toHaveLength(1)
    const line = platformInvoice!.invoiceLines[0]!

    // fee=1.0, settings.vat=25.5 (fee's settingsId resolves the platform VAT)
    const expected = computeVatAndBaseAmounts(1.0, 25.5)
    expect(line.vatRate).toBe(25.5)
    expect(line.charge).toBe(expected.baseAmount)
    expect(line.tax).toBe(expected.vatAmount)
    expect(line.amount).toBe(1.0)
    expect(line.productCode).toBe('sunbnb-service-fee')
  })

  it('stores correct totalCharge / totalTax on each invoice', async () => {
    const { tableReservation, site } = await setupDeposit()

    await processChargedTableDeposit(tableReservation.id)

    const partnerInvoice = await prisma.invoice.findFirst({
      where: { tableReservationId: tableReservation.id, issuerType: 'PARTNER' },
    })
    const platformInvoice = await prisma.invoice.findFirst({
      where: { tableReservationId: tableReservation.id, issuerType: 'PLATFORM' },
    })

    const partnerVat = computeVatAndBaseAmounts(50.0, site.vat ?? 0)
    expect(partnerInvoice!.totalCharge).toBe(partnerVat.baseAmount)
    expect(partnerInvoice!.totalTax).toBe(partnerVat.vatAmount)

    const platformVat = computeVatAndBaseAmounts(1.0, 25.5)
    expect(platformInvoice!.totalCharge).toBe(platformVat.baseAmount)
    expect(platformInvoice!.totalTax).toBe(platformVat.vatAmount)
  })

  // ── Hash chain ────────────────────────────────────────────────────────────

  it('extends the hash chain — invoices have non-null hash values', async () => {
    const { tableReservation } = await setupDeposit()

    await processChargedTableDeposit(tableReservation.id)

    const invoices = await prisma.invoice.findMany({
      where: { tableReservationId: tableReservation.id },
    })

    for (const inv of invoices) {
      expect(inv.hash).toBeTruthy()
      expect(typeof inv.hash).toBe('string')
    }
  })

  it('chains hashes correctly — second PARTNER invoice references first hash', async () => {
    // First deposit on site-linked restaurant
    const { tableReservation: tr1, user } = await setupDeposit()
    await processChargedTableDeposit(tr1.id)

    // Second deposit needs a second site (siteId is unique on Restaurant)
    const site2 = await createTestSite(user.id)
    const restaurant2 = await createTestRestaurant(user.id, { siteId: site2.id })
    const tr2 = await createTestTableReservation(restaurant2.id, {
      depositAmount: 50.0,
      depositStatus: 'charged',
      paymentRef: `pi_demo_${Date.now() + 1}`,
    })
    await processChargedTableDeposit(tr2.id)

    const partnerInvoices = await prisma.invoice.findMany({
      where: { issuerType: 'PARTNER' },
      orderBy: { invoiceNumber: 'asc' },
    })

    // Second invoice's previousHash must equal first invoice's hash
    expect(partnerInvoices).toHaveLength(2)
    expect(partnerInvoices[1]!.previousHash).toBe(partnerInvoices[0]!.hash)
  })

  // ── Sequential invoice numbering ──────────────────────────────────────────

  it('generates sequential invoice numbers across two deposit batches', async () => {
    const { tableReservation: tr1, user } = await setupDeposit()
    await processChargedTableDeposit(tr1.id)

    // Second deposit needs a second site (siteId is @unique on Restaurant)
    const site2 = await createTestSite(user.id)
    const restaurant2 = await createTestRestaurant(user.id, { siteId: site2.id })
    const tr2 = await createTestTableReservation(restaurant2.id, {
      depositAmount: 50.0,
      depositStatus: 'charged',
      paymentRef: `pi_demo_${Date.now() + 1}`,
    })
    await processChargedTableDeposit(tr2.id)

    const year = new Date().getFullYear()
    const partnerInvoices = await prisma.invoice.findMany({
      where: { issuerType: 'PARTNER' },
      orderBy: { invoiceNumber: 'asc' },
    })

    expect(partnerInvoices[0]!.invoiceNumber).toBe(`PARTNER-${year}-00001`)
    expect(partnerInvoices[1]!.invoiceNumber).toBe(`PARTNER-${year}-00002`)
  })

  // ── Idempotency ────────────────────────────────────────────────────────────

  it('is idempotent — calling twice creates no duplicate invoices', async () => {
    const { tableReservation } = await setupDeposit()

    await processChargedTableDeposit(tableReservation.id)
    await processChargedTableDeposit(tableReservation.id)

    const invoices = await prisma.invoice.findMany({
      where: { tableReservationId: tableReservation.id },
    })
    expect(invoices).toHaveLength(2)
  })

  it('concurrent calls — unique constraint prevents double-invoice; one call throws', async () => {
    // Bug-revealing: two concurrent calls both pass the outer idempotency guard
    // (neither has committed yet), so both enter the transaction. The sequential
    // invoice number is acquired inside the transaction under FOR UPDATE (safe
    // against sequential calls), but two concurrent transactions can acquire
    // different numbers and race on INSERT. The invoice_number unique constraint
    // fires on the loser, throwing rather than silently no-op-ing.
    //
    // Expected: exactly one call succeeds; the other rejects. No duplicate
    // invoices are created — data integrity is preserved by the DB constraint.
    const { tableReservation } = await setupDeposit()

    const results = await Promise.allSettled([
      processChargedTableDeposit(tableReservation.id),
      processChargedTableDeposit(tableReservation.id),
    ])

    const fulfilled = results.filter((r) => r.status === 'fulfilled')
    const rejected = results.filter((r) => r.status === 'rejected')

    // Exactly one winner; the constraint prevents data corruption
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)

    const invoices = await prisma.invoice.findMany({
      where: { tableReservationId: tableReservation.id },
    })
    expect(invoices).toHaveLength(2)
  })

  // ── Percentage fee ────────────────────────────────────────────────────────

  it('handles percentage-based service fee correctly', async () => {
    const { tableReservation } = await setupDeposit({
      feeOverrides: {
        chargeType: 'percentage',
        percentage: 10,
        feeAmount: null,
      },
    })

    await processChargedTableDeposit(tableReservation.id)

    const partnerInvoice = await prisma.invoice.findFirst({
      where: { tableReservationId: tableReservation.id, issuerType: 'PARTNER' },
    })
    const platformInvoice = await prisma.invoice.findFirst({
      where: { tableReservationId: tableReservation.id, issuerType: 'PLATFORM' },
    })

    // 10% of 50.0 = 5.0 commission (billed separately); partner books gross 50.0
    expect(platformInvoice!.totalAmount).toBe(5.0)
    expect(partnerInvoice!.totalAmount).toBe(50.0)
  })

  // ── Error paths ───────────────────────────────────────────────────────────

  it('throws for a non-existent tableReservationId', async () => {
    await expect(
      processChargedTableDeposit('nonexistent-id')
    ).rejects.toThrow('TableReservation not found')
  })

  it('throws when restaurant has no siteId (unlinked restaurant)', async () => {
    const user = await createTestUser()
    const partner = await createTestPartnerAccount(user.id)
    await createTestSettings()

    // No siteId — pure standalone restaurant, not linked to a Sunbnb site
    const restaurant = await createTestRestaurant(partner.userId)

    const tableReservation = await createTestTableReservation(restaurant.id, {
      depositAmount: 50.0,
      depositStatus: 'charged',
      paymentRef: `pi_demo_${Date.now()}`,
    })

    await expect(
      processChargedTableDeposit(tableReservation.id)
    ).rejects.toThrow('Deposit cascade requires a site-linked restaurant')
  })

  it('throws when depositAmount is zero or missing', async () => {
    const { tableReservation } = await setupDeposit({
      tableReservationOverrides: { depositAmount: null },
    })

    await expect(
      processChargedTableDeposit(tableReservation.id)
    ).rejects.toThrow('has no deposit amount to process')
  })

  it('skips platform invoice when fee resolves to zero', async () => {
    // Zero-amount fixed fee means no platform commission to record
    const { tableReservation } = await setupDeposit({
      feeOverrides: {
        chargeType: 'fixed',
        feeAmount: 0,
      },
    })

    await processChargedTableDeposit(tableReservation.id)

    const invoices = await prisma.invoice.findMany({
      where: { tableReservationId: tableReservation.id },
    })

    // Only partner invoice — platform invoice skipped when fee is 0
    const types = invoices.map((i) => i.issuerType)
    expect(types).toContain('PARTNER')
    expect(types).not.toContain('PLATFORM')
  })
})
