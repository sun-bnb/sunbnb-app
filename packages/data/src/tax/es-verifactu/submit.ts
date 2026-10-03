/**
 * The submission sweep (track 026 phase 7.1b).
 *
 * DB-state-as-queue, modelled on `/api/reconcile` but with the three things that
 * route lacks: an attempt counter, exponential backoff, and a `blocked` terminal
 * state. A permanently-failing row in `reconcile` retries forever in silence;
 * this one gives up loudly and stays visible in `verifactu:health`.
 *
 * ## Queue-and-retry is AEAT's own answer, not a workaround
 *
 * From the developer FAQ §2: records sit *"encolados, pendientes de remisión, con
 * reintentos periódicos, **como si se tratara de una incidencia, sin que ello
 * suponga ningún problema**"*. So an outage is operational, never a reason to fail
 * a payment. The counterweight, from §5: *"no pueden quedar RF generados sin
 * remitir a la AEAT"* — queueing is fine, abandoning is not, which is why the
 * health check and these counters exist.
 *
 * ## Chain order, and why head-of-line blocking is CORRECT here
 *
 * Records within an issuer's chain must reach AEAT in chain order. So the sweep
 * processes one issuer at a time, in `chainSeq` order, and **stops at the first
 * failure for that issuer**. A future maintainer will see a stuck record holding
 * up later ones and want to skip past it: doing so files records out of order and
 * is a compliance breach, not a throughput win. Different issuers are
 * independent and do not block each other.
 *
 * ## One issuer per submission, always
 *
 * `Cabecera` carries a single `ObligadoEmision`, so a message is structurally
 * single-issuer. Mixing would also be worse than useless: `4112` (certificate not
 * entitled to act for this obligado) rejects the WHOLE envío, so one unauthorised
 * partner would take down everyone batched with it.
 */

import prisma from '../../../index'
import {
  buildSubmissionXml,
  MAX_RECORDS_PER_SUBMISSION,
  type CabeceraInput,
} from './registro-xml'
import { isAccepted, SoapFaultError, type RecordReply } from './soap'
import { getAeatClient, type AeatClient } from './client'
import { RECORD_PENDING, RECORD_SENT, RECORD_ERROR, RECORD_BLOCKED } from './record'
import {
  platformIssuerJurisdiction,
  platformIssuerNifCandidates,
} from './sistema-informatico'

/**
 * How many records to put in one message. Far below the schema's 1000: a batch is
 * all-or-nothing at the envelope level, and a smaller batch means a single bad
 * record blocks fewer good ones behind it.
 */
export const SUBMISSION_BATCH_SIZE = 100

/** Backoff schedule in minutes, by attempt number. Capped, then stays capped. */
const BACKOFF_MINUTES = [1, 5, 15, 60, 240]
/** Attempts after which a record stops being retried and is marked blocked. */
export const MAX_SUBMISSION_ATTEMPTS = 12

export function nextAttemptDelayMs(attempts: number): number {
  const idx = Math.min(Math.max(attempts - 1, 0), BACKOFF_MINUTES.length - 1)
  return BACKOFF_MINUTES[idx]! * 60_000
}

export interface SweepOptions {
  /** Inject a client; defaults to the env-resolved one. */
  client?: AeatClient
  now?: Date
  /**
   * Restrict to these issuer NIFs. P7.1 passes the platform's own: we are the
   * *Obligado Emisión* on our commission invoices, so those need no Convenio and
   * no partner signature, while a partner's records stay queued until P7a.
   *
   * A LIST rather than one value because the same entity appears under more than
   * one spelling — the platform `Settings` row stores `ESB22435705` while the
   * constant is bare. SQL cannot fold the prefix, so the candidates are passed
   * explicitly; filtering on the bare form alone matches nothing and reports a
   * clean empty run.
   */
  onlyIssuerNifIn?: string[]
  /** Max issuers to handle in one invocation, so a cron run stays bounded. */
  maxIssuers?: number
}

export interface IssuerSweepResult {
  issuerNif: string
  /** True when this issuer was skipped for want of a submission grant. */
  awaitingAuthorisation?: boolean
  submitted: number
  accepted: number
  rejected: number
  /** True when processing stopped early to preserve chain order. */
  haltedForChainOrder: boolean
  error?: string
}

export interface SweepResult {
  mode: string
  environment: string
  issuers: IssuerSweepResult[]
  accepted: number
  rejected: number
  /** False when a bound stopped the run and more work remains. */
  complete: boolean
}

/** Statuses that still owe AEAT a submission AND are worth retrying now. */
const RETRYABLE = [RECORD_PENDING, RECORD_ERROR]

/**
 * Submit everything due, issuer by issuer.
 *
 * `blocked` records are NOT retried: that state means something a retry cannot
 * fix (an unfilable invoice, an unauthorised issuer). They stay visible in the
 * health check instead.
 */
