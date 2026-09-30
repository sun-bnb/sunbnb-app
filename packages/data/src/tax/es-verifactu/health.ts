/**
 * Is the Veri*factu register actually complete? (track 026 phase 7.0)
 *
 * READ-ONLY. No auth — the caller owns that. Platform-wide by design, unlike
 * `fiscal.ts`, which is a per-site register handed to one partner's accountant.
 * The questions here are operational and cross every issuer: is anything unfiled,
 * is the queue draining, has a chain lost a link.
 *
 * ## Why this exists, and why it is not optional
 *
 * Phase 5 made a deliberate choice: an invoice that cannot be filed gets **no
 * record at all**, because a placeholder would either sit outside the chain
 * (pointless) or inside it (a hole every later record inherits). `record.ts`
 * defends that with "the gap is surfaced by the missing-record alert rather than
 * by breaking a payment" — and until this module existed, that alert did not.
 * Absence was the representation and nothing observed it, so a blocked Spanish
 * invoice was visible only as a `console.error` in a serverless log.
 *
 * It is also the precondition for switching transmission on. AEAT tolerates a
 * queue — records may sit *"encolados, pendientes de remisión, con reintentos
 * periódicos, como si se tratara de una incidencia"* — but not abandonment:
 * *"no pueden quedar RF generados sin remitir a la AEAT"*. Queueing is fine,
 * giving up is not, which is only a meaningful distinction if somebody is
 * counting.
 *
 * ## Deliberately all-time by default
 *
 * Same reasoning as `unInvoicedRefunds` in `fiscal.ts`: an unfiled invoice from
 * last month is still unfiled. A window is accepted for reporting, but the alert
 * should ask about everything. Cost is not a concern at this scale — the whole
 * production invoice table is in the low hundreds of rows — and if it ever is,
 * `Invoice` now carries `@@index([issuerType, invoicedAt])`.
 */

import prisma from '../../../index'
import {
  invoiceRequiresRecord,
  RECORD_PENDING,
  RECORD_SENT,
  RECORD_BLOCKED,
  RECORD_ERROR,
} from './record'

/** An invoice that owes AEAT a record and has none. */
export interface UnfiledInvoice {
  invoiceId: string
  invoiceNumber: string | null
  invoicedAt: Date
  /** `PARTNER` (a venue's sale) or `PLATFORM` (our own commission invoice). */
  issuerType: string
  issuerNif: string | null
}

export interface ChainHealth {
  issuerNif: string
  /** Highest position the chain has handed out. */
  lastChainSeq: number
  /** How many records actually exist for that issuer. */
  recordCount: number
  /**
   * True when the two agree. `chainSeq` is allocated as `last + 1` from 1, so a
   * shortfall means a record that was counted into the chain is GONE — the one
   * thing the hash chain exists to make undeniable.
   */
  contiguous: boolean
}

/**
 * An issuer that looks Spanish but is not classified, so its invoices are
 * silently out of scope.
 *
 * `resolveTaxRegime` returns `NONE` when `country = 'ES'` and `taxRegion` is
 * unset, because guessing between common territory and a foral one would file to
 * the wrong tax authority. That is the right call, but it means an unconfigured
 * Spanish partner produces NOTHING — no record, and no gap either, because the
 * invoice never owed one.
 *
 * Without this, the report says "register complete" when the truth is "no issuer
 * is configured as Spanish at all". That is the same shape of defect as the
 * refunds figure in `fiscal.ts`, which was structurally always EUR 0.00 while
 * EUR 576 had been credited: a number that cannot be wrong because nothing ever
 * reaches it.
 */
export interface UnresolvedEsIssuer {
  issuerNif: string | null
  invoiceCount: number
}

