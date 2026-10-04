/**
 * Build a consumer receipt from whatever produced it (track 026 phase 4).
 *
 * ONE loader for four kinds. Previously each route carried its own query and
 * its own mapping: the reservation route and the rental route were near-copies
 * down to a duplicated `extractCountryCode`, and dine-in tabs had no receipt at
 * all — which is not a rendering gap but the primary obligation unmet, since
 * issuing the receipt is the duty and the QR on it is decoration.
 *
 * READ-ONLY. No auth: ownership belongs to the caller, which is where the
 * session lives. The result carries the owner ids so a route can check them
 * without re-querying — `owner: null` means the kind has no owner to check
 * (a dine-in tab is reached by its QR URL, which IS the credential).
 *
 * Always the PARTNER invoice. See `ReceiptModel.grandTotal` for why a consumer
 * receipt must not show the platform's commission.
 */

import prisma from '../index'
import { formatSeatId } from './seat-label'
import { buildInvoiceFiscal } from './invoice-fiscal'
import {
  extractVatCountryCode,
  formatIssuedAt,
  formatStayPeriod,
  type ReceiptKind,
  type ReceiptModel,
} from './receipt-model'

export interface ReceiptOwner {
  userId: string | null
  anonId: string | null
}

export type ReceiptResult =
  | { status: 'ok'; receipt: ReceiptModel; owner: ReceiptOwner | null }
  /** The source record does not exist. */
  | { status: 'not-found' }
  /**
   * The record exists but has no PARTNER invoice yet — an unpaid or in-flight
   * sale, or a cash sale whose receipt write failed. Distinct from `not-found`
   * because the right answer is "not ready", not "no such thing".
   */
  | { status: 'no-invoice' }

/**
 * Everything `toModel` reads off an invoice. Shared by the nested includes and
 * the two kinds that query `Invoice` directly — they used to carry their own
 * `{ invoiceLines: true }`, so a field added here would have been silently
 * absent on rentals and tabs.
 */
const INVOICE_ROW_INCLUDE = {
  invoiceLines: true,
  // The issuer's jurisdiction, for the Veri*factu gate. Read off the invoice
  // rather than off the site's owner because the invoice is the document being
  // described, and the two can differ for a standalone restaurant.
  account: { select: { country: true, taxRegion: true } },
} as const

const INVOICE_INCLUDE = {
  invoices: { include: INVOICE_ROW_INCLUDE },
} as const

const SITE_INCLUDE = {
  site: { include: { user: { include: { partnerAccount: true } } } },
} as const

type InvoiceRow = {
  id: string
  invoiceNumber: string | null
  invoicedAt: Date
  /** Needed to resolve the ISSUER's jurisdiction — see `buildInvoiceFiscal`. */
  issuerType: string
  issuerCompanyName: string | null
  issuerVatNumber: string | null
  issuerCompanyAddress: string | null
  totalCharge: number
  totalTax: number
  totalAmount: number
  invoiceLines: {
    description: string | null
    charge: number
    vatRate: number | null
    tax: number
    amount: number
  }[]
  account: { country: string | null; taxRegion: string | null } | null
}

/** The PARTNER invoice, or null. Credit notes carry a crediting link and are
 *  not the receipt for the sale. */
function partnerInvoiceOf(
  invoices: (InvoiceRow & { issuerType: string; creditsInvoiceId?: string | null })[],
): InvoiceRow | null {
  return invoices.find((i) => i.issuerType === 'PARTNER' && !i.creditsInvoiceId) ?? null
}

function toModel(
  kind: ReceiptKind,
  invoice: InvoiceRow,
  context: {
    siteName: string | null
    periodLabel?: string | null
    seatNumbers?: string | null
    tableLabel?: string | null
    fallbackMerchantName: string
    merchantPhone: string | null
  },
): ReceiptModel {
  return {
    kind,
    invoiceNumber: invoice.invoiceNumber,
    issuedAt: formatIssuedAt(invoice.invoicedAt),
    siteName: context.siteName,
    periodLabel: context.periodLabel ?? null,
    seatNumbers: context.seatNumbers ?? null,
    tableLabel: context.tableLabel ?? null,
    merchant: {
      name: invoice.issuerCompanyName ?? context.fallbackMerchantName,
      vatId: invoice.issuerVatNumber,
      address: invoice.issuerCompanyAddress,
      phone: context.merchantPhone,
    },
    vatCountryCode: extractVatCountryCode(invoice.invoiceLines),
    lines: invoice.invoiceLines.map((l) => ({
      description: l.description,
      charge: l.charge,
      vatRate: l.vatRate,
      vat: l.tax,
      total: l.amount,
    })),
    subtotalCharge: invoice.totalCharge,
    subtotalVat: invoice.totalTax,
    subtotalAmount: invoice.totalAmount,
    grandTotal: invoice.totalAmount,
    fiscal: buildInvoiceFiscal(invoice),
  }
}

