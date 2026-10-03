/**
 * Correcting a record AEAT already has — *alta de subsanación* (track 026 P8).
 *
 * ## The gap this closes
 *
 * `EstadoRegistro` has three values, and the middle one is the awkward one.
 * **`AceptadoConErrores` means AEAT KEPT the record but flagged defects in it.**
 * Before this module, the sweep marked such a record `sent`, stored the message,
 * and that was the end of it — AEAT holding a document we knew was wrong, with
 * nothing in the system able to act on it.
 *
 * That matters more than the name suggests. Per §7 of the huella spec, a record
 * whose hash does not match arrives exactly this way rather than as a rejection.
 * So the one signal that would ever reveal a broken chain was landing in a
 * database column and dying there.
 *
 * ## What a subsanación is, and is not
 *
 * It re-sends a record **under the same invoice identity** with corrected
 * content. It is NOT a credit note: the validations document is explicit that
 * subsanación applies only *"cuando no se trate de una causa que exija la emisión
 * de una factura rectificativa"*. In plain terms — the invoice is right, the
 * RECORD describing it is wrong. If the invoice itself is wrong, that is a credit
 * note and a different mechanism.
 *
 * ## Which of the three cases applies
 *
 * From the operations table in AEAT's validations document (v1.2.2). The schema's
 * own field documentation is a copy-paste error, so this table is the source:
 *
 * | Situation at AEAT | Subsanacion | RechazoPrevio |
 * |---|---|---|
 * | Record exists (was accepted, with or without errors) | `S` | absent |
 * | Record does NOT exist — earlier submission rejected or never sent | `S` | `X` |
 * | Record exists and a PREVIOUS subsanación of it was rejected | `S` | `S` |
 *
 * This module derives the case from the record's own stored state rather than
 * asking the caller, because the caller would have to re-derive it from the same
 * fields and could get it wrong.
 *
 * ## Why this is not automatic
 *
 * Nothing here fires on its own. A subsanación re-sends *corrected* data — and
 * what to correct is a judgement about why AEAT objected. Re-sending identical
 * content automatically would reproduce the same error forever, which is the
 * `/api/reconcile` failure mode this track keeps trying not to repeat. So an
 * operator decides, and this does the filing.
 */

import prisma from '../../../index'
import { recordInvoiceForTax, type RecordOutcome } from './record'
import type { SistemaInformatico } from './sistema-informatico'

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0]

/** Which correction case a record is in, by what AEAT did with it. */
export type SubsanacionCase =
  /** AEAT holds it. Ordinary correction. */
  | 'held-by-aeat'
  /** AEAT does not hold it — rejected, or never successfully sent. */
  | 'not-at-aeat'
  /** AEAT holds the original, and a previous correction of it was rejected. */
  | 'previous-subsanacion-rejected'

export interface SubsanacionPlan {
  case: SubsanacionCase
  subsanacion: 'S'
  rechazoPrevio: 'S' | 'X' | null
}

/**
 * Decide the case from a record's stored state.
 *
 * PURE, so the mapping can be tested without a database. The inputs are exactly
 * what the sweep writes back.
 */
export function planSubsanacion(record: {
  status: string
  recordType: string
  csv: string | null
}): SubsanacionPlan {
  // A rejected correction is itself corrected with RechazoPrevio=S — distinct
  // from a rejected ORIGINAL, which is `X`. Checked first because such a record
  // is both a SUBSANACION and not-at-AEAT, and only this branch is right.
  if (record.recordType === 'SUBSANACION' && record.status !== 'sent') {
    return { case: 'previous-subsanacion-rejected', subsanacion: 'S', rechazoPrevio: 'S' }
  }
  // `sent` is the only state in which AEAT took it — and that includes
  // `AceptadoConErrores`, which the sweep deliberately records as sent.
  if (record.status === 'sent') {
    return { case: 'held-by-aeat', subsanacion: 'S', rechazoPrevio: null }
  }
  return { case: 'not-at-aeat', subsanacion: 'S', rechazoPrevio: 'X' }
}

