/**
 * The AEAT QR block for an invoice — ONE builder, for every document that
 * renders one (track 026 phase 6a).
 *
 * No prisma: it takes the invoice row's fields, so a caller that has already
 * loaded the invoice pays nothing for it.
 *
 * ## Why this had to be extracted, and the bug it fixes
 *
 * `receipt.ts` built this inline and resolved the regime from
 * `invoice.account.country`. That is right for a consumer receipt, where the
 * account IS the issuing partner — and wrong for our own commission invoice,
 * where `Invoice.accountId` is the **recipient**. The consequences were both
 * directions of wrong:
 *
 *  - our commission invoice to the FINNISH partner resolved to `NONE` and got no
 *    QR, although the issuer is Sunbnb España SL, a Veri*factu filer that owes
 *    one under art. 20;
 *  - our commission invoice to a Spanish partner got a QR for the right reason
 *    by accident, and would have lost it the moment that partner turned out to
 *    be foral — a property of the recipient deciding the issuer's regime.
 *
 * It never bit because nothing rendered a PLATFORM invoice until phase 6a. The
 * fix is to ask `resolveInvoiceIssuerJurisdiction`, which exists for exactly
 * this and is already what the record writer and the health check use — so the
 * document and the filing can no longer disagree about whether an invoice is
 * Spanish.
 *
 * It is the same shape of defect as the constant `ES` platform jurisdiction
 * phase 5 recorded: the issuer of a PLATFORM invoice is identified by its tax
 * id and by nothing else on the row.
 */

import type { ReceiptFiscal } from './receipt-model'
import { resolveTaxRegime } from './tax/regime'
import {
  resolveInvoiceIssuerJurisdiction,
  type InvoiceIssuerFields,
} from './tax/es-verifactu/record'
import { buildInvoiceQrUrl, QR_LABEL_ABOVE, QR_LEGEND_BELOW } from './tax/es-verifactu/qr'
import { ES_ISSUER_TIME_ZONE, formatFechaExpedicion } from './tax/es-verifactu/huella'

/** What the QR needs, beyond the fields that identify the issuer. */
export type FiscalInvoiceFields = InvoiceIssuerFields & {
  id: string
  invoiceNumber: string | null
  invoicedAt: Date
  totalAmount: number
}

/**
 * The QR + legend for this invoice, or null when its issuer is not a Spanish
 * Veri*factu filer.
 *
 * Null is the ordinary case outside Spain — a presenter renders nothing, not a
 * gap. It is ALSO what a Spanish invoice gets when the QR cannot be built
 * (a missing number, say), and that case is logged rather than thrown: the
 * document is the legal obligation and must still be issued. A Spanish invoice
 * reaching a reader without a QR is the same defect as one without a record,
 * and is surfaced by the same P9 alert rather than by refusing the document.
 */
export function buildInvoiceFiscal(invoice: FiscalInvoiceFields): ReceiptFiscal | null {
  const regime = resolveTaxRegime(resolveInvoiceIssuerJurisdiction(invoice))
  if (regime !== 'ES_VERIFACTU') return null

  const qr = buildInvoiceQrUrl({
    issuerNif: invoice.issuerVatNumber ?? '',
    invoiceNumber: invoice.invoiceNumber ?? '',
    fechaExpedicion: formatFechaExpedicion(invoice.invoicedAt, ES_ISSUER_TIME_ZONE),
    totalAmount: invoice.totalAmount,
  })
  if (!qr.ok) {
    console.error(`[Verifactu] ${invoice.invoiceNumber ?? invoice.id} gets no QR: ${qr.reason}`)
    return null
  }

  // Absolute when configured, because the emailed receipt is the copy a guest
  // keeps and a relative src is silently blank there. The relative fallback
  // keeps local development working without the env var. The image is served by
  // the user app for every surface, so there is one encoder rather than one per
  // app.
  const base = (process.env.CONSUMER_APP_URL ?? '').replace(/\/+$/, '')
  return {
    qrUrl: qr.url,
    qrImageUrl: `${base}/api/receipts/${invoice.id}/qr.png`,
    labelAbove: QR_LABEL_ABOVE,
    legendBelow: QR_LEGEND_BELOW,
  }
}
