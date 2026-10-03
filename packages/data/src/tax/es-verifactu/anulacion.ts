/**
 * Voiding a record that should never have been issued — *anulación* (track 026 P8).
 *
 * ## What this is NOT
 *
 * **A refund is not an anulación.** If money went back to a guest, the sale still
 * happened and its record still describes something true; the correction is a
 * credit note, filed as an ALTA of a *rectificativa* — which `payment.ts` already
 * does. Annulling a refunded sale would erase the record of a real transaction.
 *
 * Nor is it a correction. If the invoice is right and the RECORD is wrong, that is
 * a *subsanación* (`subsanacion.ts`).
 *
 * An anulación is for an invoice that **should not exist at all**: a duplicate, or
 * one created in error. AEAT's own framing — *"cuando no se exige la emisión de
 * una factura rectificativa"*.
 *
 * ## The four cases
 *
 * Two independent axes, from the operations table in AEAT's validations document
 * (v1.2.2). They are NOT alternatives — all four combinations are legal:
 *
 * | | AEAT holds the record | AEAT does not |
 * |---|---|---|
 * | **First attempt** | no flags | `SinRegistroPrevio=S` |
 * | **Previous annulment rejected** | `RechazoPrevio=S` | both `=S` |
 *
 * ## Why it is manual
 *
 * Same reason as subsanación: deciding that an invoice should never have existed
 * is a judgement, and an automatic annulment is a way to erase real sales. The
 * system surfaces nothing as a candidate — an operator names the invoice.
 */

import prisma from '../../../index'
import {
  buildRegistroAnulacionXml,
  type Encadenamiento,
} from './registro-xml'
import {
  anulacionHuellaInputString,
  computeAnulacionHuella,
  formatFechaExpedicion,
  formatFechaHoraHusoGenRegistro,
  ES_ISSUER_TIME_ZONE,
  HUELLA_SPEC_VERSION,
} from './huella'
import { invoiceRequiresRecord } from './record'
import type { SistemaInformatico } from './sistema-informatico'

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0]

export interface AnulacionPlan {
  /** AEAT does not hold the record being voided. */
  sinRegistroPrevio: 'S' | null
  /** A previous annulment of it was rejected. */
  rechazoPrevio: 'S' | null
}

/**
 * Decide the flags from the existing records for an invoice.
 *
 * PURE. `records` is every record for the invoice, newest first.
 */
export function planAnulacion(
  records: { status: string; recordType: string }[],
): AnulacionPlan {
  // Does AEAT hold ANY record for this invoice? `sent` is the only state that
  // means it was accepted — and that includes AceptadoConErrores, which AEAT
  // keeps.
  const aeatHoldsSomething = records.some(
    (r) => r.recordType !== 'ANULACION' && r.status === 'sent',
  )
  // Was a previous annulment attempt rejected? Only a non-sent ANULACION counts.
  const previousAnulacionRejected = records.some(
    (r) => r.recordType === 'ANULACION' && r.status !== 'sent',
  )

  return {
    sinRegistroPrevio: aeatHoldsSomething ? null : 'S',
    rechazoPrevio: previousAnulacionRejected ? 'S' : null,
  }
}

export type AnulacionOutcome =
  | { status: 'created'; recordId: string; plan: AnulacionPlan }
  | { status: 'not-found' }
  | { status: 'already-annulled' }
  | { status: 'out-of-scope' }
  | { status: 'blocked'; reason: string }

/**
 * Void the record for an invoice, inside the caller's transaction.
 *
 * Takes its own place in the issuer's chain, under the same advisory lock as any
 * other record — an anulación is a record like any other as far as the chain is
 * concerned, which is exactly why `Invoice.hash` could never have served as the
 * Veri*factu chain.
 */