export interface VerifactuHealth {
  /**
   * Invoices in scope with no record at all. **Should be empty.** Anything here
   * is a Spanish invoice we are obliged to have filed and cannot, split by
   * issuer so "our own commission invoices" and "a partner's sales" are
   * separately visible — they have different causes and different fixes.
   */
  unfiled: UnfiledInvoice[]
  /** Unfiled counts by `issuerType`, for an at-a-glance figure. */
  unfiledByIssuerType: Record<string, number>
  /** Records by submission state. Absent states are omitted, not zero-filled. */
  recordsByStatus: Record<string, number>
  /**
   * The oldest record still awaiting a successful submission, or null. Feeds the
   * "record pending > 1 h" alert; a value that keeps getting older means the
   * sweep is stuck rather than busy.
   */
  oldestUnsentAt: Date | null
  /** Per-issuer chain integrity. */
  chains: ChainHealth[]
  /**
   * Spanish issuers with no `taxRegion`, whose invoices are therefore out of
   * scope rather than filed. Stops the report from reading "complete" when the
   * real state is "nothing is configured". See `UnresolvedEsIssuer`.
   */
  unresolvedEsIssuers: UnresolvedEsIssuer[]
  /**
   * True when nothing needs attention: no unfiled, no blocked or errored record,
   * every chain intact, and no Spanish issuer left unclassified.
   */
  healthy: boolean
}

export interface VerifactuHealthOptions {
  /** Inclusive lower bound on `invoicedAt`. Omit for all time. */
  from?: Date
  /** Exclusive upper bound on `invoicedAt`. Omit for all time. */
  to?: Date
}

export async function getVerifactuHealth(
  options: VerifactuHealthOptions = {},
): Promise<VerifactuHealth> {
  const invoicedAt =
    options.from || options.to
      ? {
          ...(options.from ? { gte: options.from } : {}),
          ...(options.to ? { lt: options.to } : {}),
        }
      : undefined

  // ── 1. Invoices with no record, filtered to those that OWE one ──
  //
  // The scope test cannot be expressed in SQL (it depends on the regime
  // resolver), so the query narrows to invoices with no record — a small set —
  // and the shared `invoiceRequiresRecord` decides. Sharing that function with
  // the writer is the point: if this module re-derived scope, it could call an
  // invoice correctly-skipped that the writer meant to file.
  const candidates = await prisma.invoice.findMany({
    where: {
      ...(invoicedAt ? { invoicedAt } : {}),
      verifactuRecords: { none: {} },
    },
    select: {
      id: true,
      invoiceNumber: true,
      invoicedAt: true,
      issuerType: true,
      issuerVatNumber: true,
      account: { select: { country: true, taxRegion: true } },
    },
    orderBy: { invoicedAt: 'asc' },
  })

  const unfiled: UnfiledInvoice[] = candidates
    .filter((inv) => invoiceRequiresRecord(inv))
    .map((inv) => ({
      invoiceId: inv.id,
      invoiceNumber: inv.invoiceNumber,
      invoicedAt: inv.invoicedAt,
      issuerType: inv.issuerType,
      issuerNif: inv.issuerVatNumber,
    }))

  const unfiledByIssuerType: Record<string, number> = {}
  for (const inv of unfiled) {
    unfiledByIssuerType[inv.issuerType] = (unfiledByIssuerType[inv.issuerType] ?? 0) + 1
  }

  // ── 1b. Spanish issuers nobody classified ──
  //
  // These have no record AND no gap, so every other figure here reads clean.
  // Counted off the same candidate set: an unclassified issuer never produces a
  // record, so all of its invoices are already in `candidates`.
  const unresolvedCounts = new Map<string | null, number>()
  for (const inv of candidates) {
    if (inv.issuerType !== 'PARTNER') continue
    const country = (inv.account?.country ?? '').trim().toUpperCase()
    const region = (inv.account?.taxRegion ?? '').trim()
    if (country === 'ES' && region === '') {
      unresolvedCounts.set(
        inv.issuerVatNumber,
        (unresolvedCounts.get(inv.issuerVatNumber) ?? 0) + 1,
      )
    }
  }
  const unresolvedEsIssuers: UnresolvedEsIssuer[] = Array.from(unresolvedCounts.entries())
    .map(([issuerNif, invoiceCount]) => ({ issuerNif, invoiceCount }))
    .sort((a, b) => (a.issuerNif ?? '').localeCompare(b.issuerNif ?? ''))

  // ── 2. Submission states ──
  const statusGroups = await prisma.verifactuRecord.groupBy({
    by: ['status'],
    _count: { _all: true },
  })
  const recordsByStatus: Record<string, number> = {}
  for (const g of statusGroups) recordsByStatus[g.status] = g._count._all

  const oldestUnsent = await prisma.verifactuRecord.findFirst({
    where: { status: { not: RECORD_SENT } },
    select: { createdAt: true },
    orderBy: { createdAt: 'asc' },
  })

  // ── 3. Chain integrity ──
  //
  // `chainSeq` runs 1..N per issuer, so the count of records must equal the
  // chain head. A shortfall means a record inside the chain no longer exists,
  // which no amount of re-sending repairs.
  const chainRows = await prisma.verifactuChain.findMany({
    select: { issuerNif: true, lastChainSeq: true },
    orderBy: { issuerNif: 'asc' },
  })
  const recordCounts = await prisma.verifactuRecord.groupBy({
    by: ['issuerNif'],
    _count: { _all: true },
  })
  const countByNif = new Map(recordCounts.map((r) => [r.issuerNif, r._count._all]))

  const chains: ChainHealth[] = chainRows.map((c) => {
    const recordCount = countByNif.get(c.issuerNif) ?? 0
    return {
      issuerNif: c.issuerNif,
      lastChainSeq: c.lastChainSeq,
      recordCount,
      contiguous: recordCount === c.lastChainSeq,
    }
  })

  const healthy =
    unfiled.length === 0 &&
    (recordsByStatus[RECORD_BLOCKED] ?? 0) === 0 &&
    (recordsByStatus[RECORD_ERROR] ?? 0) === 0 &&
    chains.every((c) => c.contiguous) &&
    unresolvedEsIssuers.length === 0

  return {
    unfiled,
    unfiledByIssuerType,
    recordsByStatus,
    oldestUnsentAt: oldestUnsent?.createdAt ?? null,
    chains,
    unresolvedEsIssuers,
    healthy,
  }
}

