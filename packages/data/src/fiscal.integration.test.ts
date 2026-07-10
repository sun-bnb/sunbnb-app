import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { cleanDatabase, disconnectDatabase, prisma } from './test/setup'
import {
  createTestUser,
  createTestPartnerAccount,
  createTestSite,
  createTestInventoryItem,
  createTestReservation,
  createTestRentalItem,
  createTestRentalBooking,
  createTestOrder,
  resetCounter,
} from './test/fixtures'
import { getMonthlyFiscalReport } from './fiscal'

beforeEach(async () => {
  await cleanDatabase()
  resetCounter()
})

afterAll(async () => {
  await disconnectDatabase()
})

const d = (iso: string) => new Date(iso)

// ─── Test factories ──────────────────────────────────────────────────────────

/**
 * Create an Invoice directly in the DB (bypassing processConfirmedReservation).
 * Mirrors the local helper in analytics.integration.test.ts.
 */
async function createTestInvoice(
  accountId: string,
  overrides: Record<string, any> = {},
) {
  return prisma.invoice.create({
    data: {
      accountId,
      issuerType: 'PARTNER',
      invoicedAt: new Date(),
      totalCharge: 0,
      totalTax: 0,
      totalAmount: 0,
      reverseCharge: false,
      ...overrides,
    },
  })
}

/**
 * Create an InvoiceLine on an existing Invoice.
 */
async function createTestInvoiceLine(
  invoiceId: string,
  overrides: Record<string, any> = {},
) {
  return prisma.invoiceLine.create({
    data: {
      invoiceId,
      charge: 0,
      tax: 0,
      amount: 0,
      ...overrides,
    },
  })
}

// ─── Shared window ────────────────────────────────────────────────────────────

