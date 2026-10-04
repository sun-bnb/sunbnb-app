/**
 * The shape of OUR OWN commission invoice — the B2B document Sunbnb issues to a
 * partner (track 026 phase 6a).
 *
 * PURE and CLIENT-SAFE — types and formatting only, no prisma. Same split as
 * `receipt-model` / `receipt`, for the same reason: the presenter is a client
 * component and must not drag a database client into the browser.
 *
 * ## Why this is not `ReceiptModel`
 *
 * They are different documents and the differences are structural, not
 * cosmetic:
 *
 *  - A receipt has ONE party, the merchant. This has TWO — we are the issuer and
 *    the partner is the recipient — because it is an ordinary *factura completa*
 *    (`F1`) rather than a *factura simplificada* (`F2`). `ReceiptModel` has no
 *    recipient block at all, and its own header explains that it must not grow a
 *    platform section.
 *  - The amounts mean something else. A receipt's total is what a consumer paid;
 *    this is commission billed TO the partner, and under the agent model the two
 *    deliberately do not sum to anything.
 *  - It can carry a reverse-charge declaration, which a consumer receipt never
 *    does.
 *
 * What they DO share is the fiscal furniture, which is reused rather than
 * reimplemented: `ReceiptFiscal` and the formatters come from `receipt-model`,
 * and the QR block itself from `invoice-fiscal`.
 *
 * ## Why this document has to exist at all
 *
 * Not for Veri*factu. We bill partners monthly and, before this phase, a
 * partner could see only a year-to-date total on their dashboard — there was no
 * per-invoice document anywhere, and `getInvoicesByMonth` filters
 * `issuerType: 'PARTNER'`, so they could not even list them. A business that
 * invoices another business owes it a document it can put in its own books;
 * that is ordinary invoicing law, and it was simply missing. The QR and the
 * legend are what RD 1007/2023 then adds on top, and art. 20 has nowhere to
 * attach without the document.
 */

import type { ReceiptFiscal, ReceiptLine } from './receipt-model'

/** A party on the invoice. Both sides are identified; neither is optional. */
export interface CommissionParty {
  name: string
  vatId: string | null
  address: string | null
}

export interface CommissionInvoiceModel {
  invoiceId: string
  invoiceNumber: string | null
  /** `YYYY-MM-DD HH:MM:SS`, when the invoice was issued. */
  issuedAt: string
  /** Date alone, for the document header. */
  issuedOn: string
  /** Us. */
  issuer: CommissionParty
  /** The partner being billed. */
  recipient: CommissionParty
  lines: ReceiptLine[]
  subtotalCharge: number
  subtotalVat: number
  totalAmount: number
  /**
   * True when the issuer charged 0 VAT because the recipient self-accounts
   * (cross-border EU B2B). The presenter MUST print the declaration when this
   * is set — art. 6.1.m RD 1619/2012 requires the invoice to state the reason
   * VAT was not charged, and an invoice with a 0 total and no explanation is
   * not a valid one.
   */
  reverseCharge: boolean
  /**
   * The Spanish fiscal block, or null when our issuing entity is not a
   * Veri*factu filer.
   *
   * Null is reachable and legitimate: the platform has more than one legal
   * entity and only the Spanish one files. Resolved from the ISSUING tax id,
   * never from the recipient — see `invoice-fiscal` for the bug that caused.
   */
  fiscal: ReceiptFiscal | null
}

/** One row of the list, cheap enough to render a year of them. */
export interface CommissionInvoiceSummary {
  invoiceId: string
  invoiceNumber: string | null
  invoicedAt: Date
  totalCharge: number
  totalTax: number
  totalAmount: number
  reverseCharge: boolean
}

/**
 * The reverse-charge declaration, in both languages that matter.
 *
 * Fixed legal wording, deliberately NOT routed through next-intl: a locale file
 * must not be able to change what an invoice declares about its own VAT
 * treatment. Same reasoning as `QR_LABEL_ABOVE` / `QR_LEGEND_BELOW`.
 */
export const REVERSE_CHARGE_NOTE =
  'Inversión del sujeto pasivo — operación no sujeta a IVA español (art. 84.Uno.2º LIVA). ' +
  'VAT reverse charge: the recipient accounts for VAT.'
