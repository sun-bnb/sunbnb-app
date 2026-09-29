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

import prisma from '../../index'
import {
  computeAltaHuella,
  altaHuellaInputString,
  formatFechaExpedicion,
  formatFechaHoraHusoGenRegistro,
  formatImporte,
  HUELLA_SPEC_VERSION,
} from './huella'
import { buildDesglose, classifyTipoFactura, type TipoFactura } from './tipo-factura'
import { resolveTaxRegime, regimeRequiresRecords } from '../regime'

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0]

export type RecordOutcome =
  | { status: 'created'; recordId: string; tipoFactura: TipoFactura }
  /** Not a Spanish Veri*factu issuer — nothing is owed. */
  | { status: 'out-of-scope' }
  /** In scope, but the invoice cannot be filed as it stands. Surfaced, not thrown. */
  | { status: 'blocked'; reason: string }

/**
 * Identify the software producing the record, as RD 1007/2023 requires on every
 * one. Deliberately a constant rather than config: it describes THIS build, and
 * a deployment that could change it in a database is a deployment that could
 * file records under someone else's identity.
 */
export interface SistemaInformatico {
  nombreRazon: string
  nif: string
  nombreSistemaInformatico: string
  idSistemaInformatico: string
  version: string
  numeroInstalacion: string
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
      creditsInvoice: { select: { tipoFactura: true } },
    },
  })
  if (!invoice) return { status: 'blocked', reason: 'Invoice disappeared mid-transaction' }

  // ── in scope? ──
  const regime = resolveTaxRegime({
    country: invoice.account?.country ?? null,
    taxRegion: invoice.account?.taxRegion ?? null,
  })
  if (!regimeRequiresRecords(regime)) return { status: 'out-of-scope' }

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
  )
  if (!desglose.ok) return { status: 'blocked', reason: desglose.reason }

  // ── dates in the ISSUER's territory ──
  // Falls back to Madrid rather than UTC: this branch only runs for a Spanish
  // issuer, and UTC would be an hour or two wrong all year, which is exactly
  // the failure this field exists to avoid.
  const timeZone = 'Europe/Madrid'
  const fechaExpedicion = formatFechaExpedicion(invoice.invoicedAt, timeZone)
  const fechaHoraHusoGenRegistro = formatFechaHoraHusoGenRegistro(now, timeZone)

  // ── chain, under the issuer's own lock ──
  // Keyed on the NIF, which is who AEAT considers the filer. `$executeRaw`
  // because pg_advisory_xact_lock returns void, which the adapter cannot
  // deserialize as a column.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('verifactu_chain'), hashtext(${issuerNif}))`

  const chain = await tx.verifactuChain.findUnique({
    where: { issuerNif },
    select: { lastHuella: true, lastChainSeq: true },
  })
  const huellaPrevious = chain?.lastHuella ?? null
  const chainSeq = (chain?.lastChainSeq ?? 0) + 1

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
      huella: computeAltaHuella(huellaInput),
      huellaPrevious,
      huellaInput: altaHuellaInputString(huellaInput),
      chainSeq,
      fechaHoraHusoGenRegistro,
      desglose: desglose.entries,
      sistemaInformatico: { ...sistemaInformatico },
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