export async function submitPendingRecords(options: SweepOptions = {}): Promise<SweepResult> {
  const now = options.now ?? new Date()
  const client = options.client ?? getAeatClient()
  const maxIssuers = options.maxIssuers ?? 20

  const due = {
    status: { in: RETRYABLE },
    OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
    ...(options.onlyIssuerNifIn ? { issuerNif: { in: options.onlyIssuerNifIn } } : {}),
  }

  const issuerRows = await prisma.verifactuRecord.groupBy({
    by: ['issuerNif'],
    where: due,
    _count: { _all: true },
  })
  const allIssuers = issuerRows.map((r) => r.issuerNif).sort()

  // ── the colaboración social gate ──
  //
  // AEAT: "ningún colaborador social realice envíos sin estar previamente
  // autorizado". A partner who has not granted representation is skipped, NOT
  // failed — their records stay `pending` and go out untouched the moment the
  // grant arrives. Marking them `blocked` would stop them retrying, which is the
  // opposite of what should happen.
  //
  // We are always authorised for our OWN invoices: there is no third party, and
  // `4112` accepts the certificate holder as Obligado Emisión.
  const authorised = await authorisedIssuerNifs(allIssuers)
  const issuers = allIssuers.filter((nif) => authorised.has(nif))
  const skipped = allIssuers.filter((nif) => !authorised.has(nif))

  const complete = issuers.length <= maxIssuers

  const results: IssuerSweepResult[] = skipped.map((issuerNif) => ({
    issuerNif,
    submitted: 0,
    accepted: 0,
    rejected: 0,
    haltedForChainOrder: false,
    awaitingAuthorisation: true,
  }))
  for (const issuerNif of issuers.slice(0, maxIssuers)) {
    results.push(await sweepOneIssuer(issuerNif, client, now, due))
  }

  return {
    mode: client.mode,
    environment: client.environment,
    issuers: results,
    accepted: results.reduce((n, r) => n + r.accepted, 0),
    rejected: results.reduce((n, r) => n + r.rejected, 0),
    complete,
  }
}

/**
 * Which of these issuer NIFs may we actually submit for?
 *
 * Always ourselves. For partners, only where `aeatSubmissionGrantedAt` is set.
 * Matched on the stored `issuerVatNumber` of their invoices rather than on the
 * account id, because the sweep works in NIF space and the two are joined only
 * through the invoice.
 */
async function authorisedIssuerNifs(issuerNifs: string[]): Promise<Set<string>> {
  const ours = new Set(platformIssuerNifCandidates())
  const allowed = new Set(issuerNifs.filter((nif) => ours.has(nif)))

  const partnerNifs = issuerNifs.filter((nif) => !ours.has(nif))
  if (partnerNifs.length === 0) return allowed

  const granted = await prisma.partnerAccount.findMany({
    where: {
      businessId: { in: partnerNifs },
      aeatSubmissionGrantedAt: { not: null },
    },
    select: { businessId: true },
  })
  for (const row of granted) {
    if (row.businessId) allowed.add(row.businessId)
  }
  return allowed
}

