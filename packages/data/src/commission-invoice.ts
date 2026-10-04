/**
 * Loading our own commission invoices — the PLATFORM side of invoicing, which
 * had no reader at all (track 026 phase 6a).
 *
 * The types live in `./commission-invoice-model`, which is pure; this module
 * imports prisma and must only ever be called from the server.
 *
 * ## Ownership is checked here, not left to the caller
 *
 * Every function takes the `accountId` whose invoices are being read and scopes
 * the query by it. A commission invoice names the partner's tax id and what they
 * were charged, so handing one to the wrong partner is a data leak with a legal
 * flavour — and `Invoice.accountId` on a PLATFORM row IS the recipient, so the
 * scope is a single `where` clause. Doing it here rather than in each surface
 * means a second surface cannot forget.
 */

import prisma from '../index'
import { buildInvoiceFiscal } from './invoice-fiscal'
import { formatIssuedAt } from './receipt-model'
import type {
  CommissionInvoiceModel,
  CommissionInvoiceSummary,
} from './commission-invoice-model'

/**
 * Everything the model reads. An `include` would also work, but the fields are
 * named here so adding one to the model is a compile error rather than a silent
 * `undefined` — the lesson `INVOICE_ROW_INCLUDE` in `receipt.ts` records.
 */
const SELECT = {
  id: true,
  invoiceNumber: true,
  invoicedAt: true,
  issuerType: true,
  issuerCompanyName: true,
  issuerVatNumber: true,
  issuerCompanyAddress: true,
  recipientCompanyName: true,
  recipientVatNumber: true,
  recipientCompanyAddress: true,
  totalCharge: true,
  totalTax: true,
  totalAmount: true,
  reverseCharge: true,
  invoiceLines: {
    select: {
      description: true,
      charge: true,
      vatRate: true,
      tax: true,
      amount: true,
    },
  },
  // Present for `buildInvoiceFiscal`'s signature. On a PLATFORM invoice it is
  // the RECIPIENT and is deliberately unused for the regime — the resolver keys
  // on the issuing tax id. Selected rather than omitted so the shared builder
  // takes one shape for both document types.
  account: { select: { country: true, taxRegion: true } },
} as const

/**
 * One month of commission invoices for a partner, newest first.
 *
 * Bounded in UTC rather than in the venue's timezone, unlike the accounting
 * page's revenue figures. That is deliberate and not an oversight: a commission
 * invoice is OUR document, issued by a Spanish company, and it is not attached
 * to any one venue — a partner with sites in two timezones has no single local
 * month for it. `invoicedAt` is also what the invoice itself prints.
 */
export async function listCommissionInvoices(
  accountId: string,
  year: number,
  month: number,
): Promise<CommissionInvoiceSummary[]> {
  const rows = await prisma.invoice.findMany({
    where: {
      accountId,
      issuerType: 'PLATFORM',
      invoicedAt: {
        gte: new Date(Date.UTC(year, month - 1, 1)),
        lt: new Date(Date.UTC(year, month, 1)),
      },
    },
    select: {
      id: true,
      invoiceNumber: true,
      invoicedAt: true,
      totalCharge: true,
      totalTax: true,
      totalAmount: true,
      reverseCharge: true,
    },
    orderBy: { invoicedAt: 'desc' },
  })

  return rows.map((r) => ({
    invoiceId: r.id,
    invoiceNumber: r.invoiceNumber,
    invoicedAt: r.invoicedAt,
    totalCharge: r.totalCharge,
    totalTax: r.totalTax,
    totalAmount: r.totalAmount,
    reverseCharge: r.reverseCharge,
  }))
}

/**
 * The full document for one commission invoice, or null.
 *
 * Null covers both "no such invoice" and "not this partner's", on purpose: the
 * caller renders a 404 either way, and distinguishing them would confirm the
 * existence of another partner's invoice to anyone who guessed an id.
 */
export async function buildCommissionInvoice(
  invoiceId: string,
  accountId: string,
): Promise<CommissionInvoiceModel | null> {
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, accountId, issuerType: 'PLATFORM' },
    select: SELECT,
  })
  if (!invoice) return null

  return {
    invoiceId: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    issuedAt: formatIssuedAt(invoice.invoicedAt),
    issuedOn: invoice.invoicedAt.toISOString().slice(0, 10),
    issuer: {
      name: invoice.issuerCompanyName ?? '',
      vatId: invoice.issuerVatNumber,
      address: invoice.issuerCompanyAddress,
    },
    recipient: {
      name: invoice.recipientCompanyName ?? '',
      vatId: invoice.recipientVatNumber,
      address: invoice.recipientCompanyAddress,
    },
    lines: invoice.invoiceLines.map((l) => ({
      description: l.description,
      charge: l.charge,
      vatRate: l.vatRate,
      vat: l.tax,
      total: l.amount,
    })),
    subtotalCharge: invoice.totalCharge,
    subtotalVat: invoice.totalTax,
    totalAmount: invoice.totalAmount,
    reverseCharge: invoice.reverseCharge,
    fiscal: buildInvoiceFiscal(invoice),
  }
}

/**
 * Which months have commission invoices, newest first.
 *
 * Feeds the month picker. Without it the list opens on the current month, which
 * for a seasonal beach business is empty for seven months of the year and looks
 * like the feature is broken.
 */
export async function commissionInvoiceMonths(
  accountId: string,
): Promise<{ year: number; month: number; count: number }[]> {
  const rows = await prisma.$queryRaw<{ year: number; month: number; count: bigint }[]>`
    SELECT EXTRACT(YEAR FROM invoiced_at)::int AS year,
           EXTRACT(MONTH FROM invoiced_at)::int AS month,
           COUNT(*) AS count
      FROM "Invoice"
     WHERE account_id = ${accountId}
       AND issuer_type = 'PLATFORM'
     GROUP BY 1, 2
     ORDER BY 1 DESC, 2 DESC
  `
  return rows.map((r) => ({ year: r.year, month: r.month, count: Number(r.count) }))
}
