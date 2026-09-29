/**
 * Monthly fiscal report for the partner accounting export — the invoice-based
 * register an entrepreneur hands their accountant.
 *
 * This is a READ-ONLY helper; no writes, no auth (the caller's responsibility).
 *
 * Site scoping — every way an Invoice can belong to a site:
 *   - Reservation invoices:  reservation.siteId = siteId  (PARTNER + PLATFORM)
 *   - Order invoices:        order.siteId = siteId        (PARTNER + PLATFORM)
 *   - Dine-in tab invoices:  tableTab.siteId = siteId
 *   - Table deposits:        tableReservation.restaurant.siteId = siteId
 *   - Rental invoices:       no direct FK on Invoice → siteId; linked only via
 *     paymentRef on RentalBooking.  We fetch the set of paymentRefs belonging to
 *     the site's RentalBookings (both online refs like `tr_…` and cash refs like
 *     `cash-rental-<id>`) and match Invoice.paymentRef IN (...).  This is a
 *     single extra findMany on RentalBooking + an IN clause on Invoice — acceptable
 *     for a monthly report.
 *
 *   The tab and deposit branches were MISSING until 2026-09-29: a register that
 *   is handed to an accountant, and that will become the evidence base for
 *   Veri*factu, silently omitted every dine-in and deposit invoice belonging to
 *   a site-LINKED restaurant. No production row was affected when this was
 *   fixed — the only restaurant there is standalone — so this is a hole closed
 *   before the first linked restaurant falls into it, not a correction.
 *
 *   A STANDALONE restaurant (dine-in v2, `Restaurant.siteId = null`) has no site,
 *   so its tabs cannot appear in any site-scoped register. That is correct, not a
 *   gap — those invoices belong to the restaurant's own report
 *   (`getRestaurantTabInvoicesByMonth` in the partner app), and a site register
 *   claiming them would be double-counting.
 *
 * Refunds:
 *   Formal credit notes now exist (`issueCashCreditNote`, series
 *   `PARTNER-CN-YYYY-NNNNN`). A credit note is a NEGATIVE PARTNER invoice, so it
 *   already flows through `count`, `gross`, `net`, `vat` and `lines` as a
 *   document in its own right — that is what a register is supposed to show, and
 *   it is why the totals here are net of refunds without anything being
 *   subtracted twice.
 *
 *   `refunds` reports those credit notes (count + positive magnitude) so the
 *   partner can see the refund side explicitly. `unInvoicedRefunds` is the
 *   residual: source records marked refunded that produced NO credit note. It
 *   exists to be watched, not to be added to anything — it should trend to zero,
 *   and a non-zero value means money moved without a document.
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

  // ─── Refunds ──────────────────────────────────────────────────────────────
  /**
   * Formal credit notes dated in the period: how many, and their total as a
   * POSITIVE magnitude (the invoices themselves carry negative totals).
   *
   * Do NOT subtract this from `gross`/`net`/`vat` — those are already net of it,
   * because a credit note is itself a PARTNER invoice in the set.
   */
  refunds: { count: number; amount: number }
  /**
   * Refunds that never became a credit note — source records flagged refunded
   * with no crediting document anywhere in the ledger.
   *
   * A watchdog, not an accounting figure. Rentals and orders can only ever land
   * here today: `issueCashCreditNote` covers reservations only. Anything here is
   * money that moved without a document, which is exactly what a fiscal register
   * must not hide.
   */
  unInvoicedRefunds: { count: number; amount: number }

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
        // Dine-in tabs and table deposits were MISSING from this list until
        // 2026-09-29, so a LINKED restaurant's invoices were silently absent
        // from the register an accountant is handed. Both FKs are indexed on
        // Invoice. (Production's only restaurant is standalone, so no real row
        // was ever wrongly omitted — this closes the hole before the first
        // site-linked restaurant walks into it.)
        { tableTab: { siteId } },
        // A deposit has no siteId of its own — it hangs off the restaurant,
        // and only a LINKED restaurant has a site. See the module header.
        { tableReservation: { restaurant: { siteId } } },
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

  // Credit notes are PARTNER invoices with a crediting link; they are counted
  // as documents above AND reported separately here, never subtracted twice.
  let creditNoteCount = 0
  let creditNoteAmount = 0

  for (const inv of invoices) {
    if (inv.issuerType === 'PARTNER') {
      partnerCount += 1
      if (inv.creditsInvoiceId != null) {
        creditNoteCount += 1
        creditNoteAmount += Math.abs(inv.totalAmount)
      }
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

  // 4. The refund residual — source records flagged refunded that produced no
  //    crediting document. The credited ones are already counted above, as the
  //    negative invoices they are.
  //
  //    Window: the SOURCE record's createdAt, which is the definition
  //    `getMonthlySourceSummary` uses and is kept for comparability. Note it does
  //    not match the credit note's own `invoicedAt` window — a sale refunded in a
  //    later month is deliberately reported against the month it was sold.
  const [refundedReservations, refundedRentals, refundedOrders] = await Promise.all([
    prisma.reservation.findMany({
      where: {
        siteId,
        refundedAt: { not: null },
        createdAt: { gte: rangeStart, lt: rangeEnd },
      },
      select: { id: true, paymentAmount: true },
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

  // Which of those reservations DO have a credit note — searched across all time,
  // not just this window: a July sale refunded in August is fully documented, and
  // reporting it as un-invoiced in July would be a false alarm every month-end.
  const refundedReservationIds = refundedReservations.map((r) => r.id)
  const creditedReservationIds = new Set(
    refundedReservationIds.length > 0
      ? (
          await prisma.invoice.findMany({
            where: {
              reservationId: { in: refundedReservationIds },
              creditsInvoiceId: { not: null },
            },
            select: { reservationId: true },
          })
        )
          .map((inv) => inv.reservationId)
          .filter((id): id is string => id !== null)
      : [],
  )

  let unInvoicedCount = 0
  let unInvoicedAmount = 0
  for (const r of refundedReservations) {
    if (creditedReservationIds.has(r.id)) continue
    unInvoicedCount += 1
    unInvoicedAmount += r.paymentAmount ?? 0
  }
  // Rentals and orders have no credit-note path at all yet, so every refunded one
  // is by definition un-invoiced.
  for (const r of refundedRentals) {
    unInvoicedCount += 1
    unInvoicedAmount += r.paymentAmount ?? 0
  }
  for (const o of refundedOrders) {
    unInvoicedCount += 1
    unInvoicedAmount += o.paymentAmount ?? 0
  }

  const refunds = { count: creditNoteCount, amount: round(creditNoteAmount) }
  const unInvoicedRefunds = { count: unInvoicedCount, amount: round(unInvoicedAmount) }

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
    unInvoicedRefunds,
    lines,
  }
}
