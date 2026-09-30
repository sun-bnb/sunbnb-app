/**
 * Generate the Veri*factu record for an invoice (track 026 phase 5).
 *
 * Called from INSIDE the invoice's own transaction, so an invoice that is in
 * scope and a record describing it either both exist or neither does. A record
 * written afterwards could be lost to a crash between the two commits, and the
 * gap would be invisible: the invoice would look perfectly normal.
 *
 * ## Nothing here may stop an invoice being issued
 *
 * If the invoice cannot be classified, or its VAT rates are not declarable, NO
 * record is written and the invoice stands. That is the same trade as the rest
 * of the track: a sale that cannot be invoiced becomes an un-invoiced sale,
 * which is a real offence with no remedy, whereas a missing record has a
 * defined one — file it late. The gap is surfaced by the "ES invoice with no
 * record" alert rather than by breaking a payment.
 *
 * ## Why a blocked invoice gets no record at all, rather than a `blocked` one
 *
 * The chain must contain filable records in order. A placeholder with no huella
 * would either sit outside the chain (pointless) or inside it (a hole that
 * every later record inherits). Absence is the honest representation, and the
 * ops alert is what makes absence visible.
 */

import prisma from '../../../index'
import {
  computeAltaHuella,
  altaHuellaInputString,
  formatFechaExpedicion,
  formatFechaHoraHusoGenRegistro,
  formatImporte,
  ES_ISSUER_TIME_ZONE,
  HUELLA_SPEC_VERSION,
} from './huella'
import { buildDesglose, classifyTipoFactura, type TipoFactura } from './tipo-factura'
import { buildRegistroAltaXml, type Encadenamiento } from './registro-xml'
import { resolveTaxRegime, regimeRequiresRecords } from '../regime'
import {
  platformIssuerJurisdiction,
  type SistemaInformatico,
} from './sistema-informatico'

export type { SistemaInformatico }

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0]

export type RecordOutcome =
  | { status: 'created'; recordId: string; tipoFactura: TipoFactura }
  /** Not a Spanish Veri*factu issuer — nothing is owed. */
  | { status: 'out-of-scope' }
  /** In scope, but the invoice cannot be filed as it stands. Surfaced, not thrown. */
  | { status: 'blocked'; reason: string }

/**
 * A record's submission state.
 *
 * Constants rather than bare strings because three things now read them — the
 * writer, the submission sweep and the health check — and a typo in any one of
 * them is a silent disagreement about whether a record has been filed.
 *
 * `BLOCKED` is terminal-until-fixed: an invalid issuer NIF, or a partner who has
 * not granted representation. `/api/reconcile` has no such state, which is
 * exactly why a permanently-failing row there retries forever in silence.
 */
export const RECORD_PENDING = 'pending'
export const RECORD_SENT = 'sent'
export const RECORD_ERROR = 'error'
export const RECORD_BLOCKED = 'blocked'

/** States that still owe AEAT a successful submission. */
export const RECORD_UNSENT_STATUSES = [RECORD_PENDING, RECORD_ERROR, RECORD_BLOCKED] as const

/**
 * `DescripcionOperacion` — mandatory, max 500 chars in the XSD.
 *
 * Built from the invoice's own line descriptions, de-duplicated, because that is
 * the most faithful description of what was actually sold and it needs no new
 * data. Falls back to a document-type phrase rather than an empty string: the
 * field cannot be omitted, and an invoice whose lines happen to be unlabelled is
 * not a reason to refuse to file a real sale.
 */
const DESCRIPCION_MAX = 500

export function describeOperacion(
  lines: { description: string | null }[],
  tipoFactura: TipoFactura,
): string {
  const seen = new Set<string>()
  for (const l of lines) {
    const d = (l.description ?? '').trim()
    if (d !== '') seen.add(d)
  }
  const joined = Array.from(seen).join('; ')
  if (joined !== '') {
    return joined.length > DESCRIPCION_MAX
      ? `${joined.slice(0, DESCRIPCION_MAX - 1)}\u2026`
      : joined
  }
  return tipoFactura.startsWith('R') ? 'Rectificación de factura' : 'Prestación de servicios'
}

/** The fields needed to decide whose invoice this is. */
export interface InvoiceIssuerFields {
  issuerType: string
  issuerVatNumber: string | null
  account: { country: string | null; taxRegion: string | null } | null
}

/**
 * Whose invoice is this, for tax purposes?
 *
 * Exported and shared rather than inlined, because the health check has to agree
 * with the writer about what is in scope. If they each derived it, the detector
 * could report an invoice as correctly skipped that the writer thought it should
 * have filed — the same class of bug as deriving the invoice date twice.
 *
 * The trap it encapsulates: on a PLATFORM commission invoice `accountId` is the
 * RECIPIENT partner, not the issuer — the issuer is Sunbnb. Resolving the regime
 * off `account.country` there would file OUR invoice under the customer's
 * jurisdiction, and for the Finnish partner it would file it nowhere at all. The
 * platform's own jurisdiction is keyed on the issuing tax id, because the
 * platform has more than one entity and only one of them is Spanish.
 */
