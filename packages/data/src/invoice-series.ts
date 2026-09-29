/**
 * Per-issuer invoice numbering and hash chaining (track 026).
 *
 * Every issuing legal entity gets its OWN correlative series and its OWN hash
 * chain. That is ordinary EU invoicing law, not a Spanish requirement — which
 * is why this module is universal and has no idea what Veri*factu is.
 *
 * ## What this replaces, and why
 *
 * The previous allocator keyed everything on the `issuerType` STRING, so one
 * `PARTNER-YYYY-NNNNN` sequence and one hash chain were shared across every
 * partner in every country. Three separate legal entities were interleaved in
 * one series; each one's "correlative" numbering had large holes belonging to
 * somebody else.
 *
 * Two defects came with it, both fixed here:
 *
 *  1. **The counter was a max-scan with a lock that locks nothing.**
 *     `SELECT … WHERE invoice_number LIKE … ORDER BY … LIMIT 1 FOR UPDATE`
 *     takes no lock when no row matches. That was survivable while one global
 *     series was always populated. Per-issuer series makes the empty case
 *     routine — every new partner's first invoice, every 1 January, every new
 *     credit-note series — and two concurrent transactions would both compute
 *     seq 1, with one dying on the unique constraint *inside the payment
 *     transaction*: the guest's card charged and no invoice written. The
 *     counter is now a row, taken under an advisory lock.
 *
 *  2. **The chain was ordered by `invoicedAt`, a DATE.** A back-dated receipt
 *     therefore chained onto whatever carried the latest date rather than onto
 *     the record that actually preceded it, so the chain did not follow its own
 *     numbering. The chain head is now stored, not searched.
 *
 * ## The lock
 *
 * ONE advisory lock per `seriesKey`, covering both the counter and the chain.
 * They are separate rows with different grain (a counter resets per
 * series-year; an issuer has one chain across all of them), and taking two
 * locks invites a lock-ordering deadlock the moment someone adds a third. One
 * lock per issuer is sufficient because both rows are per-issuer, and it makes
 * the ordering question impossible to get wrong.
 *
 * `$executeRaw`, not `$queryRaw`: `pg_advisory_xact_lock` returns `void`, which
 * the pg driver adapter cannot deserialize as a result column. Same reason, and
 * the same shape, as `mollie-tokens.ts`.
 *
 * The lock is transaction-scoped, so it releases on commit or rollback with no
 * unlock path to forget. Different issuers never contend — which matters,
 * because this sits inside the payment transaction of every sale on the
 * platform.
 */

import { createHash } from 'crypto'
import prisma from '../index'

/** A Prisma transaction client, as the `$transaction` callback receives it. */
type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0]

/** The series key used by Sunbnb's own commission invoices. */
export const PLATFORM_SERIES_KEY = 'PLATFORM'

/**
 * The rendered stem for those invoices. Kept as the literal `PLATFORM` rather
 * than a brand abbreviation: these numbers already exist in that shape, they
 * are read by whoever reconciles the commission, and the platform is a single
 * issuer that will never collide with a partner prefix.
 */
export const PLATFORM_SERIES_PREFIX = 'PLATFORM'

/** Facturas — ordinary sales. */
export const SERIES_FACTURA = 'F'
/** Rectificativas — credit notes. Their own dense counter, so a refund never
 *  puts a hole in the sales sequence. */
export const SERIES_RECTIFICATIVA = 'R'

/**
 * The canonical string `hash` is computed over. Bumping this means the chain
 * changes shape, so old and new records are no longer comparable — which is
 * exactly why the version is stored per row rather than assumed.
 */
export const INVOICE_HASH_VERSION = 'v2'

/** Width of the zero-padded sequence in a rendered number. */
const SEQ_PAD = 5

// ─── Prefix ──────────────────────────────────────────────────────────────────

/**
 * Derive a candidate prefix from a company name: `Hnos. Cortés Perea S.C` → `HCP`.
 *
 * Accent-folded and upper-cased so the stem stays in the ASCII range an invoice
 * number is safest in. Falls back to `INV` for a name with nothing usable in it
 * — a partner with no company name still has to be able to invoice.
 */
