/**
 * The shape of a consumer receipt (track 026 phase 4).
 *
 * PURE and CLIENT-SAFE — types and formatting only, no prisma. The loader that
 * fills this in lives in `./receipt`, which does import prisma; the split is the
 * same one `payment-math` has from `payment`, and exists so the three renderers
 * can share a contract without dragging a database client into the browser.
 *
 * ## Why this type exists at all
 *
 * A receipt was rendered by three hand-maintained presenters — the HTML view,
 * the `@react-pdf/renderer` document and the email template — over a DTO each
 * route built for itself. They had already drifted: the email showed a VAT
 * RATE column where the other two showed a VAT AMOUNT. Two of the loaders were
 * near-copies of each other, `extractCountryCode` and the section mapping
 * included, and a fourth surface (dine-in tabs) had no receipt at all.
 *
 * One model, three presenters. A presenter may choose what to show; it may not
 * compute anything, because that is how they drifted in the first place.
 */

/** What produced this receipt. Decides which contextual fields are populated. */
export type ReceiptKind = 'reservation' | 'order' | 'rental' | 'tab'

export interface ReceiptLine {
  description: string | null
  /** Net, excluding VAT. */
  charge: number
  /** Percent, or null when the line predates per-line rates. */
  vatRate: number | null
  /** VAT amount. */
  vat: number
  /** Gross. */
  total: number
}

/** The issuing merchant — the PARTNER, who is the seller of record. */
export interface ReceiptMerchant {
  name: string
  vatId: string | null
  address: string | null
  phone: string | null
}

export interface ReceiptModel {
  kind: ReceiptKind
  invoiceNumber: string | null
  /** `YYYY-MM-DD HH:MM:SS`, when the invoice was issued. */
  issuedAt: string
  siteName: string | null
  /**
   * The stay or hire window, already formatted — a single date when it opens
   * and closes on the same day, a range otherwise. Null when the kind has no
   * period (an order, a tab).
   */
  periodLabel: string | null
  /** Comma-separated seat ids, for a sunbed reservation. */
  seatNumbers: string | null
  /** Table number or label, for a dine-in tab. */
  tableLabel: string | null
  merchant: ReceiptMerchant
  /**
   * Country code scraped from a service-fee line, shown beside the VAT total.
   * Null when no line carries one.
   */
  vatCountryCode: string | null
  lines: ReceiptLine[]
  subtotalCharge: number
  subtotalVat: number
  subtotalAmount: number
  /**
   * What the consumer paid — always the PARTNER invoice total.
   *
   * There is deliberately NO platform section on a consumer receipt. Under the
   * agent model the consumer buys from the partner and pays the listed price;
   * the platform's commission is a separate B2B invoice billed TO the partner,
   * and the two do not sum to what the consumer paid. Showing it here would
   * present the guest with a number they did not pay and are not party to. The
   * old DTO carried a `platformSection` that every route set to null — the
   * branch was unreachable, and this is why it should stay that way.
   */
  grandTotal: number
}

/** Two decimals, no currency symbol — presenters add their own. */
export function formatReceiptAmount(value: number): string {
  return value.toFixed(2)
}

/** `YYYY-MM-DD HH:MM:SS` in UTC, the form every presenter renders. */
export function formatIssuedAt(at: Date): string {
  const iso = at.toISOString()
  return `${iso.substring(0, 10)} ${iso.substring(11, 19)}`
}

/**
 * Country code out of a service-fee description like
 * `Reservation service fee (FI)`.
 *
 * A scrape, and it stays a scrape on purpose: the country is not stored on the
 * invoice, only rendered into that one line by the fee cascade. Worth knowing
 * before anyone relies on it for something load-bearing.
 */
export function extractVatCountryCode(
  lines: { description: string | null }[],
): string | null {
  for (const line of lines) {
    const match = line.description?.match(/\(([A-Z]{2,3})\)\s*$/)
    if (match) return match[1]!
  }
  return null
}

/**
 * Format a stay window as a date or a range.
 *
 * `from`/`to` are stored as UTC from startOf/endOf('day') in the guest's local
 * timezone, so both are nudged half a day inward before the date is taken —
 * that lands on the right calendar date for any offset from UTC-12 to UTC+12.
 * Lifted verbatim from the two route files that each had their own copy.
 */
export function formatStayPeriod(from: Date, to: Date): string {
  const halfDay = 12 * 60 * 60 * 1000
  const start = new Date(from.getTime() + halfDay).toISOString().substring(0, 10)
  const end = new Date(to.getTime() - halfDay).toISOString().substring(0, 10)
  return start === end ? start : `${start} – ${end}`
}
