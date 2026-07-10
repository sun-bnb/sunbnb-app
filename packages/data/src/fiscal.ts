/**
 * Monthly fiscal report for the partner accounting export — the invoice-based
 * register an entrepreneur hands their accountant.
 *
 * This is a READ-ONLY helper; no writes, no auth (the caller's responsibility).
 *
 * Site scoping:
 *   - Reservation invoices:  reservation.siteId = siteId  (PARTNER + PLATFORM)
 *   - Order invoices:        order.siteId = siteId        (PARTNER + PLATFORM)
 *   - Rental invoices:       no direct FK on Invoice → siteId; linked only via
 *     paymentRef on RentalBooking.  We fetch the set of paymentRefs belonging to
 *     the site's RentalBookings (both online refs like `tr_…` and cash refs like
 *     `cash-rental-<id>`) and match Invoice.paymentRef IN (...).  This is a
 *     single extra findMany on RentalBooking + an IN clause on Invoice — acceptable
 *     for a monthly report.
 *   Reservation + order invoices are scoped precisely via the relation join.
 *   Rental invoices are scoped via the paymentRef-set approach described above.
 *
 * Refunds note:
 *   Cash refunds are NOT yet formal credit notes — they do not produce a counter-
 *   Invoice in the database. The `refunds` field is therefore informational only,
 *   derived from status/refundedAt on the underlying records (same definition as
 *   `getMonthlySourceSummary`).  When formal credit notes are introduced, this
 *   helper must be updated to include them in `lines` as well.
 *
 * VAT rate bucketing:
 *   InvoiceLine.vatRate is nullable. Lines with vatRate = null are bucketed under
 *   rate 0 (treated as zero-VAT — consistent with how PLATFORM reverse-charge lines
 *   are created with 0 VAT).
 */

import prisma from '../index'
import { round } from './payment'
import { RENTAL_REFUNDED, ORDER_REFUNDED } from './reservation-status'

// ─── Types ──────────────────────────────────────────────────────────────────

export interface VatRateBucket {
  /** VAT rate percent (e.g. 25.5, 14, 0). Null invoice-line vatRate maps to 0. */
  rate: number
  /** Sum of InvoiceLine.charge (net base amounts) for this rate. */
  net: number
  /** Sum of InvoiceLine.tax (VAT amounts) for this rate. */
  vat: number
  /** Sum of InvoiceLine.amount (gross) for this rate. */
  gross: number
}

export interface FiscalInvoiceLine {
  /** Invoice number (may be null for legacy invoices created before sequencing). */
  invoiceNumber: string | null
  /** When the invoice was dated. */
  invoicedAt: Date
  /** 'PARTNER' = venue sale; 'PLATFORM' = Sunbnb commission billed to the partner. */
  issuerType: string
  /** InvoiceLine.description — describes the line item (e.g. "Sunbed #3 - 2026-07-01"). */
  description: string | null
  /** InvoiceLine.charge — net base amount (excl. VAT). */
  net: number
  /** InvoiceLine.vatRate — may be null (treated as 0 for bucketing). */
  vatRate: number | null
  /** InvoiceLine.tax — VAT amount. */
  vat: number
  /** InvoiceLine.amount — gross (incl. VAT). */
  gross: number
  /** Invoice.paymentRef — links back to the payment transaction. */
  paymentRef: string | null
  /** Invoice.reverseCharge — true for cross-border EU B2B commission invoices. */
  reverseCharge: boolean
}

export interface MonthlyFiscalReport {
  // ─── Sales (PARTNER invoices) ────────────────────────────────────────────
  /** Number of PARTNER invoices in the period. */
  count: number
  /** Sum of PARTNER Invoice.totalAmount (gross consumer price). */
  gross: number
  /** Sum of PARTNER Invoice.totalCharge (net/base). */
  net: number
  /** Sum of PARTNER Invoice.totalTax (VAT). */
  vat: number
  /**
   * PARTNER invoice lines grouped by vatRate, sorted ascending by rate.
   * InvoiceLine.vatRate = null maps to rate 0.
   */
  vatByRate: VatRateBucket[]

  // ─── Costs / platform ────────────────────────────────────────────────────
  /** Sum of PLATFORM Invoice.totalAmount (B2B commission billed to the partner). */
  platformCommission: number
  /** True if any PLATFORM invoice in the period carries reverseCharge = true. */
  platformReverseCharge: boolean
  /**
   * Sum of Invoice.processingFee over PARTNER invoices (nulls treated as 0).
   * VAT-exempt PSP fees for the partner's reconciliation with their accountant.
   */
  processingFees: number

  // ─── Refunds (informational) ──────────────────────────────────────────────
  /**
   * Cash/manual refunds derived from reservation/order/rental status — NOT
   * formal credit notes. See module doc comment for the credit-note caveat.
   */
  refunds: { count: number; amount: number }

