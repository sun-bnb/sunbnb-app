/**
 * The AEAT invoice QR — payload only (track 026 phase 6).
 *
 * PURE. No prisma, no `qrcode` dependency, no clock. The payload and the image
 * are separate concerns and only the payload has legal content, so the encoder
 * lives in the app that renders it while the rules live here.
 *
 * Source: AEAT, *«Detalle de las especificaciones técnicas del código «QR» de la
 * factura y de la «URL» del servicio de cotejo o remisión de información por
 * parte del receptor de la factura»*, **version 0.5.0, 10/12/2025** — the
 * document the Orden HAC/1177/2024 art. 21 defers the format to. Everything
 * below is from that document; the section numbers are its own.
 *
 * ## The property the rest of the design depends on
 *
 * **The payload does NOT contain the CSV**, or anything AEAT returns. It is the
 * issuer's NIF, the invoice number, the issue date and the total (§6) — all of
 * which we know the moment the invoice is written. So a receipt can be
 * rendered, printed and emailed before AEAT has ever seen the record, which is
 * precisely what makes an asynchronous, retrying transmission lawful (P7).
 *
 * Anyone tempted to "fetch the CSV first and then draw the QR" would break the
 * checkout to obtain something the QR does not carry, and would make the
 * transport synchronous for no legal gain. Don't.
 *
 * ## Why there is only the *verifiable* URL here
 *
 * §5 defines two paths: `ValidarQR` for a system that issues verifiable
 * invoices and `ValidarQRNoVerifactu` for one that does not. Being a Veri*factu
 * system is a property of the SOFTWARE, not of an individual invoice — so once
 * Sunbnb submits records, every invoice it prints carries the verifiable URL,
 * including one whose record is still queued or blocked. `ValidarQRNoVerifactu`
 * is therefore not a fallback for a failed submission and is not implemented.
 */

/** §5.1 — the cotejo service, production. */
export const AEAT_QR_URL_PRODUCTION =
  'https://www2.agenciatributaria.gob.es/wlpl/TIKE-CONT/ValidarQR'

/** §5.1 — the cotejo service, *Portal de Pruebas Externas*. */
export const AEAT_QR_URL_PRUEBAS = 'https://prewww2.aeat.es/wlpl/TIKE-CONT/ValidarQR'

export type AeatEnvironment = 'production' | 'pruebas'

/** §6 — `numserie` is capped at 60 characters. */
export const NUMSERIE_MAX_LENGTH = 60
/** §6 — `importe` allows at most 12 digits before the decimal point. */
export const IMPORTE_MAX_INTEGER_DIGITS = 12

/**
 * §3 — the literal that must ALWAYS sit immediately above the QR, so a reader
 * can tell it from any other QR on the document. Not translatable: it is a
 * legal literal, and putting it through next-intl would let a locale file
 * change what the law fixes.
 */
export const QR_LABEL_ABOVE = 'QR tributario:'

/**
 * §3 / art. 20.1.b — the phrase that must sit immediately BELOW the QR on an
 * invoice issued by a verifiable-invoice system. The order permits either this
 * short form or the long one (`QR_LEGEND_BELOW_LONG`); the short one is used
 * because a receipt is 80 mm wide and the order explicitly allows it.
 *
 * Both must be in a font "igual o superior" to the rest of the invoice data —
 * so this is NOT the muted fine-print style the rest of a receipt footer uses.
 */
export const QR_LEGEND_BELOW = 'VERI*FACTU'
export const QR_LEGEND_BELOW_LONG = 'Factura verificable en la sede electrónica de la AEAT'

/**
 * §2 / art. 21.1 — how the image must be drawn, for whoever encodes it.
 * `quietZoneMm` is §3's minimum; the same section recommends 6 mm.
 */
export const QR_IMAGE_SPEC = {
  /** ISO/IEC 18004:2015. */
  standard: 'ISO/IEC 18004:2015',
  /** Error correction level M (medium) — mandated, not a choice. */
  errorCorrectionLevel: 'M',
  minSizeMm: 30,
  maxSizeMm: 40,
  minQuietZoneMm: 2,
  recommendedQuietZoneMm: 6,
} as const

