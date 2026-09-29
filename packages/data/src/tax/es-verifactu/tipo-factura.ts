/**
 * `TipoFactura` — what KIND of document a record describes, and the VAT
 * breakdown that goes with it (track 026 phase 5).
 *
 * PURE. Classification is derived from the invoice we already hold; nothing
 * here reads a database or a clock.
 */

/** The codes we can produce. AEAT defines more (F3, R2–R4) that we never emit. */
export type TipoFactura = 'F1' | 'F2' | 'R1' | 'R5'

/**
 * Ceilings for a *factura simplificada*, from **RD 1619/2012 art. 4**.
 *
 * The general limit is €400 including VAT. A listed set of operations gets
 * €3,000 — and the list is by ACTIVITY, not by invoice, which is the part that
 * matters here: a beach club selling both drinks and sunbed hire is under two
 * different ceilings at the same counter.
 *
 * Art. 4.2's list, verbatim: ventas al por menor · ventas o servicios en
 * ambulancia · ventas o servicios a domicilio del consumidor · transportes de
 * personas y sus equipajes · **servicios de hostelería y restauración** ·
 * salas de baile y discotecas · servicios telefónicos en cabinas · peluquería e
 * institutos de belleza · **utilización de instalaciones deportivas** · revelado
 * de fotografías · aparcamiento de vehículos · alquiler de películas ·
 * tintorería y lavandería · autopistas de peaje.
 */
export const SIMPLIFIED_CEILING_GENERAL = 400
export const SIMPLIFIED_CEILING_LISTED = 3000

/**
 * Which ceiling each of our product codes sits under.
 *
 * `food-and-beverage` and `no-show-deposit` are *hostelería y restauración*
 * (art. 4.2.e) — the clearest entry on the list for a chiringuito, and a
 * table deposit is ancillary to that same service.
 *
 * `sunbed-rental` and `equipment-rental` are held at the GENERAL ceiling, which
 * is a deliberate conservative reading rather than a settled one. Hiring a
 * lounger is not a *venta al por menor* (nothing is sold) and a sunbed is not an
 * *instalación deportiva*; equipment hire has a better claim to 4.2.i but it is
 * an argument, not a fact. Being wrong in this direction costs nothing today —
 * the largest invoice ever issued on the platform is €216 — while being wrong
 * the other way would file a real sale as the wrong document type. Narrowing
 * this is D5 in the track, and it is now a single question for the asesor
 * rather than an open-ended one.
 */
const CEILING_BY_PRODUCT_CODE: Record<string, number> = {
  'food-and-beverage': SIMPLIFIED_CEILING_LISTED,
  'no-show-deposit': SIMPLIFIED_CEILING_LISTED,
  'sunbed-rental': SIMPLIFIED_CEILING_GENERAL,
  'equipment-rental': SIMPLIFIED_CEILING_GENERAL,
}

/**
 * The ceiling governing an invoice, given what it sells.
 *
 * Takes the LOWEST applicable ceiling across the lines. A receipt mixing
 * loungers and drinks is not covered by the higher limit merely because part of
 * it would be — the conservative reading is the only safe one, and the
 * alternative is deciding that a mixed sale is whichever half is convenient.
 *
 * An unknown product code also lands on the general ceiling: a code nobody has
 * classified is not evidence of belonging to the list.
 */
export function simplifiedCeilingFor(productCodes: (string | null)[]): number {
  const ceilings = productCodes.map(
    (code) => (code && CEILING_BY_PRODUCT_CODE[code]) || SIMPLIFIED_CEILING_GENERAL,
  )
  return ceilings.length === 0
    ? SIMPLIFIED_CEILING_GENERAL
    : Math.min(...ceilings)
}

export interface ClassifyInput {
  /** Gross total. Negative for a credit note. */
  totalAmount: number
  /** True when the recipient's tax id is on the invoice (a B2B document). */
  hasRecipient: boolean
  /** Set when this document credits another one. */
  creditsInvoice: boolean
  /**
   * The invoice's line product codes, which decide the simplified ceiling.
   * Omitted means the general ceiling — the safe default.
   */
  productCodes?: (string | null)[]
  /** The kind of the invoice being credited, when this is a credit note. */
  creditedTipoFactura?: TipoFactura | null
}

export type ClassifyResult =
  | { ok: true; tipoFactura: TipoFactura }
  | { ok: false; reason: string }