export async function buildReservationReceipt(id: string): Promise<ReceiptResult> {
  const reservation = await prisma.reservation.findUnique({
    where: { id },
    include: { items: true, ...SITE_INCLUDE, ...INVOICE_INCLUDE },
  })
  if (!reservation) return { status: 'not-found' }

  const invoice = partnerInvoiceOf(reservation.invoices as never)
  if (!invoice) return { status: 'no-invoice' }

  const account = reservation.site?.user?.partnerAccount ?? null
  return {
    status: 'ok',
    owner: { userId: reservation.userId ?? null, anonId: reservation.anonId ?? null },
    receipt: toModel('reservation', invoice, {
      siteName: reservation.site?.name ?? null,
      periodLabel: formatStayPeriod(reservation.from, reservation.to),
      seatNumbers:
        reservation.items?.map((item) => formatSeatId(item)).join(', ') || null,
      fallbackMerchantName: account?.company ?? 'Partner',
      merchantPhone: account?.phoneNumber ?? null,
    }),
  }
}

export async function buildOrderReceipt(orderId: string): Promise<ReceiptResult> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { orderItems: true, ...SITE_INCLUDE, ...INVOICE_INCLUDE },
  })
  if (!order) return { status: 'not-found' }

  const invoice = partnerInvoiceOf(order.invoices as never)
  if (!invoice) return { status: 'no-invoice' }

  const account = order.site?.user?.partnerAccount ?? null
  return {
    status: 'ok',
    owner: { userId: order.userId ?? null, anonId: order.anonId ?? null },
    receipt: toModel('order', invoice, {
      siteName: order.site?.name ?? null,
      fallbackMerchantName: account?.company ?? 'Partner',
      merchantPhone: account?.phoneNumber ?? null,
    }),
  }
}

export async function buildRentalReceipt(bookingId: string): Promise<ReceiptResult> {
  const booking = await prisma.rentalBooking.findUnique({
    where: { id: bookingId },
    include: { ...SITE_INCLUDE, rentalItem: true },
  })
  if (!booking) return { status: 'not-found' }
  // A rental has no FK to its invoice — the group shares a paymentRef, which is
  // the only link. Bookings paid together therefore share one receipt.
  if (!booking.paymentRef) return { status: 'no-invoice' }

  const invoices = await prisma.invoice.findMany({
    where: { paymentRef: booking.paymentRef },
    include: INVOICE_ROW_INCLUDE,
  })
  const invoice = partnerInvoiceOf(invoices as never)
  if (!invoice) return { status: 'no-invoice' }

  const account = booking.site?.user?.partnerAccount ?? null
  return {
    status: 'ok',
    owner: { userId: booking.userId ?? null, anonId: booking.anonId ?? null },
    receipt: toModel('rental', invoice, {
      siteName: booking.site?.name ?? null,
      periodLabel: formatStayPeriod(booking.from, booking.to),
      fallbackMerchantName: account?.company ?? 'Partner',
      merchantPhone: account?.phoneNumber ?? null,
    }),
  }
}

/**
 * Dine-in tab — the surface that had no receipt at all.
 *
 * `owner: null`: a tab is reached through the table's QR URL, which is itself
 * the credential (the same rule the tab ordering and payment routes follow).
 * Adding an ownership check here would lock a guest out of the receipt for the
 * meal they just paid for.
 */
export async function buildTabReceipt(tabId: string): Promise<ReceiptResult> {
  const tab = await prisma.tableTab.findUnique({
    where: { id: tabId },
    include: {
      table: true,
      site: true,
      restaurant: { include: { partnerAccount: true } },
    },
  })
  if (!tab) return { status: 'not-found' }

  const invoices = await prisma.invoice.findMany({
    where: { tableTabId: tabId },
    include: INVOICE_ROW_INCLUDE,
  })
  const invoice = partnerInvoiceOf(invoices as never)
  if (!invoice) return { status: 'no-invoice' }

  const account = tab.restaurant?.partnerAccount ?? null
  const table = tab.table
  return {
    status: 'ok',
    owner: null,
    receipt: toModel('tab', invoice, {
      // A standalone restaurant has no site; its own name is the venue.
      siteName: tab.site?.name ?? tab.restaurant?.name ?? null,
      tableLabel: table ? (table.label ?? String(table.number)) : null,
      fallbackMerchantName: account?.company ?? tab.restaurant?.name ?? 'Partner',
      merchantPhone: account?.phoneNumber ?? null,
    }),
  }
}
