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
 *
 * ## TWO authorisation gates, and neither one blocks a record (P7.2)
 *
 * Sending for a partner needs two separate things to be true, held in two
 * different places:
 *
 *  1. **The partner has granted us representation** — `aeatSubmissionGrantedAt`,
 *     captured at `/account/verifactu`. Ours to read, in our own database, so it
 *     is checked BEFORE anything goes over the wire (`authorisedIssuerNifs`).
 *  2. **AEAT has registered us as their colaborador social** — the Convenio.
 *     Only AEAT knows this, and it reports it by refusing a submission with
 *     `ERROR_NOT_ENTITLED`.
 *
 * There is deliberately no local "Convenio approved" setting. AEAT is the
 * authority on its own register, and a flag an operator has to remember to flip
 * is how `taxRegion` silently held every Spanish invoice out of scope.
 *
 * **Neither gate may ever mark a record `blocked`.** Both are states the world
 * grows out of, so the records stay `pending` and go out untouched when it does
 * — see `deferForAuthorisation` for the three ways that is easy to get wrong.
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
  COLABORADOR_SOCIAL,
  platformIssuerJurisdiction,
  platformIssuerNifCandidates,
} from './sistema-informatico'

/**
 * How many records to put in one message. Far below the schema's 1000: a batch is
 * all-or-nothing at the envelope level, and a smaller batch means a single bad
 * record blocks fewer good ones behind it.
 */
export const SUBMISSION_BATCH_SIZE = 100

/**
 * AEAT's code for *"el titular del certificado debe ser Obligado Emision,
 * Colaborador Social, Apoderado o Sucesor"*.
 *
 * It is the one rejection that says nothing about what we sent. Our own
 * database can tell us whether a PARTNER has granted us representation; only
 * AEAT can tell us whether the Convenio registering us as their colaborador
 * social has actually been approved. So this code is how that second gate
 * reports itself, and it is the reason there is no "Convenio approved" flag to
 * maintain by hand: AEAT is the authority on its own register, and a flag
 * someone has to remember to flip is the `taxRegion` mistake again.
 */
export const ERROR_NOT_ENTITLED = 4112

/**
 * How long to wait before trying an unauthorised issuer again.
 *
 * Hours, not minutes: the thing being waited on is an administrative approval
 * at the tax agency, which does not complete between two cron ticks. Retrying
 * on the ordinary backoff would only fill the log.
 */
export const AUTHORISATION_RETRY_MS = 6 * 60 * 60 * 1000

/**
 * Why an issuer's records were not sent, when the reason is an authorisation
 * rather than a fault.
 *
 * Two gates, and the distinction is an OPERATIONAL one — it decides who has to
 * do something next:
 *   - `no-grant-on-file` — the partner has not signed. Chase the partner; the
 *     mechanism is `/account/verifactu`.
 *   - `aeat-not-entitled` — the partner HAS signed and AEAT refused us anyway,
 *     which means the Convenio is not approved for them yet. Chase AEAT.
 * Collapsing them into one boolean would point the operator at the wrong party.
 */