/**
 * Classify one invoice.
 *
 * The mapping our documents actually produce:
 *   - PLATFORM commission invoice → **F1**. It carries the partner's tax id as
 *     recipient; it is an ordinary B2B invoice.
 *   - PARTNER consumer receipt → **F2**, a *factura simplificada*. No recipient
 *     is collected at a beach bar, and the amounts are far below the ceiling.
 *   - Credit note against a simplified invoice → **R5**.
 *   - Credit note against a full invoice → **R1**.
 *
 * Refuses rather than guesses in the two cases where a wrong answer is a
 * mis-filed tax document: a consumer sale above the simplified ceiling (which
 * would need recipient details we never collected), and a credit note whose
 * original we cannot identify.
 */
export function classifyTipoFactura(input: ClassifyInput): ClassifyResult {
  if (input.creditsInvoice) {
    const credited = input.creditedTipoFactura
    if (!credited) {
      return {
        ok: false,
        reason:
          'Cannot classify a credit note without knowing the type of the invoice it credits.',
      }
    }
    // A rectificativa follows what it corrects: R5 is the code for correcting a
    // simplified invoice, R1 for an ordinary one.
    return { ok: true, tipoFactura: credited === 'F2' ? 'R5' : 'R1' }
  }

  if (input.hasRecipient) return { ok: true, tipoFactura: 'F1' }

  const ceiling = simplifiedCeilingFor(input.productCodes ?? [])
  if (Math.abs(input.totalAmount) > ceiling) {
    return {
      ok: false,
      reason:
        `A sale of ${input.totalAmount.toFixed(2)} exceeds the simplified-invoice ceiling ` +
        `of ${ceiling} that applies to what it sells (RD 1619/2012 art. 4), and it has no ` +
        'recipient, so it can be neither F2 nor F1. Collect the customer’s tax details.',
    }
  }

  return { ok: true, tipoFactura: 'F2' }
}

// ─── Desglose ────────────────────────────────────────────────────────────────

/**
 * Spanish VAT rates a record may carry.
 *
 * A closed set on purpose. `Desglose` wants a legal `TipoImpositivo`, and our
 * own data proves the need: credit notes carry stored rates of 20.98, 21.01 and
 * 21.03 because `issueCashCreditNote` recomputes an effective rate as
 * `totalTax / totalCharge * 100` and the float rounding drifts. AEAT rejects
 * 20.98 outright.
 */
export const LEGAL_ES_VAT_RATES = [0, 4, 10, 21] as const

/** Is this a rate a Spanish record may declare? */
export function isLegalEsVatRate(rate: number): boolean {
  return (LEGAL_ES_VAT_RATES as readonly number[]).includes(rate)
}

export interface DesgloseLine {
  vatRate: number | null
  /** Net base. */
  charge: number
  /** VAT amount. */
  tax: number
}

export interface DesgloseEntry {
  tipoImpositivo: number
  baseImponible: number
  cuotaRepercutida: number
}

export type DesgloseResult =
  | { ok: true; entries: DesgloseEntry[] }
  | { ok: false; reason: string }

/** Round to cents, so summed floats don't leak 0.30000000000000004 onto the wire. */
function cents(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * Group lines into one entry per VAT rate.
 *
 * REFUSES a null rate rather than treating it as 0. `fiscal.ts` buckets null
 * under rate 0 for a monthly report, which is a reasonable thing to do in a
 * summary and an unacceptable one here: it would declare a zero-rated supply
 * that never happened. Four invoice lines in production carry a null rate.
 */
export function buildDesglose(lines: DesgloseLine[]): DesgloseResult {
  if (lines.length === 0) {
    return { ok: false, reason: 'An invoice with no lines has no VAT breakdown to declare.' }
  }

  const byRate = new Map<number, { base: number; cuota: number }>()

  for (const line of lines) {
    if (line.vatRate == null) {
      return {
        ok: false,
        reason:
          'An invoice line has no VAT rate. A record must declare a real rate; ' +
          'treating it as 0% would declare a zero-rated supply that did not happen.',
      }
    }
    if (!isLegalEsVatRate(line.vatRate)) {
      return {
        ok: false,
        reason:
          `VAT rate ${line.vatRate}% is not a legal Spanish rate ` +
          `(${LEGAL_ES_VAT_RATES.join('%, ')}%). A drifted rate like 20.98% comes from ` +
          'recomputing an effective rate instead of carrying the original.',
      }
    }
    const bucket = byRate.get(line.vatRate) ?? { base: 0, cuota: 0 }
    bucket.base += line.charge
    bucket.cuota += line.tax
    byRate.set(line.vatRate, bucket)
  }

  const entries = Array.from(byRate.entries())
    .sort(([a], [b]) => a - b)
    .map(([tipoImpositivo, sums]) => ({
      tipoImpositivo,
      baseImponible: cents(sums.base),
      cuotaRepercutida: cents(sums.cuota),
    }))

  return { ok: true, entries }
}