export type SubsanacionOutcome =
  | { status: 'created'; recordId: string; case: SubsanacionCase }
  | { status: 'not-found' }
  /** Already corrected once. See the note on the one-per-invoice limit below. */
  | { status: 'already-corrected' }
  | { status: 'blocked'; reason: string }

/**
 * File a correction for the most recent record of an invoice.
 *
 * Runs in the caller's transaction so the new record joins the chain under the
 * same lock as any other.
 *
 * **Known limit — one subsanación per invoice.** `VerifactuRecord` carries
 * `@@unique([invoiceId, recordType])`, which is the idempotency guard stopping a
 * second ALTA for one invoice. It also caps SUBSANACION rows at one. A second
 * correction of the same invoice therefore needs a schema change: replace that
 * constraint with a partial unique index restricted to `('ALTA','ANULACION')`,
 * which Prisma cannot express in the schema and so has to be raw SQL. Deliberately
 * not done now — going from no remedy to one is the useful step, and the
 * `previous-subsanacion-rejected` case is reachable through AEAT rejecting the
 * first correction, which is rare and visible.
 */
export async function subsanarInvoice(
  tx: Tx,
  invoiceId: string,
  sistemaInformatico: SistemaInformatico,
  now: Date = new Date(),
): Promise<SubsanacionOutcome> {
  const records = await tx.verifactuRecord.findMany({
    where: { invoiceId },
    orderBy: { chainSeq: 'desc' },
    select: { id: true, status: true, recordType: true, csv: true },
  })
  if (records.length === 0) return { status: 'not-found' }
  if (records.some((r) => r.recordType === 'SUBSANACION')) {
    return { status: 'already-corrected' }
  }

  const plan = planSubsanacion(records[0]!)

  const outcome: RecordOutcome = await recordInvoiceForTax(
    tx,
    invoiceId,
    sistemaInformatico,
    now,
    {
      recordType: 'SUBSANACION',
      subsanacion: plan.subsanacion,
      rechazoPrevio: plan.rechazoPrevio,
    },
  )

  if (outcome.status === 'created') {
    return { status: 'created', recordId: outcome.recordId, case: plan.case }
  }
  if (outcome.status === 'out-of-scope') {
    // Shouldn't happen — a record exists, so it was in scope when filed. If the
    // issuer's regime changed underneath us, say so rather than silently nothing.
    return {
      status: 'blocked',
      reason: 'Invoice is no longer in scope, yet a record exists for it',
    }
  }
  return { status: 'blocked', reason: outcome.reason }
}

/** Convenience wrapper that opens its own transaction. */
export async function subsanarInvoiceStandalone(
  invoiceId: string,
  sistemaInformatico: SistemaInformatico,
  now: Date = new Date(),
): Promise<SubsanacionOutcome> {
  return prisma.$transaction((tx) => subsanarInvoice(tx, invoiceId, sistemaInformatico, now))
}

/**
 * Records that look like they need correcting.
 *
 * Read-only, and deliberately a QUERY rather than an action: it surfaces
 * candidates for a human to judge. `AceptadoConErrores` rows are the headline —
 * they read as `sent` everywhere else, so nothing else would show them.
 */
export async function findRecordsNeedingSubsanacion(): Promise<
  { invoiceId: string; invoiceNumber: string; issuerNif: string; status: string; lastError: string }[]
> {
  const rows = await prisma.verifactuRecord.findMany({
    where: {
      recordType: { not: 'SUBSANACION' },
      lastError: { not: null },
      OR: [{ status: 'sent' }, { status: 'blocked' }],
    },
    select: {
      invoiceId: true,
      numSerieFactura: true,
      issuerNif: true,
      status: true,
      lastError: true,
    },
    orderBy: { chainSeq: 'asc' },
  })
  return rows.map((r) => ({
    invoiceId: r.invoiceId,
    invoiceNumber: r.numSerieFactura,
    issuerNif: r.issuerNif,
    status: r.status,
    lastError: r.lastError ?? '',
  }))
}