const MONTH_FROM = d('2026-07-01T00:00:00Z')
const MONTH_TO   = d('2026-08-01T00:00:00Z') // exclusive upper bound

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('getMonthlyFiscalReport', () => {
  describe('PARTNER invoice aggregation (count / gross / net / vat)', () => {
    it('sums PARTNER invoices — count, gross, net, vat', async () => {
      const user = await createTestUser()
      await createTestPartnerAccount(user.id)
      const site = await createTestSite(user.id)
      const item = await createTestInventoryItem(user.id, site.id, { number: 1 })
      const res = await createTestReservation(user.id, site.id, [item.id])

      // Invoice A: gross 100, net 79.68, vat 20.32 (25.5% rate)
      const invA = await createTestInvoice(user.id, {
        reservationId: res.id,
        issuerType: 'PARTNER',
        invoicedAt: d('2026-07-10T10:00:00Z'),
        totalCharge: 79.68,
        totalTax: 20.32,
        totalAmount: 100,
        invoiceNumber: 'PARTNER-2026-00001',
      })
      await createTestInvoiceLine(invA.id, { charge: 79.68, tax: 20.32, amount: 100, vatRate: 25.5 })

      // Invoice B: gross 58, net 50.88, vat 7.12 (14% rate)
      const invB = await createTestInvoice(user.id, {
        reservationId: res.id,
        issuerType: 'PARTNER',
        invoicedAt: d('2026-07-15T14:00:00Z'),
        totalCharge: 50.88,
        totalTax: 7.12,
        totalAmount: 58,
        invoiceNumber: 'PARTNER-2026-00002',
      })
      await createTestInvoiceLine(invB.id, { charge: 50.88, tax: 7.12, amount: 58, vatRate: 14 })

      const report = await getMonthlyFiscalReport(site.id, MONTH_FROM, MONTH_TO)

      expect(report.count).toBe(2)
      expect(report.gross).toBe(158)         // 100 + 58
      expect(report.net).toBeCloseTo(130.56, 1)  // 79.68 + 50.88
      expect(report.vat).toBeCloseTo(27.44, 1)   // 20.32 + 7.12
    })
  })

  describe('vatByRate bucketing', () => {
    it('groups PARTNER invoice lines by vatRate, sums net/vat/gross per bucket, sorted ascending', async () => {
      const user = await createTestUser()
      await createTestPartnerAccount(user.id)
      const site = await createTestSite(user.id)
      const item = await createTestInventoryItem(user.id, site.id, { number: 1 })
      const res = await createTestReservation(user.id, site.id, [item.id])

      // Invoice with two 25.5% lines and one 14% line
      const inv = await createTestInvoice(user.id, {
        reservationId: res.id,
        issuerType: 'PARTNER',
        invoicedAt: d('2026-07-05T08:00:00Z'),
        totalCharge: 130,
        totalTax: 30,
        totalAmount: 160,
      })
      // 25.5% line 1: gross 100
      await createTestInvoiceLine(inv.id, { charge: 79.68, tax: 20.32, amount: 100, vatRate: 25.5 })
      // 25.5% line 2: gross 20
      await createTestInvoiceLine(inv.id, { charge: 15.94, tax: 4.06, amount: 20, vatRate: 25.5 })
      // 14% line: gross 40
      await createTestInvoiceLine(inv.id, { charge: 35.09, tax: 4.91, amount: 40, vatRate: 14 })

      const report = await getMonthlyFiscalReport(site.id, MONTH_FROM, MONTH_TO)

      expect(report.vatByRate).toHaveLength(2)

      // Sorted ascending: 14% first, then 25.5%
      const [bucket14, bucket255] = report.vatByRate

      expect(bucket14!.rate).toBe(14)
      expect(bucket14!.gross).toBeCloseTo(40, 1)
      expect(bucket14!.net).toBeCloseTo(35.09, 1)
      expect(bucket14!.vat).toBeCloseTo(4.91, 1)

      expect(bucket255!.rate).toBe(25.5)
      expect(bucket255!.gross).toBeCloseTo(120, 1)
      expect(bucket255!.net).toBeCloseTo(95.62, 1)   // 79.68 + 15.94
      expect(bucket255!.vat).toBeCloseTo(24.38, 1)   // 20.32 + 4.06
    })

    it('null vatRate lines bucket into rate 0', async () => {
      const user = await createTestUser()
      await createTestPartnerAccount(user.id)
      const site = await createTestSite(user.id)
      const item = await createTestInventoryItem(user.id, site.id, { number: 1 })
      const res = await createTestReservation(user.id, site.id, [item.id])

      const inv = await createTestInvoice(user.id, {
        reservationId: res.id,
        issuerType: 'PARTNER',
        invoicedAt: d('2026-07-08T09:00:00Z'),
        totalCharge: 50,
        totalTax: 0,
        totalAmount: 50,
      })
      await createTestInvoiceLine(inv.id, { charge: 50, tax: 0, amount: 50, vatRate: null })

      const report = await getMonthlyFiscalReport(site.id, MONTH_FROM, MONTH_TO)

      expect(report.vatByRate).toHaveLength(1)
      expect(report.vatByRate[0]!.rate).toBe(0)
      expect(report.vatByRate[0]!.gross).toBe(50)
    })
  })

  describe('PLATFORM commission + reverseCharge', () => {
    it('sums PLATFORM invoices into platformCommission; sets platformReverseCharge when any is true', async () => {
      const user = await createTestUser()
      await createTestPartnerAccount(user.id)
      const site = await createTestSite(user.id)
      const item = await createTestInventoryItem(user.id, site.id, { number: 1 })
      const res = await createTestReservation(user.id, site.id, [item.id])

      // PARTNER invoice (must exist to prove platformCommission excludes it)
      const partnerInv = await createTestInvoice(user.id, {
        reservationId: res.id,
        issuerType: 'PARTNER',
        invoicedAt: d('2026-07-12T10:00:00Z'),
        totalCharge: 79.68,
        totalTax: 20.32,
        totalAmount: 100,
      })
      await createTestInvoiceLine(partnerInv.id, { charge: 79.68, tax: 20.32, amount: 100, vatRate: 25.5 })

      // PLATFORM commission invoice with reverseCharge
      const platformInv = await createTestInvoice(user.id, {
        reservationId: res.id,
        issuerType: 'PLATFORM',
        invoicedAt: d('2026-07-12T10:00:00Z'),
        totalCharge: 2,
        totalTax: 0,
        totalAmount: 2,
        reverseCharge: true,
        recipientCompanyName: 'Test Beach Oy',
        recipientVatNumber: 'FI99887766',
      })
      await createTestInvoiceLine(platformInv.id, { charge: 2, tax: 0, amount: 2, vatRate: 0 })

      const report = await getMonthlyFiscalReport(site.id, MONTH_FROM, MONTH_TO)

      expect(report.count).toBe(1)              // only PARTNER counted in sales
      expect(report.gross).toBe(100)
      expect(report.platformCommission).toBe(2)
      expect(report.platformReverseCharge).toBe(true)
    })

    it('platformReverseCharge is false when no PLATFORM invoice has reverseCharge', async () => {
      const user = await createTestUser()
      await createTestPartnerAccount(user.id)
      const site = await createTestSite(user.id)
      const item = await createTestInventoryItem(user.id, site.id, { number: 1 })
      const res = await createTestReservation(user.id, site.id, [item.id])

      await createTestInvoice(user.id, {
        reservationId: res.id,
        issuerType: 'PLATFORM',
        invoicedAt: d('2026-07-20T10:00:00Z'),
        totalCharge: 3,
        totalTax: 0,
        totalAmount: 3,
        reverseCharge: false,
      })

      const report = await getMonthlyFiscalReport(site.id, MONTH_FROM, MONTH_TO)

      expect(report.platformReverseCharge).toBe(false)
    })
  })

  describe('processingFees', () => {
    it('sums processingFee from PARTNER invoices (nulls treated as 0)', async () => {
      const user = await createTestUser()
      await createTestPartnerAccount(user.id)
      const site = await createTestSite(user.id)
      const item = await createTestInventoryItem(user.id, site.id, { number: 1 })
      const res = await createTestReservation(user.id, site.id, [item.id])

      // Invoice with processingFee set
      await createTestInvoice(user.id, {
        reservationId: res.id,
        issuerType: 'PARTNER',
        invoicedAt: d('2026-07-14T10:00:00Z'),
        totalCharge: 79.68,
        totalTax: 20.32,
        totalAmount: 100,
        processingFee: 0.35,
      })
      // Invoice with processingFee = null
      await createTestInvoice(user.id, {
        reservationId: res.id,
        issuerType: 'PARTNER',
        invoicedAt: d('2026-07-18T10:00:00Z'),
        totalCharge: 50,
        totalTax: 0,
        totalAmount: 50,
        processingFee: null,
      })
      // Invoice with processingFee set
      await createTestInvoice(user.id, {
        reservationId: res.id,
        issuerType: 'PARTNER',
        invoicedAt: d('2026-07-20T10:00:00Z'),
        totalCharge: 40,
        totalTax: 0,
        totalAmount: 40,
        processingFee: 0.25,
      })

      const report = await getMonthlyFiscalReport(site.id, MONTH_FROM, MONTH_TO)

      expect(report.processingFees).toBeCloseTo(0.60, 2)
    })
  })

  describe('refunds (informational)', () => {
    it('counts refunded reservations + rental bookings + orders in the period', async () => {
      const user = await createTestUser()
      await createTestPartnerAccount(user.id)
      const site = await createTestSite(user.id)
      const item = await createTestInventoryItem(user.id, site.id, { number: 1 })
      const rentalItem = await createTestRentalItem(site.id)

      // Refunded reservation (refundedAt set)
      await createTestReservation(user.id, site.id, [item.id], {
        status: 'refunded',
        paymentAmount: 40,
        refundedAt: d('2026-07-10T12:00:00Z'),
        createdAt: d('2026-07-09T10:00:00Z'),
      })
      // Refunded rental
      await createTestRentalBooking(user.id, site.id, rentalItem.id, {
        status: 'refunded',
        paymentAmount: 15,
        createdAt: d('2026-07-12T09:00:00Z'),
      })
      // Refunded order
      await createTestOrder(user.id, site.id, {
        status: 'refunded',
        paymentAmount: 20,
        createdAt: d('2026-07-15T11:00:00Z'),
      })
      // A non-refunded reservation — must not appear in refunds
      await createTestReservation(user.id, site.id, [item.id], {
        status: 'complete',
        paymentAmount: 100,
        createdAt: d('2026-07-05T09:00:00Z'),
      })

      const report = await getMonthlyFiscalReport(site.id, MONTH_FROM, MONTH_TO)

      expect(report.refunds.count).toBe(3)
      expect(report.refunds.amount).toBe(75)  // 40 + 15 + 20
    })

    it('excludes refunds outside the window', async () => {
      const user = await createTestUser()
      await createTestPartnerAccount(user.id)
      const site = await createTestSite(user.id)
      const item = await createTestInventoryItem(user.id, site.id, { number: 1 })

      // Refund createdAt in August — outside July window
      await createTestReservation(user.id, site.id, [item.id], {
        status: 'refunded',
        paymentAmount: 99,
        refundedAt: d('2026-08-02T12:00:00Z'),
        createdAt: d('2026-08-01T10:00:00Z'),
      })

      const report = await getMonthlyFiscalReport(site.id, MONTH_FROM, MONTH_TO)

      expect(report.refunds.count).toBe(0)
      expect(report.refunds.amount).toBe(0)
    })
  })

  describe('lines register', () => {
    it('includes PARTNER and PLATFORM invoice lines; sorted by invoicedAt then invoiceNumber', async () => {
      const user = await createTestUser()
      await createTestPartnerAccount(user.id)
      const site = await createTestSite(user.id)
      const item = await createTestInventoryItem(user.id, site.id, { number: 1 })
      const res = await createTestReservation(user.id, site.id, [item.id])

      // PARTNER invoice
      const partnerInv = await createTestInvoice(user.id, {
        reservationId: res.id,
        issuerType: 'PARTNER',
        invoicedAt: d('2026-07-10T10:00:00Z'),
        totalCharge: 79.68,
        totalTax: 20.32,
        totalAmount: 100,
        paymentRef: 'tr_abc123',
        invoiceNumber: 'PARTNER-2026-00010',
        reverseCharge: false,
      })
      await createTestInvoiceLine(partnerInv.id, {
        charge: 79.68,
        tax: 20.32,
        amount: 100,
        vatRate: 25.5,
        description: 'Sunbed #1 - 2026-07-10',
      })

      // PLATFORM invoice (same paymentRef)
      const platformInv = await createTestInvoice(user.id, {
        reservationId: res.id,
        issuerType: 'PLATFORM',
        invoicedAt: d('2026-07-10T10:00:00Z'),
        totalCharge: 1,
        totalTax: 0,
        totalAmount: 1,
        paymentRef: 'tr_abc123',
        invoiceNumber: 'PLATFORM-2026-00010',
        reverseCharge: true,
      })
      await createTestInvoiceLine(platformInv.id, {
        charge: 1,
        tax: 0,
        amount: 1,
        vatRate: 0,
        description: 'Sunbnb service fee',
      })

      const report = await getMonthlyFiscalReport(site.id, MONTH_FROM, MONTH_TO)

      // 2 lines total (1 PARTNER + 1 PLATFORM)
      expect(report.lines).toHaveLength(2)

      const partnerLine = report.lines.find((l) => l.issuerType === 'PARTNER')!
      expect(partnerLine.invoiceNumber).toBe('PARTNER-2026-00010')
      expect(partnerLine.net).toBeCloseTo(79.68, 2)
      expect(partnerLine.vatRate).toBe(25.5)
      expect(partnerLine.vat).toBeCloseTo(20.32, 2)
      expect(partnerLine.gross).toBe(100)
      expect(partnerLine.paymentRef).toBe('tr_abc123')
      expect(partnerLine.reverseCharge).toBe(false)
      expect(partnerLine.description).toBe('Sunbed #1 - 2026-07-10')

      const platformLine = report.lines.find((l) => l.issuerType === 'PLATFORM')!
      expect(platformLine.invoiceNumber).toBe('PLATFORM-2026-00010')
      expect(platformLine.net).toBe(1)
      expect(platformLine.gross).toBe(1)
      expect(platformLine.paymentRef).toBe('tr_abc123')
      expect(platformLine.reverseCharge).toBe(true)
    })
  })

  describe('rental invoices via paymentRef scoping', () => {
    it('includes invoices for rental bookings belonging to the site', async () => {
      const user = await createTestUser()
      await createTestPartnerAccount(user.id)
      const site = await createTestSite(user.id)
      const rentalItem = await createTestRentalItem(site.id)

      const paymentRef = `tr_rental_${Date.now()}`

      // Create a rental booking with the paymentRef
      await createTestRentalBooking(user.id, site.id, rentalItem.id, {
        status: 'complete',
        paymentRef,
        paymentAmount: 30,
      })

      // Create a PARTNER invoice linked by paymentRef (not reservationId/orderId)
      const inv = await createTestInvoice(user.id, {
        issuerType: 'PARTNER',
        invoicedAt: d('2026-07-20T10:00:00Z'),
        totalCharge: 23.91,
        totalTax: 6.09,
        totalAmount: 30,
        paymentRef,
        invoiceNumber: 'PARTNER-2026-00020',
      })
      await createTestInvoiceLine(inv.id, {
        charge: 23.91,
        tax: 6.09,
        amount: 30,
        vatRate: 25.5,
        description: 'Equipment rental',
      })

      const report = await getMonthlyFiscalReport(site.id, MONTH_FROM, MONTH_TO)

      expect(report.count).toBe(1)
      expect(report.gross).toBe(30)
      expect(report.lines).toHaveLength(1)
      expect(report.lines[0]!.paymentRef).toBe(paymentRef)
    })
  })

  describe('site scoping', () => {
    it('excludes invoices belonging to a different site', async () => {
      // Target site — no invoices
      const user = await createTestUser()
      await createTestPartnerAccount(user.id)
      const site = await createTestSite(user.id)

      // Other site with invoices
      const other = await createTestUser()
      await createTestPartnerAccount(other.id)
      const otherSite = await createTestSite(other.id)
      const otherItem = await createTestInventoryItem(other.id, otherSite.id, { number: 1 })
      const otherRes = await createTestReservation(other.id, otherSite.id, [otherItem.id])

      const inv = await createTestInvoice(other.id, {
        reservationId: otherRes.id,
        issuerType: 'PARTNER',
        invoicedAt: d('2026-07-15T09:00:00Z'),
        totalCharge: 79.68,
        totalTax: 20.32,
        totalAmount: 100,
      })
      await createTestInvoiceLine(inv.id, { charge: 79.68, tax: 20.32, amount: 100, vatRate: 25.5 })

      const report = await getMonthlyFiscalReport(site.id, MONTH_FROM, MONTH_TO)

      expect(report.count).toBe(0)
      expect(report.gross).toBe(0)
      expect(report.lines).toHaveLength(0)
      expect(report.platformCommission).toBe(0)
    })

    it('excludes invoices outside the date window', async () => {
      const user = await createTestUser()
      await createTestPartnerAccount(user.id)
      const site = await createTestSite(user.id)
      const item = await createTestInventoryItem(user.id, site.id, { number: 1 })
      const res = await createTestReservation(user.id, site.id, [item.id])

      // Invoice in August — outside July window
      await createTestInvoice(user.id, {
        reservationId: res.id,
        issuerType: 'PARTNER',
        invoicedAt: d('2026-08-05T10:00:00Z'),
        totalCharge: 79.68,
        totalTax: 20.32,
        totalAmount: 100,
      })

      const report = await getMonthlyFiscalReport(site.id, MONTH_FROM, MONTH_TO)

      expect(report.count).toBe(0)
      expect(report.gross).toBe(0)
    })
  })

  describe('comprehensive scenario', () => {
    it('full month: mixed VAT rates, PLATFORM commission, processingFee, refunds, all lines', async () => {
      const user = await createTestUser()
      await createTestPartnerAccount(user.id)
      const site = await createTestSite(user.id)
      const item = await createTestInventoryItem(user.id, site.id, { number: 1 })
      const res = await createTestReservation(user.id, site.id, [item.id])
      const rentalItem = await createTestRentalItem(site.id)

      // ── PARTNER invoice 1: two lines at different VAT rates, processingFee set ──
      const inv1 = await createTestInvoice(user.id, {
        reservationId: res.id,
        issuerType: 'PARTNER',
        invoicedAt: d('2026-07-05T10:00:00Z'),
        totalCharge: 115.57,
        totalTax: 34.43,
        totalAmount: 150,
        processingFee: 0.30,
        paymentRef: 'tr_payment1',
        invoiceNumber: 'PARTNER-2026-00030',
      })
      // Line at 25.5%: gross 100
      await createTestInvoiceLine(inv1.id, {
        charge: 79.68, tax: 20.32, amount: 100, vatRate: 25.5, description: 'Sunbed #1',
      })
      // Line at 14%: gross 50
      await createTestInvoiceLine(inv1.id, {
        charge: 43.86, tax: 6.14, amount: 50, vatRate: 14, description: 'F&B order',
      })
      // Fee line at null vatRate (maps to 0): charge 0, no VAT
      await createTestInvoiceLine(inv1.id, {
        charge: -7.97, tax: 0, amount: -7.97, vatRate: null, description: 'Service fee deducted',
      })

      // ── PLATFORM commission invoice 1 with reverseCharge ──
      const inv2 = await createTestInvoice(user.id, {
        reservationId: res.id,
        issuerType: 'PLATFORM',
        invoicedAt: d('2026-07-05T10:00:00Z'),
        totalCharge: 1.5,
        totalTax: 0,
        totalAmount: 1.5,
        reverseCharge: true,
        paymentRef: 'tr_payment1',
        invoiceNumber: 'PLATFORM-2026-00030',
      })
      await createTestInvoiceLine(inv2.id, {
        charge: 1.5, tax: 0, amount: 1.5, vatRate: 0, description: 'Sunbnb commission',
      })

      // ── PARTNER invoice 2: rental booking, processingFee null ──
      const rentalPaymentRef = `tr_rental_${Date.now()}`
      await createTestRentalBooking(user.id, site.id, rentalItem.id, {
        status: 'complete',
        paymentRef: rentalPaymentRef,
        paymentAmount: 40,
      })
      const inv3 = await createTestInvoice(user.id, {
        issuerType: 'PARTNER',
        invoicedAt: d('2026-07-18T09:00:00Z'),
        totalCharge: 31.87,
        totalTax: 8.13,
        totalAmount: 40,
        processingFee: null,
        paymentRef: rentalPaymentRef,
        invoiceNumber: 'PARTNER-2026-00031',
      })
      await createTestInvoiceLine(inv3.id, {
        charge: 31.87, tax: 8.13, amount: 40, vatRate: 25.5, description: 'Surfboard rental',
      })

      // ── Refunded reservation in the month ──
      await createTestReservation(user.id, site.id, [item.id], {
        status: 'refunded',
        paymentAmount: 25,
        refundedAt: d('2026-07-20T12:00:00Z'),
        createdAt: d('2026-07-19T10:00:00Z'),
      })

      const report = await getMonthlyFiscalReport(site.id, MONTH_FROM, MONTH_TO)

      // ── Sales (PARTNER) ──
      expect(report.count).toBe(2)                    // inv1 + inv3
      expect(report.gross).toBeCloseTo(190, 1)        // 150 + 40
      expect(report.net).toBeCloseTo(147.44, 1)       // 115.57 + 31.87
      expect(report.vat).toBeCloseTo(42.56, 1)        // 34.43 + 8.13

      // ── VAT buckets ──
      // Rate 0: -7.97 (null vatRate line) → net -7.97, vat 0, gross -7.97
      // Rate 14: net 43.86, vat 6.14, gross 50
      // Rate 25.5: net 79.68+31.87=111.55, vat 20.32+8.13=28.45, gross 100+40=140
      expect(report.vatByRate).toHaveLength(3)
      const bucket0 = report.vatByRate.find((b) => b.rate === 0)!
      const bucket14 = report.vatByRate.find((b) => b.rate === 14)!
      const bucket255 = report.vatByRate.find((b) => b.rate === 25.5)!
      expect(bucket0.gross).toBeCloseTo(-7.97, 2)
      expect(bucket14.gross).toBe(50)
      expect(bucket255.gross).toBe(140)
      // sorted ascending
      expect(report.vatByRate[0]!.rate).toBe(0)
      expect(report.vatByRate[1]!.rate).toBe(14)
      expect(report.vatByRate[2]!.rate).toBe(25.5)

      // ── Platform ──
      expect(report.platformCommission).toBe(1.5)
      expect(report.platformReverseCharge).toBe(true)

      // ── Processing fees ──
      expect(report.processingFees).toBeCloseTo(0.30, 2)   // 0.30 + null(→0)

      // ── Refunds ──
      expect(report.refunds.count).toBe(1)
      expect(report.refunds.amount).toBe(25)

      // ── Lines: 3 PARTNER (inv1 line1, inv1 line2, inv1 fee line) + 1 PARTNER (inv3) + 1 PLATFORM = 5 ──
      // inv1 has 3 lines, inv2 has 1, inv3 has 1
      expect(report.lines).toHaveLength(5)

      // All lines carry the correct issuerType
      const partnerLines = report.lines.filter((l) => l.issuerType === 'PARTNER')
      const platformLines = report.lines.filter((l) => l.issuerType === 'PLATFORM')
      expect(partnerLines).toHaveLength(4)  // 3 from inv1 + 1 from inv3
      expect(platformLines).toHaveLength(1)

      // PLATFORM line has reverseCharge = true
      expect(platformLines[0]!.reverseCharge).toBe(true)
    })
  })
})