/**
 * One-line summary for a log or an ops banner.
 *
 * Reads as reassuring only when it is: a queue that is merely pending is
 * reported, because AEAT tolerates a queue and not an abandoned one, and the
 * difference is only visible over time.
 */
export function describeVerifactuHealth(health: VerifactuHealth): string {
  if (health.healthy) {
    const pending = health.recordsByStatus[RECORD_PENDING] ?? 0
    return pending === 0
      ? 'Veri*factu register complete; nothing awaiting submission.'
      : `Veri*factu register complete; ${pending} record(s) awaiting submission.`
  }

  const problems: string[] = []
  if (health.unfiled.length > 0) {
    const parts = Object.entries(health.unfiledByIssuerType)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([type, n]) => `${n} ${type}`)
    problems.push(`${health.unfiled.length} invoice(s) with NO record (${parts.join(', ')})`)
  }
  const blocked = health.recordsByStatus[RECORD_BLOCKED] ?? 0
  if (blocked > 0) problems.push(`${blocked} record(s) blocked`)
  const errored = health.recordsByStatus[RECORD_ERROR] ?? 0
  if (errored > 0) problems.push(`${errored} record(s) in error`)
  const broken = health.chains.filter((c) => !c.contiguous)
  if (broken.length > 0) {
    problems.push(
      `chain gap for ${broken.map((c) => `${c.issuerNif} (${c.recordCount}/${c.lastChainSeq})`).join(', ')}`,
    )
  }
  if (health.unresolvedEsIssuers.length > 0) {
    const invoices = health.unresolvedEsIssuers.reduce((n, i) => n + i.invoiceCount, 0)
    problems.push(
      `${health.unresolvedEsIssuers.length} Spanish issuer(s) with no taxRegion, ` +
        `so ${invoices} invoice(s) are out of scope instead of filed`,
    )
  }
  return `Veri*factu register NEEDS ATTENTION: ${problems.join('; ')}.`
}