export async function anularInvoice(
  tx: Tx,
  invoiceId: string,
  sistemaInformatico: SistemaInformatico,
  now: Date = new Date(),
): Promise<AnulacionOutcome> {
  const invoice = await tx.invoice.findUnique({
    where: { id: invoiceId },
    select: {
      id: true,
      issuerType: true,
      issuerVatNumber: true,
      invoiceNumber: true,
      invoicedAt: true,
      account: { select: { country: true, taxRegion: true } },
    },
  })
  if (!invoice) return { status: 'not-found' }
  if (!invoiceRequiresRecord(invoice)) return { status: 'out-of-scope' }

  const issuerNif = (invoice.issuerVatNumber ?? '').trim()
  if (issuerNif === '' || !invoice.invoiceNumber) {
    return { status: 'blocked', reason: 'Invoice has no issuer tax id or no number' }
  }

  const existing = await tx.verifactuRecord.findMany({
    where: { invoiceId },
    orderBy: { chainSeq: 'desc' },
    select: { status: true, recordType: true },
  })
  if (existing.length === 0) {
    // Nothing was ever filed, so there is nothing to void. Annulling anyway would
    // assert to AEAT that a record existed.
    return { status: 'not-found' }
  }
  if (existing.some((r) => r.recordType === 'ANULACION' && r.status === 'sent')) {
    return { status: 'already-annulled' }
  }

  const plan = planAnulacion(existing)
  const fechaExpedicion = formatFechaExpedicion(invoice.invoicedAt, ES_ISSUER_TIME_ZONE)
  const fechaHoraHusoGenRegistro = formatFechaHoraHusoGenRegistro(now, ES_ISSUER_TIME_ZONE)

  // Same chain, same lock. Keyed on the NIF, which is who AEAT considers the filer.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('verifactu_chain'), hashtext(${issuerNif}))`

  const chain = await tx.verifactuChain.findUnique({
    where: { issuerNif },
    select: { lastHuella: true, lastChainSeq: true, lastRecordId: true },
  })
  const huellaPrevious = chain?.lastHuella ?? null
  const chainSeq = (chain?.lastChainSeq ?? 0) + 1

  let encadenamiento: Encadenamiento = { first: true }
  if (chain?.lastRecordId) {
    const previous = await tx.verifactuRecord.findUnique({
      where: { id: chain.lastRecordId },
      select: { issuerNif: true, numSerieFactura: true, fechaExpedicion: true, huella: true },
    })
    if (!previous) {
      return {
        status: 'blocked',
        reason: `Chain head for ${issuerNif} points at a record that no longer exists`,
      }
    }
    encadenamiento = { first: false, previous }
  }

  // The anulación huella covers a DIFFERENT field set from an alta's — the
  // annulled invoice's identity, the previous hash and the generation timestamp.
  // No amounts, because an annulment asserts nothing about money.
  const huellaInput = {
    idEmisorFacturaAnulada: issuerNif,
    numSerieFacturaAnulada: invoice.invoiceNumber,
    fechaExpedicionFacturaAnulada: fechaExpedicion,
    huellaAnterior: huellaPrevious ?? '',
    fechaHoraHusoGenRegistro,
  }
  const huella = computeAnulacionHuella(huellaInput)

  const payloadXml = buildRegistroAnulacionXml({
    issuerNif,
    numSerieFactura: invoice.invoiceNumber,
    fechaExpedicion,
    sinRegistroPrevio: plan.sinRegistroPrevio,
    rechazoPrevio: plan.rechazoPrevio,
    encadenamiento,
    sistemaInformatico,
    fechaHoraHusoGenRegistro,
    huella,
  })

  const record = await tx.verifactuRecord.create({
    data: {
      invoiceId: invoice.id,
      recordType: 'ANULACION',
      issuerNif,
      numSerieFactura: invoice.invoiceNumber,
      fechaExpedicion,
      // An annulment has no document type, no breakdown and no totals. The
      // columns are non-null on the model, so they carry the empty statements
      // rather than borrowed values from the alta.
      tipoFactura: '',
      huella,
      huellaPrevious,
      huellaInput: anulacionHuellaInputString(huellaInput),
      chainSeq,
      fechaHoraHusoGenRegistro,
      desglose: [],
      sistemaInformatico: { ...sistemaInformatico },
      payloadXml,
      specVersion: HUELLA_SPEC_VERSION,
    },
  })

  await tx.verifactuChain.upsert({
    where: { issuerNif },
    create: {
      issuerNif,
      lastHuella: huella,
      lastChainSeq: chainSeq,
      lastRecordId: record.id,
    },
    update: { lastHuella: huella, lastChainSeq: chainSeq, lastRecordId: record.id },
  })

  return { status: 'created', recordId: record.id, plan }
}

/** Convenience wrapper that opens its own transaction. */
export async function anularInvoiceStandalone(
  invoiceId: string,
  sistemaInformatico: SistemaInformatico,
  now: Date = new Date(),
): Promise<AnulacionOutcome> {
  return prisma.$transaction((tx) => anularInvoice(tx, invoiceId, sistemaInformatico, now))
}
