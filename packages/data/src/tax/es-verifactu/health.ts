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
import { grantState, type GrantState } from './grants'

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

/**
 * PLATFORM invoices carrying no issuer tax id at all.
 *
 * Informational, and deliberately NOT folded into `healthy`. These are the
 * `getBusinessEntity()` DEFAULTS placeholder leaking onto a real invoice — the
 * `PLATFORM-2026-00001` / "Platform Operator" / NULL-NIF defect phase 3
 * documented and fixed at the cause (an unconfigured platform now SKIPS the
 * commission invoice rather than issuing a nameless one). They are out of scope
 * rather than unfiled, because an invoice with no issuer id resolves to no
 * jurisdiction, so no other figure here would mention them.
 *
 * The reason to report it: this count must never GROW. It is historical debris
 * that the cutover deletion clears, but an increase means phase 3's guard
 * regressed and we are minting nameless invoices again.
 */
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
   * Count of PLATFORM invoices with no issuer tax id — phase 3's placeholder
   * leak. Informational only; see the note above `VerifactuHealth`. Must never
   * grow.
   */
  platformInvoicesWithoutIssuerId: number
  /**
   * Records AEAT has refused to accept from us for want of an authorisation
   * (`4112`), parked and waiting rather than failed (track 026 P7.2).
   *
   * Worth its own figure because such a record is `pending`, which is otherwise
   * indistinguishable from "the cron has not got to it yet". The two call for
   * opposite responses: one is nothing, the other is that the Convenio is not
   * approved for an issuer whose partner HAS signed, and only we can chase that.
   *
   * Identified structurally rather than by matching the error text:
   * `deferForAuthorisation` is the only writer that leaves a record `pending`
   * with `lastAttemptAt` set, because every other failure path moves it to
   * `error` or `blocked`.
   */
  parkedAwaitingAuthorisation: number
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

  // ── 1c. Our own invoices with no issuer identity at all ──
  //
  // Counted over ALL platform invoices, not just record-less ones: the point is
  // to notice the defect reappearing, and such an invoice never gets a record
  // anyway.
  const platformInvoicesWithoutIssuerId = await prisma.invoice.count({
    where: {
      ...(invoicedAt ? { invoicedAt } : {}),
      issuerType: 'PLATFORM',
      OR: [{ issuerVatNumber: null }, { issuerVatNumber: '' }],
    },
  })

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

  // Pending AND already attempted — see `parkedAwaitingAuthorisation`.
  const parkedAwaitingAuthorisation = await prisma.verifactuRecord.count({
    where: { status: RECORD_PENDING, lastAttemptAt: { not: null } },
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

  // Parked records count AGAINST health, deliberately, even though the state is
  // expected while an AEAT approval is pending. The alternative is a banner
  // reading "register complete" over partner records that nothing will send —
  // the same shape of structurally-clean report as the refunds figure this track
  // already fixed and the "register complete over zero records" one P7.0 found.
  // The description names the reason so it cannot be mistaken for a fault.
  const healthy =
    unfiled.length === 0 &&
    (recordsByStatus[RECORD_BLOCKED] ?? 0) === 0 &&
    (recordsByStatus[RECORD_ERROR] ?? 0) === 0 &&
    chains.every((c) => c.contiguous) &&
    unresolvedEsIssuers.length === 0 &&
    parkedAwaitingAuthorisation === 0

  return {
    unfiled,
    unfiledByIssuerType,
    recordsByStatus,
    oldestUnsentAt: oldestUnsent?.createdAt ?? null,
    chains,
    unresolvedEsIssuers,
    platformInvoicesWithoutIssuerId,
    parkedAwaitingAuthorisation,
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
  if (health.parkedAwaitingAuthorisation > 0) {
    problems.push(
      `${health.parkedAwaitingAuthorisation} record(s) parked because AEAT refused us as ` +
        'colaborador social (4112) — the partner has granted, the Convenio has not been ' +
        'approved for them yet; they are retried, not lost',
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


// ─── who has authorised us, and who has not (P7a) ────────────────────────────

export interface PartnerGrantStatus {
  userId: string
  company: string
  businessId: string | null
  state: GrantState
  invoicingGrantedAt: Date | null
  submissionGrantedAt: Date | null
  /** Records of theirs currently waiting on the submission grant. */
  queuedRecords: number
}

/**
 * Spanish partners and whether they have authorised us.
 *
 * Only Spanish ones: Veri*factu does not apply elsewhere, and listing a Finnish
 * partner as "not authorised" would invent an obligation.
 *
 * The queued count is the part that makes this actionable — it says what the
 * missing grant is actually costing, rather than just that it is missing.
 */
export async function getPartnerGrantStatuses(): Promise<PartnerGrantStatus[]> {
  const partners = await prisma.partnerAccount.findMany({
    where: { country: 'ES', isTestAccount: false },
    select: {
      userId: true,
      company: true,
      businessId: true,
      invoicingAuthorityGrantedAt: true,
      aeatSubmissionGrantedAt: true,
    },
    orderBy: { company: 'asc' },
  })
  if (partners.length === 0) return []

  // One grouped count rather than a query per partner.
  const nifs = partners.map((p) => p.businessId).filter((n): n is string => Boolean(n))
  const queued =
    nifs.length === 0
      ? []
      : await prisma.verifactuRecord.groupBy({
          by: ['issuerNif'],
          where: { issuerNif: { in: nifs }, status: RECORD_PENDING },
          _count: { _all: true },
        })
  const queuedByNif = new Map(queued.map((q) => [q.issuerNif, q._count._all]))

  return partners.map((p) => ({
    userId: p.userId,
    company: p.company,
    businessId: p.businessId,
    state: grantState({
      invoicingAuthorityGrantedAt: p.invoicingAuthorityGrantedAt,
      aeatSubmissionGrantedAt: p.aeatSubmissionGrantedAt,
      verifactuGrantTermsVersion: null,
    }),
    invoicingGrantedAt: p.invoicingAuthorityGrantedAt,
    submissionGrantedAt: p.aeatSubmissionGrantedAt,
    queuedRecords: (p.businessId && queuedByNif.get(p.businessId)) || 0,
  }))
}