export type AuthorisationGap = 'no-grant-on-file' | 'aeat-not-entitled'

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
   * Restrict to these issuer NIFs. Left unset the sweep covers every issuer with
   * due records, which is what the cron does since P7.2; `submitPlatformRecords`
   * passes our own, which is the narrow case that needs neither a Convenio nor a
   * partner signature.
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
  /**
   * Set when the records could not be sent for want of an authorisation.
   *
   * NOT a failure: the records stay sendable and go out untouched once the
   * missing mandate exists. The value says which mandate, and therefore who
   * has to act.
   */
  awaitingAuthorisation?: AuthorisationGap
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
    awaitingAuthorisation: 'no-grant-on-file',
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
    // Who is doing the sending (P7.2). Present only when the obligado is somebody
    // else: we submit a partner's records as their colaborador social, and AEAT
    // has to be told by whom. Omitted for our own commission invoices, where we
    // ARE the obligado — a representative of oneself is not a thing, and AEAT
    // validates the pair rather than ignoring a redundant one.
    //
    // This is the whole of what "widening the sweep to partners" means on the
    // wire. The authorisation gate it depends on is `authorisedIssuerNifs`, which
    // already ran above, so there is no window in which this can send for a
    // partner who has not granted.
    ...(isPlatformIssuer(issuerNif) ? {} : { representante: { ...COLABORADOR_SOCIAL } }),
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

    // `4112` first. It is a SOAP Fault like the rest, but it is the only one that
    // is not a verdict on anything we sent — AEAT is saying we are not entitled
    // to act for this obligado, typically because the Convenio has not been
    // approved for them yet. Blocking here would be the exact trap P7a exists to
    // avoid: the first partner to accept at `/account/verifactu` would pass our
    // own gate, get refused by AEAT, and have their whole register go terminal.
    if (cause instanceof SoapFaultError && isNotEntitledFault(cause)) {
      await deferForAuthorisation(records, now, message)
      result.error = message
      // Deliberately not `haltedForChainOrder`: nothing was sent, so nothing is
      // out of order. The dedicated flag carries the reason.
      result.awaitingAuthorisation = 'aeat-not-entitled'
      return result
    }

    // Any OTHER SOAP Fault is a verdict on the whole envío, not a transport blip,
    // and will not resolve by retrying — so the batch is blocked, not requeued.
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

    // Defensive: `4112` is documented as an envío-level fault and should have
    // been caught above. If it ever arrives per line it is still an authorisation
    // gap, and blocking it is still the thing that must not happen.
    if (line.codigoError === ERROR_NOT_ENTITLED) {
      await deferForAuthorisation(
        [record],
        now,
        `${ERROR_NOT_ENTITLED}: ${line.descripcionError ?? 'not entitled to act for this obligado'}`,
      )
      result.awaitingAuthorisation = 'aeat-not-entitled'
      halted = true
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

/**
 * Is this fault AEAT refusing us the right to act for the obligado?
 *
 * Matched on the TEXT, which deserves an explanation. SOAP 1.1 `faultcode` is a
 * qualified name — AEAT sends `env:Client` — so the numeric code lives in the
 * `faultstring` and there is no structured field to read it from. The match is
 * therefore anchored on word boundaries rather than a bare `includes`, so an
 * invoice number or a timestamp that happens to contain the digits cannot be
 * mistaken for it.
 *
 * Erring toward NOT matching is the safe direction: a missed `4112` blocks
 * records that an operator then has to unblock, which is visible and
 * recoverable. A false positive would silently defer a genuine rejection
 * forever.
 */
function isNotEntitledFault(fault: SoapFaultError): boolean {
  const code = new RegExp(`\\b${ERROR_NOT_ENTITLED}\\b`)
  return code.test(fault.faultCode ?? '') || code.test(fault.message)
}

/**
 * Park a batch until we are authorised, WITHOUT consuming its retry budget.
 *
 * Three deliberate choices, each of which would otherwise reintroduce the bug
 * this function exists to fix:
 *   - status stays `pending`, never `blocked` — blocked is terminal-until-fixed
 *     and stops retrying, and these must go out untouched the moment the
 *     Convenio lands.
 *   - `attempts` is NOT incremented. Counting an authorisation gap toward
 *     `MAX_SUBMISSION_ATTEMPTS` would exhaust the budget while an approval is
 *     pending and block the records anyway, two days later, for a reason that no
 *     longer applies.
 *   - the error is still stored, because "pending with no explanation" is how an
 *     operator concludes the sweep is simply behind.
 */
async function deferForAuthorisation(
  records: { id: string }[],
  now: Date,
  message: string,
): Promise<void> {
  await prisma.verifactuRecord.updateMany({
    where: { id: { in: records.map((r) => r.id) } },
    data: {
      status: RECORD_PENDING,
      lastAttemptAt: now,
      lastError: message.slice(0, 1000),
      nextAttemptAt: new Date(now.getTime() + AUTHORISATION_RETRY_MS),
    },
  })
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
 * Submit only OUR own records.
 *
 * No longer what the cron calls — since P7.2 that is `submitPendingRecords`,
 * which covers every authorised issuer. This narrower entry point is kept
 * because it is the one sweep that depends on NOTHING external: `4112` accepts
 * the certificate holder as *Obligado Emisión*, and Sunbnb España SL is exactly
 * that on its own commission invoices, so this works on the certificate alone
 * with no Convenio and no partner signature.
 *
 * That makes it the right thing to run as the first live proof against
 * preproducción, and the right thing to fall back to if the Convenio is ever
 * withdrawn.
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