export function resolveInvoiceIssuerJurisdiction(invoice: InvoiceIssuerFields): {
  country: string | null
  taxRegion: string | null
} {
  return invoice.issuerType === 'PLATFORM'
    ? platformIssuerJurisdiction(invoice.issuerVatNumber)
    : {
        country: invoice.account?.country ?? null,
        taxRegion: invoice.account?.taxRegion ?? null,
      }
}

/** Does this invoice owe AEAT a Veri*factu record at all? */
export function invoiceRequiresRecord(invoice: InvoiceIssuerFields): boolean {
  return regimeRequiresRecords(resolveTaxRegime(resolveInvoiceIssuerJurisdiction(invoice)))
}

/**
 * Write the record for an invoice, inside the caller's transaction.
 *
 * Re-reads the invoice rather than taking it as an argument: the caller has
 * just written it, the read is one indexed lookup, and passing a dozen fields
 * through seven call sites is how the two drift apart.
 */
export async function recordInvoiceForTax(
  tx: Tx,
  invoiceId: string,
  sistemaInformatico: SistemaInformatico,
  now: Date = new Date(),
): Promise<RecordOutcome> {
  const invoice = await tx.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      invoiceLines: true,
      account: { select: { country: true, taxRegion: true } },
      creditsInvoice: {
        select: {
          tipoFactura: true,
          // Identity of what this note rectifies — FacturasRectificadas needs the
          // triplet, and the credited invoice is immutable so reading it is safe.
          invoiceNumber: true,
          invoicedAt: true,
          issuerVatNumber: true,
        },
      },
    },
  })
  if (!invoice) return { status: 'blocked', reason: 'Invoice disappeared mid-transaction' }

  // ── in scope? See resolveInvoiceIssuerJurisdiction for the PLATFORM trap. ──
  if (!invoiceRequiresRecord(invoice)) return { status: 'out-of-scope' }

  const issuerNif = (invoice.issuerVatNumber ?? '').trim()
  if (issuerNif === '') {
    return { status: 'blocked', reason: 'Issuer has no tax id; a record cannot identify a filer' }
  }
  if (!invoice.invoiceNumber) {
    return { status: 'blocked', reason: 'Invoice has no number' }
  }

  // ── what kind of document is it? ──
  const classified = classifyTipoFactura({
    totalAmount: invoice.totalAmount,
    hasRecipient: (invoice.recipientVatNumber ?? '').trim() !== '',
    creditsInvoice: invoice.creditsInvoiceId != null,
    creditedTipoFactura: (invoice.creditsInvoice?.tipoFactura as TipoFactura | null) ?? null,
    productCodes: invoice.invoiceLines.map((l) => l.productCode),
  })
  if (!classified.ok) return { status: 'blocked', reason: classified.reason }

  // ── the VAT breakdown ──
  const desglose = buildDesglose(
    invoice.invoiceLines.map((l) => ({ vatRate: l.vatRate, charge: l.charge, tax: l.tax })),
    { reverseCharge: invoice.reverseCharge },
  )
  if (!desglose.ok) return { status: 'blocked', reason: desglose.reason }

  // ── who issued it, and what it was for ──
  //
  // Both are MANDATORY in AEAT's RegistroAlta and neither was stored before the
  // payload was built against the XSD.
  const nombreRazonEmisor = (invoice.issuerCompanyName ?? '').trim()
  if (nombreRazonEmisor === '') {
    return {
      status: 'blocked',
      reason: 'Issuer has no company name; NombreRazonEmisor is mandatory on a record',
    }
  }
  const descripcionOperacion = describeOperacion(invoice.invoiceLines, classified.tipoFactura)

  // ── dates in the ISSUER's territory ──
  // Falls back to Madrid rather than UTC: this branch only runs for a Spanish
  // issuer, and UTC would be an hour or two wrong all year, which is exactly
  // the failure this field exists to avoid.
  const timeZone = ES_ISSUER_TIME_ZONE
  const fechaExpedicion = formatFechaExpedicion(invoice.invoicedAt, timeZone)
  const fechaHoraHusoGenRegistro = formatFechaHoraHusoGenRegistro(now, timeZone)

  // ── chain, under the issuer's own lock ──
  // Keyed on the NIF, which is who AEAT considers the filer. `$executeRaw`
  // because pg_advisory_xact_lock returns void, which the adapter cannot
  // deserialize as a column.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('verifactu_chain'), hashtext(${issuerNif}))`

  const chain = await tx.verifactuChain.findUnique({
    where: { issuerNif },
    // `lastRecordId` is needed for Encadenamiento: RegistroAnterior must name the
    // preceding record, not just carry its hash. Omitting it from this select made
    // every record emit PrimerRegistro and silently restart the chain.
    select: { lastHuella: true, lastChainSeq: true, lastRecordId: true },
  })
  const huellaPrevious = chain?.lastHuella ?? null
  const chainSeq = (chain?.lastChainSeq ?? 0) + 1

  // `Encadenamiento` needs the preceding record's full identity, not just its
  // hash — IDEmisorFactura, NumSerieFactura, FechaExpedicionFactura AND Huella.
  // Read from the record itself rather than duplicated onto every row; records
  // are immutable, so this cannot drift.
  let encadenamiento: Encadenamiento = { first: true }
  if (chain?.lastRecordId) {
    const previous = await tx.verifactuRecord.findUnique({
      where: { id: chain.lastRecordId },
      select: { issuerNif: true, numSerieFactura: true, fechaExpedicion: true, huella: true },
    })
    if (!previous) {
      // The chain head names a record that no longer exists. Filing the next one
      // as PrimerRegistro would quietly restart the chain and hide the loss.
      return {
        status: 'blocked',
        reason: `Chain head for ${issuerNif} points at a record that no longer exists`,
      }
    }
    encadenamiento = { first: false, previous }
  }

  const huellaInput = {
    idEmisorFactura: issuerNif,
    numSerieFactura: invoice.invoiceNumber,
    fechaExpedicionFactura: fechaExpedicion,
    tipoFactura: classified.tipoFactura,
    // The SAME serialized strings the XML will carry. Formatting twice is how
    // the hashed value and the filed value come to disagree.
    cuotaTotal: formatImporte(invoice.totalTax),
    importeTotal: formatImporte(invoice.totalAmount),
    huellaAnterior: huellaPrevious ?? '',
    fechaHoraHusoGenRegistro,
  }

  const huella = computeAltaHuella(huellaInput)

  // The recipient goes on the record only when the invoice actually names one —
  // a factura simplificada has none, and an empty Destinatarios block is
  // schema-invalid rather than merely redundant.
  const recipientNif = (invoice.recipientVatNumber ?? '').trim()
  const recipientName = (invoice.recipientCompanyName ?? '').trim()
  const destinatarios =
    recipientNif !== '' && recipientName !== ''
      ? [{ nombreRazon: recipientName, nif: recipientNif }]
      : undefined

  // What this note rectifies. Only present on an R type, and only when the
  // credited invoice carries the identity triplet the XSD asks for.
  const credited = invoice.creditsInvoice
  const facturasRectificadas =
    classified.tipoFactura.startsWith('R') &&
    credited?.invoiceNumber &&
    credited.issuerVatNumber
      ? [
          {
            issuerNif: credited.issuerVatNumber.trim(),
            numSerieFactura: credited.invoiceNumber,
            fechaExpedicion: formatFechaExpedicion(credited.invoicedAt, timeZone),
          },
        ]
      : undefined

  const payloadXml = buildRegistroAltaXml({
    issuerNif,
    nombreRazonEmisor,
    numSerieFactura: invoice.invoiceNumber,
    fechaExpedicion,
    tipoFactura: classified.tipoFactura,
    tipoRectificativa:
      classified.tipoFactura === 'R1' || classified.tipoFactura === 'R5' ? 'I' : null,
    facturasRectificadas,
    descripcionOperacion,
    destinatarios,
    desglose: desglose.entries,
    // The SAME strings the huella hashed — see huellaInput above.
    cuotaTotal: huellaInput.cuotaTotal,
    importeTotal: huellaInput.importeTotal,
    encadenamiento,
    sistemaInformatico,
    fechaHoraHusoGenRegistro,
    huella,
  })

  const record = await tx.verifactuRecord.create({
    data: {
      invoiceId: invoice.id,
      recordType: 'ALTA',
      issuerNif,
      numSerieFactura: invoice.invoiceNumber,
      fechaExpedicion,
      tipoFactura: classified.tipoFactura,
      // A credit note corrects by DIFFERENCES: our credit notes carry negative
      // totals, which is the `I` model, not the `S` (substitution) one.
      tipoRectificativa:
        classified.tipoFactura === 'R1' || classified.tipoFactura === 'R5' ? 'I' : null,
      huella,
      huellaPrevious,
      huellaInput: altaHuellaInputString(huellaInput),
      chainSeq,
      fechaHoraHusoGenRegistro,
      nombreRazonEmisor,
      descripcionOperacion,
      cuotaTotal: huellaInput.cuotaTotal,
      importeTotal: huellaInput.importeTotal,
      // Spread into plain objects: Prisma's Json input type does not accept a
      // typed array directly, and a cast would hide a real shape change later.
      desglose: desglose.entries.map((e) => ({ ...e })),
      sistemaInformatico: { ...sistemaInformatico },
      payloadXml,
      specVersion: HUELLA_SPEC_VERSION,
    },
  })

  await tx.verifactuChain.upsert({
    where: { issuerNif },
    create: {
      issuerNif,
      lastHuella: record.huella,
      lastChainSeq: chainSeq,
      lastRecordId: record.id,
    },
    update: { lastHuella: record.huella, lastChainSeq: chainSeq, lastRecordId: record.id },
  })

  // The document type is a property of the invoice, so it is stamped there too
  // — a later rectificativa has to know what it is correcting.
  await tx.invoice.update({
    where: { id: invoice.id },
    data: { tipoFactura: classified.tipoFactura },
  })

  return { status: 'created', recordId: record.id, tipoFactura: classified.tipoFactura }
}