export function deriveSeriesPrefix(companyName: string | null | undefined): string {
  const folded = (companyName ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    // Dots BEFORE splitting, so a dotted legal form (`S.C`, `S.L.`) survives
    // as ONE token and is caught by the suffix filter below, instead of
    // splitting into two stray initials.
    .replace(/\./g, '')
    .toUpperCase()

  const initials = folded
    .split(/[^A-Z0-9]+/)
    .filter(Boolean)
    // Legal-form suffixes are not part of what a venue is called, and including
    // them makes every Spanish partner's prefix end in the same letters.
    .filter((w) => !['SL', 'SA', 'SC', 'SLU', 'OY', 'AB', 'BV', 'GMBH', 'LTD'].includes(w))
    .map((w) => w[0]!)
    .join('')

  const stem = initials.slice(0, 4)
  return stem.length > 0 ? stem : 'INV'
}

/**
 * Assign this partner a prefix if it has none, and return it.
 *
 * Globally unique, because the rendered number carries a unique constraint: two
 * partners sharing `AB` would collide on their Nth invoice, inside a payment
 * transaction. On collision a numeric disambiguator is appended (`AB2`, `AB3`).
 *
 * IMMUTABLE once set — the prefix is printed on documents a customer holds, so
 * this only ever fills a null. Re-running is a no-op.
 */
export async function ensureSeriesPrefix(
  tx: Tx,
  partnerAccountId: string,
): Promise<string> {
  const account = await tx.partnerAccount.findUnique({
    where: { userId: partnerAccountId },
    select: { invoiceSeriesPrefix: true, company: true },
  })
  if (account?.invoiceSeriesPrefix) return account.invoiceSeriesPrefix

  const base = deriveSeriesPrefix(account?.company)

  // Serialise prefix assignment across partners: the uniqueness being defended
  // is global, so a per-partner lock would not defend it.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('invoice_series_prefix'), 0)`

  // Re-read inside the lock — a concurrent transaction may have just assigned one.
  const fresh = await tx.partnerAccount.findUnique({
    where: { userId: partnerAccountId },
    select: { invoiceSeriesPrefix: true },
  })
  if (fresh?.invoiceSeriesPrefix) return fresh.invoiceSeriesPrefix

  let candidate = base
  for (let n = 2; ; n++) {
    const taken = await tx.partnerAccount.findFirst({
      where: { invoiceSeriesPrefix: candidate },
      select: { userId: true },
    })
    if (!taken) break
    candidate = `${base}${n}`
  }

  await tx.partnerAccount.update({
    where: { userId: partnerAccountId },
    data: { invoiceSeriesPrefix: candidate },
  })
  return candidate
}

// ─── Number rendering ────────────────────────────────────────────────────────

/** `AB-F-2026-00001`. The stem, the series, the year, the sequence. */
export function renderInvoiceNumber(
  prefix: string,
  seriesCode: string,
  year: number,
  seq: number,
): string {
  return `${prefix}-${seriesCode}-${year}-${String(seq).padStart(SEQ_PAD, '0')}`
}

// ─── Hashing ─────────────────────────────────────────────────────────────────

/**
 * The chain hash for one invoice.
 *
 * EXPORTED, unlike its predecessor — a chain nobody can recompute is a chain
 * nobody can verify, and the integrity claim was untestable from outside this
 * module for as long as it was private.
 *
 * `seriesKey` is in the input so a record cannot be lifted from one issuer's
 * chain into another's and still verify.
 */
export function computeInvoiceHash(input: {
  seriesKey: string
  invoiceNumber: string
  invoicedAt: Date
  totalAmount: number
  issuerVatNumber: string | null
  previousHash: string | null
}): string {
  const canonical = [
    `v=${INVOICE_HASH_VERSION}`,
    `key=${input.seriesKey}`,
    `num=${input.invoiceNumber}`,
    `at=${input.invoicedAt.toISOString()}`,
    `amt=${input.totalAmount.toFixed(2)}`,
    `vat=${input.issuerVatNumber ?? ''}`,
    `prev=${input.previousHash ?? ''}`,
  ].join('|')
  return createHash('sha256').update(canonical).digest('hex')
}

/**
 * Serialise everything one issuer does inside this transaction.
 *
 * Call this at the TOP of an invoicing transaction, before the idempotency
 * re-check — not just inside the allocator. The reason is subtle and was found
 * by a test:
 *
 * Every writer guards against double-invoicing by re-reading its source record
 * inside the transaction. That check is useless against a genuinely concurrent
 * caller, because neither transaction has committed and both see "no invoices
 * yet". What actually stopped the duplicate before was an ACCIDENT: all writers
 * shared one global `PARTNER-YYYY-NNNNN` sequence, so two concurrent creations
 * always collided on the `invoice_number` unique constraint and one died. The
 * shared sequence was a platform-wide mutex nobody designed, enforced by
 * throwing inside a payment transaction.
 *
 * Per-issuer numbering removes that collision — which is the point — so the
 * serialisation has to become deliberate. Taking this lock before the re-check
 * makes the second caller WAIT, then see the first caller's committed invoices
 * and return cleanly, instead of writing a duplicate or throwing.
 *
 * Re-entrant: `allocateInvoiceIdentity` takes the same lock, and a transaction
 * already holding it proceeds immediately. Transaction-scoped, so it is released
 * on commit or rollback with no unlock path to forget.
 */
export async function lockInvoiceSeries(tx: Tx, seriesKey: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('invoice_series'), hashtext(${seriesKey}))`
}

// ─── Allocation ──────────────────────────────────────────────────────────────

export interface AllocateInput {
  /** `PartnerAccount.userId`, or `PLATFORM_SERIES_KEY`. */
  seriesKey: string
  /** `SERIES_FACTURA` or `SERIES_RECTIFICATIVA`. */
  seriesCode: string
  /** The invoice date. The series YEAR is taken from this, never from the clock. */
  invoicedAt: Date
  totalAmount: number
  issuerVatNumber: string | null
  /**
   * Rendered stem. For a partner, pass `ensureSeriesPrefix`'s result; for the
   * platform, its own constant.
   */
  prefix: string
}

/** Everything an Invoice row needs in order to be numbered and chained. */
export interface InvoiceIdentity {
  invoiceNumber: string
  seriesKey: string
  seriesCode: string
  seriesYear: number
  seriesSeq: number
  previousHash: string | null
  hash: string
  hashVersion: string
}

/**
 * Allocate a number and a chain position for one invoice, inside the caller's
 * transaction.
 *
 * The year comes from `invoicedAt` and never from the clock. The old allocator
 * took it as an optional argument that three of the seven writers simply did
 * not pass, so a back-dated rental, deposit or tab receipt was numbered into
 * the CURRENT year — a silent hole in the year it actually belonged to.
 *
 * Returns fields to spread straight into `invoice.create`. The caller must
 * write the row in the SAME transaction: the counter and the chain head have
 * already moved, so a commit without the invoice leaves a permanent gap.
 */
export async function allocateInvoiceIdentity(
  tx: Tx,
  input: AllocateInput,
): Promise<InvoiceIdentity> {
  const { seriesKey, seriesCode, invoicedAt, prefix } = input
  const year = invoicedAt.getUTCFullYear()

  // One lock per issuer, covering the counter and the chain both. See header.
  // Usually already held — the writer takes it before its idempotency check.
  await lockInvoiceSeries(tx, seriesKey)

  // ── counter ──
  const series = await tx.invoiceSeries.upsert({
    where: { seriesKey_seriesCode_year: { seriesKey, seriesCode, year } },
    create: { seriesKey, seriesCode, year, lastSeq: 1 },
    update: { lastSeq: { increment: 1 } },
    select: { lastSeq: true },
  })
  const seq = series.lastSeq
  const invoiceNumber = renderInvoiceNumber(prefix, seriesCode, year, seq)

  // ── chain ──
  const chain = await tx.invoiceChain.findUnique({
    where: { seriesKey },
    select: { lastHash: true, lastSeqNo: true },
  })
  const previousHash = chain?.lastHash ?? null

  const hash = computeInvoiceHash({
    seriesKey,
    invoiceNumber,
    invoicedAt,
    totalAmount: input.totalAmount,
    issuerVatNumber: input.issuerVatNumber,
    previousHash,
  })

  await tx.invoiceChain.upsert({
    where: { seriesKey },
    create: { seriesKey, lastHash: hash, lastSeqNo: 1 },
    update: { lastHash: hash, lastSeqNo: { increment: 1 } },
  })

  return {
    invoiceNumber,
    seriesKey,
    seriesCode,
    seriesYear: year,
    seriesSeq: seq,
    previousHash,
    hash,
    hashVersion: INVOICE_HASH_VERSION,
  }
}

// ─── Verification ────────────────────────────────────────────────────────────

export interface ChainVerification {
  seriesKey: string
  ok: boolean
  checked: number
  /** Human-readable problems, in chain order. Empty when `ok`. */
  problems: string[]
}

/**
 * Walk one issuer's chain and re-derive every hash.
 *
 * This is the routine the integrity claim has been missing: until now nothing
 * could recompute a stored hash, so "tamper-evident" was an assertion rather
 * than something anyone could check. Read-only and safe to run in production.
 *
 * Ordered by the chain's own `seriesSeq` within series, then invoice number —
 * NOT by date, which is what let a back-dated row appear to break a chain that
 * was actually intact.
 */
export async function verifyInvoiceChain(seriesKey: string): Promise<ChainVerification> {
  const invoices = await prisma.invoice.findMany({
    where: { seriesKey, hash: { not: null } },
    select: {
      id: true,
      invoiceNumber: true,
      invoicedAt: true,
      totalAmount: true,
      issuerVatNumber: true,
      previousHash: true,
      hash: true,
      hashVersion: true,
      seriesSeq: true,
    },
    orderBy: [{ seriesSeq: 'asc' }, { invoiceNumber: 'asc' }],
  })

  const problems: string[] = []
  let previousHash: string | null = null

  for (const inv of invoices) {
    const label = inv.invoiceNumber ?? inv.id

    if (inv.hashVersion !== INVOICE_HASH_VERSION) {
      problems.push(
        `${label}: hash version ${inv.hashVersion ?? 'null'} cannot be verified by ${INVOICE_HASH_VERSION}`,
      )
      previousHash = inv.hash
      continue
    }
    if (inv.previousHash !== previousHash) {
      problems.push(
        `${label}: previousHash does not match the preceding record in the chain`,
      )
    }
    const expected = computeInvoiceHash({
      seriesKey,
      invoiceNumber: inv.invoiceNumber ?? '',
      invoicedAt: inv.invoicedAt,
      totalAmount: inv.totalAmount,
      issuerVatNumber: inv.issuerVatNumber,
      previousHash: inv.previousHash,
    })
    if (expected !== inv.hash) {
      problems.push(`${label}: stored hash does not match its contents`)
    }
    previousHash = inv.hash
  }

  return { seriesKey, ok: problems.length === 0, checked: invoices.length, problems }
}