export interface InvoiceQrInput {
  /** NIF of the party obliged to issue the invoice — the ISSUER, never the recipient. */
  issuerNif: string
  /** Series + number, as printed on the invoice. */
  invoiceNumber: string
  /** `DD-MM-YYYY` in the issuer's territory — use `formatFechaExpedicion`. */
  fechaExpedicion: string
  /** Invoice total. Negative for a credit note; the sign is preserved. */
  totalAmount: number
  environment?: AeatEnvironment
}

export type InvoiceQrResult = { ok: true; url: string } | { ok: false; reason: string }

/** §4 — text may only contain printable ASCII, codes 32 to 126. */
function isPrintableAscii(value: string): boolean {
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0
    if (code < 32 || code > 126) return false
  }
  return true
}

/**
 * Build the QR's URL.
 *
 * Refuses rather than emitting a URL that cannot validate: a QR that resolves
 * to "el importe tiene un formato incorrecto" is worse than a receipt whose
 * missing QR is caught by the same alert as a missing record, because it looks
 * compliant to everyone except the guest who scans it.
 *
 * §4's encoding rule is not decorative — its own worked example is an invoice
 * number containing `&`, which unencoded silently truncates the URL into a
 * different, valid-looking request. `encodeURIComponent` is used rather than a
 * hand-rolled escape: it encodes `&`, `=`, `+`, `#` and space, and leaves the
 * `-` in our own `AB-F-2026-00001` alone.
 */
export function buildInvoiceQrUrl(input: InvoiceQrInput): InvoiceQrResult {
  const nif = input.issuerNif.trim()
  if (nif === '') return { ok: false, reason: 'No issuer NIF: the QR identifies the issuer' }
  if (!isPrintableAscii(nif)) {
    return { ok: false, reason: `Issuer NIF ${JSON.stringify(nif)} is not printable ASCII` }
  }

  const numserie = input.invoiceNumber.trim()
  if (numserie === '') return { ok: false, reason: 'No invoice number to put in the QR' }
  if (numserie.length > NUMSERIE_MAX_LENGTH) {
    return {
      ok: false,
      reason: `Invoice number is ${numserie.length} characters; AEAT caps numserie at ${NUMSERIE_MAX_LENGTH}`,
    }
  }
  if (!isPrintableAscii(numserie)) {
    return {
      ok: false,
      reason:
        `Invoice number ${JSON.stringify(numserie)} contains characters outside printable ` +
        'ASCII (32–126), which AEAT does not accept in numserie',
    }
  }

  if (!/^\d{2}-\d{2}-\d{4}$/.test(input.fechaExpedicion)) {
    return {
      ok: false,
      reason: `Issue date ${JSON.stringify(input.fechaExpedicion)} is not DD-MM-YYYY`,
    }
  }

  if (!Number.isFinite(input.totalAmount)) {
    return { ok: false, reason: 'Invoice total is not a finite number' }
  }
  // Two decimals: §6 allows at most two, and this matches both how the amount is
  // stored and `formatImporte` in the huella, so the QR and the record can never
  // disagree about what was charged.
  const importe = input.totalAmount.toFixed(2)
  const integerDigits = importe.replace('-', '').split('.')[0]!.length
  if (integerDigits > IMPORTE_MAX_INTEGER_DIGITS) {
    return {
      ok: false,
      reason: `Invoice total has ${integerDigits} digits before the decimal point; AEAT allows ${IMPORTE_MAX_INTEGER_DIGITS}`,
    }
  }

  const base =
    (input.environment ?? 'production') === 'pruebas'
      ? AEAT_QR_URL_PRUEBAS
      : AEAT_QR_URL_PRODUCTION

  // Parameter ORDER is the one given in §5.1 and §6. Nothing documents that the
  // service is order-sensitive, but every example is in this order and matching
  // them costs nothing.
  const query = [
    `nif=${encodeURIComponent(nif)}`,
    `numserie=${encodeURIComponent(numserie)}`,
    `fecha=${encodeURIComponent(input.fechaExpedicion)}`,
    `importe=${encodeURIComponent(importe)}`,
  ].join('&')

  // NOTE §7.2: the optional `formato=json` parameter must NEVER appear in a QR's
  // URL — it is for a RECEIVER's system cotejing an e-invoice it was sent. A
  // guest scanning a beach receipt must land on the human page.
  return { ok: true, url: `${base}?${query}` }
}