async function sweepOneIssuer(
  issuerNif: string,
  client: AeatClient,
  now: Date,
  due: Record<string, unknown>,
): Promise<IssuerSweepResult> {
  const result: IssuerSweepResult = {
    issuerNif,
    submitted: 0,
    accepted: 0,
    rejected: 0,
    haltedForChainOrder: false,
  }

  // In chain order. This ordering is the whole point — see the module header.
  const records = await prisma.verifactuRecord.findMany({
    where: { ...due, issuerNif },
    orderBy: { chainSeq: 'asc' },
    take: Math.min(SUBMISSION_BATCH_SIZE, MAX_RECORDS_PER_SUBMISSION),
  })
  if (records.length === 0) return result

  // A record with no frozen payload cannot be sent. It predates phase 7.1a, and
  // rebuilding it now would produce a document whose huella no longer matches.
  const missingPayload = records.filter((r) => !r.payloadXml)
  if (missingPayload.length > 0) {
    await prisma.verifactuRecord.updateMany({
      where: { id: { in: missingPayload.map((r) => r.id) } },
      data: {
        status: RECORD_BLOCKED,
        lastError:
          'No frozen payload XML. The record predates the payload builder and cannot be ' +
          'rebuilt without invalidating its huella.',
        lastAttemptAt: now,
      },
    })
    // Chain order again: everything after the earliest gap must wait.
    const firstMissing = Math.min(...missingPayload.map((r) => r.chainSeq))
    const sendable = records.filter((r) => r.chainSeq < firstMissing)
    if (sendable.length === 0) {
      result.haltedForChainOrder = true
      result.error = 'Earliest due record has no payload XML'
      return result
    }
    records.length = 0
    records.push(...sendable)
  }

  const cabecera: CabeceraInput = {
    obligadoEmision: {
      nombreRazon: records[0]!.nombreRazonEmisor ?? '',
      nif: issuerNif,
    },
    // No Representante: P7.1 only submits where WE are the obligado. When P7.2
    // widens this to partners, the platform goes here — and P7a's grant must be
    // checked before it does.
  }

  const document = buildSubmissionXml(
    cabecera,
    records.map((r) => r.payloadXml!),
  )

  let reply
  try {
    reply = await client.submit(document)
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    // A SOAP Fault is a verdict on the whole envío, not a transport blip — `4112`
    // (certificate not entitled to act for this obligado) arrives this way. It
    // will not resolve by retrying, so the batch is blocked rather than requeued.
    const terminal = cause instanceof SoapFaultError
    await failBatch(records, now, message, terminal)
    result.error = message
    result.haltedForChainOrder = true
    return result
  }

  result.submitted = records.length

  // Match replies to records BY INVOICE NUMBER, never by position: the schema
  // does not promise the lines come back in the order they were sent.
  const byNumber = new Map<string, RecordReply>()
  for (const line of reply.lines) byNumber.set(line.numSerieFactura, line)

  // Chain order on the way back too: the first record AEAT did not accept stops
  // the rest, even if a later one was accepted, because the next sweep must
  // resume from the gap.
  let halted = false
  for (const record of records) {
    const line = byNumber.get(record.numSerieFactura)

    if (halted) {
      await requeue(record, now, 'Earlier record in the chain is not yet accepted')
      continue
    }

    if (!line) {
      // Accepted at the envelope level but unmentioned: do NOT assume success.
      await requeue(record, now, 'AEAT reply contained no line for this record')
      halted = true
      continue
    }

    if (isAccepted(line)) {
      await prisma.verifactuRecord.update({
        where: { id: record.id },
        data: {
          status: RECORD_SENT,
          submittedAt: now,
          csv: reply.csv,
          attempts: { increment: 1 },
          lastAttemptAt: now,
          nextAttemptAt: null,
          // AceptadoConErrores is an ACCEPTANCE carrying defects to correct. The
          // message is kept so it is not lost behind a `sent` status.
          lastError:
            line.estado === 'AceptadoConErrores'
              ? `Aceptado con errores${line.codigoError ? ` (${line.codigoError})` : ''}: ${line.descripcionError ?? 'no description'}`
              : line.duplicado
                ? 'Already held by AEAT (RegistroDuplicado) — treated as accepted'
                : null,
        },
      })
      result.accepted += 1
      continue
    }

    // Rejected. A rejection is about the content, so retrying the same bytes
    // changes nothing — block it and let the health check surface it.
    await prisma.verifactuRecord.update({
      where: { id: record.id },
      data: {
        status: RECORD_BLOCKED,
        attempts: { increment: 1 },
        lastAttemptAt: now,
        nextAttemptAt: null,
        lastError: `Rejected${line.codigoError ? ` (${line.codigoError})` : ''}: ${line.descripcionError ?? 'no description'}`,
      },
    })
    result.rejected += 1
    halted = true
  }

  result.haltedForChainOrder = halted
  return result
}

async function failBatch(
  records: { id: string; attempts: number }[],
  now: Date,
  message: string,
  terminal: boolean,
): Promise<void> {
  for (const record of records) {
    const attempts = record.attempts + 1
    const exhausted = attempts >= MAX_SUBMISSION_ATTEMPTS
    await prisma.verifactuRecord.update({
      where: { id: record.id },
      data: {
        status: terminal || exhausted ? RECORD_BLOCKED : RECORD_ERROR,
        attempts,
        lastAttemptAt: now,
        lastError: message.slice(0, 1000),
        nextAttemptAt:
          terminal || exhausted ? null : new Date(now.getTime() + nextAttemptDelayMs(attempts)),
      },
    })
  }
}

async function requeue(
  record: { id: string; attempts: number },
  now: Date,
  reason: string,
): Promise<void> {
  const attempts = record.attempts + 1
  await prisma.verifactuRecord.update({
    where: { id: record.id },
    data: {
      status: attempts >= MAX_SUBMISSION_ATTEMPTS ? RECORD_BLOCKED : RECORD_ERROR,
      attempts,
      lastAttemptAt: now,
      lastError: reason,
      nextAttemptAt:
        attempts >= MAX_SUBMISSION_ATTEMPTS
          ? null
          : new Date(now.getTime() + nextAttemptDelayMs(attempts)),
    },
  })
}

/**
 * The P7.1 entry point: submit only OUR own records.
 *
 * Scoped deliberately. AEAT error `4112` accepts the certificate holder as
 * *Obligado Emisión*, and Sunbnb España SL is exactly that on its own commission
 * invoices — so this works on the certificate alone, with no Convenio and no
 * partner having signed anything. Partner records stay queued until P7a captures
 * their representation grant, which is the correct state and not a failure.
 */
export async function submitPlatformRecords(
  options: Omit<SweepOptions, 'onlyIssuerNifIn'> = {},
): Promise<SweepResult> {
  return submitPendingRecords({ ...options, onlyIssuerNifIn: platformIssuerNifCandidates() })
}

/** Is this NIF our own Spanish entity? Folds an `ES` prefix. */
export function isPlatformIssuer(issuerNif: string): boolean {
  return platformIssuerJurisdiction(issuerNif).country === 'ES'
}