  // ─── Register rows (CSV export) ──────────────────────────────────────────
  /**
   * One row per invoice line (PARTNER + PLATFORM). Sorted by invoicedAt then
   * invoiceNumber for a stable, chronological register.
   */
  lines: FiscalInvoiceLine[]
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function utcDayStart(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

// ─── Main function ───────────────────────────────────────────────────────────

/**
 * Returns the monthly fiscal report for a site over the `[from, to)` window.
 * Pass whole-month bounds: `from = new Date('2026-07-01T00:00:00Z')`,
 * `to = new Date('2026-08-01T00:00:00Z')` (exclusive upper bound).
 *
 * The caller owns auth/ownership checks — this function takes a trusted `siteId`.
 */
export async function getMonthlyFiscalReport(
  siteId: string,
  from: Date,
  to: Date,
): Promise<MonthlyFiscalReport> {
  const rangeStart = utcDayStart(from)
  const rangeEnd = to // caller supplies exclusive upper bound directly

  // 1. Gather rental paymentRefs for this site so we can scope rental invoices.
  //    Both online refs (e.g. `tr_xxx`) and cash refs (`cash-rental-<id>`) are stored
  //    as paymentRef on RentalBooking — the Invoice.paymentRef mirrors that value.
  const rentalBookingsForSite = await prisma.rentalBooking.findMany({
    where: { siteId, paymentRef: { not: null } },
    select: { paymentRef: true },
  })
  const rentalPaymentRefs = rentalBookingsForSite
    .map((rb) => rb.paymentRef)
    .filter((ref): ref is string => ref !== null)

  // 2. Fetch all invoices for this site in the window (PARTNER + PLATFORM).
  //    Scoping: reservation.siteId | order.siteId | paymentRef IN rentalPaymentRefs.
  const invoices = await prisma.invoice.findMany({
    where: {
      invoicedAt: { gte: rangeStart, lt: rangeEnd },
      OR: [
        { reservation: { siteId } },
        { order: { siteId } },
        ...(rentalPaymentRefs.length > 0
          ? [{ paymentRef: { in: rentalPaymentRefs } }]
          : []),
      ],
    },
    include: {
      invoiceLines: true,
    },
    orderBy: [{ invoicedAt: 'asc' }, { invoiceNumber: 'asc' }],
  })

  // 3. Aggregate PARTNER and PLATFORM invoices separately.
  let partnerCount = 0
  let partnerGross = 0
  let partnerNet = 0
  let partnerVat = 0
  let processingFeesSum = 0

  let platformCommission = 0
  let platformReverseCharge = false

  // VAT bucketing (PARTNER lines only)
  const vatBuckets = new Map<number, { net: number; vat: number; gross: number }>()

  // Register rows (PARTNER + PLATFORM lines)
  const lines: FiscalInvoiceLine[] = []

  for (const inv of invoices) {
    if (inv.issuerType === 'PARTNER') {
      partnerCount += 1
      partnerGross += inv.totalAmount
      partnerNet += inv.totalCharge
      partnerVat += inv.totalTax
      processingFeesSum += inv.processingFee ?? 0

      for (const line of inv.invoiceLines) {
        const rate = line.vatRate ?? 0
        const cur = vatBuckets.get(rate) ?? { net: 0, vat: 0, gross: 0 }
        cur.net += line.charge
        cur.vat += line.tax
        cur.gross += line.amount
        vatBuckets.set(rate, cur)

        lines.push({
          invoiceNumber: inv.invoiceNumber ?? null,
          invoicedAt: inv.invoicedAt,
          issuerType: inv.issuerType,
          description: line.description ?? null,
          net: line.charge,
          vatRate: line.vatRate ?? null,
          vat: line.tax,
          gross: line.amount,
          paymentRef: inv.paymentRef ?? null,
          reverseCharge: inv.reverseCharge,
        })
      }
    } else if (inv.issuerType === 'PLATFORM') {
      platformCommission += inv.totalAmount
      if (inv.reverseCharge) platformReverseCharge = true

      for (const line of inv.invoiceLines) {
        lines.push({
          invoiceNumber: inv.invoiceNumber ?? null,
          invoicedAt: inv.invoicedAt,
          issuerType: inv.issuerType,
          description: line.description ?? null,
          net: line.charge,
          vatRate: line.vatRate ?? null,
          vat: line.tax,
          gross: line.amount,
          paymentRef: inv.paymentRef ?? null,
          reverseCharge: inv.reverseCharge,
        })
      }
    }
  }

  // vatByRate: sort ascending by rate, round aggregates
  const vatByRate: VatRateBucket[] = Array.from(vatBuckets.entries())
    .sort(([a], [b]) => a - b)
    .map(([rate, sums]) => ({
      rate,
      net: round(sums.net),
      vat: round(sums.vat),
      gross: round(sums.gross),
    }))

  // 4. Refunds — informational; derived from source record status (not invoice credit notes).
  //    Same definition as getMonthlySourceSummary:
  //      reservations with refundedAt != null (createdAt in range)
  //      rental bookings with status = RENTAL_REFUNDED (createdAt in range)
  //      orders with status = ORDER_REFUNDED (createdAt in range)
  const [refundedReservations, refundedRentals, refundedOrders] = await Promise.all([
    prisma.reservation.findMany({
      where: {
        siteId,
        refundedAt: { not: null },
        createdAt: { gte: rangeStart, lt: rangeEnd },
      },
      select: { paymentAmount: true },
    }),
    prisma.rentalBooking.findMany({
      where: {
        siteId,
        status: RENTAL_REFUNDED,
        createdAt: { gte: rangeStart, lt: rangeEnd },
      },
      select: { paymentAmount: true },
    }),
    prisma.order.findMany({
      where: {
        siteId,
        status: ORDER_REFUNDED,
        createdAt: { gte: rangeStart, lt: rangeEnd },
      },
      select: { paymentAmount: true },
    }),
  ])

  let refundAmount = 0
  for (const r of refundedReservations) refundAmount += r.paymentAmount ?? 0
  for (const r of refundedRentals) refundAmount += r.paymentAmount ?? 0
  for (const o of refundedOrders) refundAmount += o.paymentAmount ?? 0

  const refunds = {
    count: refundedReservations.length + refundedRentals.length + refundedOrders.length,
    amount: round(refundAmount),
  }

  return {
    count: partnerCount,
    gross: round(partnerGross),
    net: round(partnerNet),
    vat: round(partnerVat),
    vatByRate,
    platformCommission: round(platformCommission),
    platformReverseCharge,
    processingFees: round(processingFeesSum),
    refunds,
    lines,
  }
}
