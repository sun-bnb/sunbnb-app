/**
 * Reservation state machine — the DB interpreter (track 018, P2 slice 2).
 *
 * SERVER-ONLY — imports prisma. The pure model (deriveState, TRANSITIONS,
 * resolveTransition) lives in `./reservation-machine` (client-safe); this module
 * executes it against the database:
 *
 *   applyTransition(reservationId, event, opts)
 *     1. load the reservation + today-row + till evidence (venue-local day)
 *     2. deriveState → resolveTransition (null ⇒ typed rejection)
 *     3. execute the row's effect keys via named executors
 *     4. write the post state (status via storageForState; occupancy via a
 *        day-row transition — today's ReservationDay + parent mirror, atomic)
 *
 * Effect coverage is deliberately partial in this slice: transitions on EXISTING
 * reservations (settle / unreserve / occupancy / splits / GC). Rows whose effects
 * involve provider calls or row creation (mollie*, conflictGuardCreate, …) return
 * outcome 'unsupported' until their executors land with the action migration (P4)
 * — applyTransition never half-runs a row.
 *
 * Known duplication (unified in P4): the day-row write mirrors
 * apps/partner/.../reservation-day.ts `applyDayTransition` semantics. It lives
 * here because @repo/data cannot import from apps/*; the partner module will
 * delegate here when actions migrate.
 *
 * I4 defense-in-depth: `deleteRow` refuses — regardless of what the table says —
 * when the reservation has ANY TillEntry (voided included: refund history) or
 * invoice. The table already confines deletes to zero-money states; this guard
 * catches storage drift.
 */

import prisma from '../index'
import { siteDayBounds, siteDayKey, type SiteTimezone } from './site-day'
import {
  deriveState,
  resolveTransition,
  storageForState,
  opForOcc,
  partitionAmount,
  type CompoundState,
  type Condition,
  type EventName,
  type EffectKey,
  type TransitionSpec,
} from './reservation-machine'
import { randomUUID } from 'node:crypto'
import { recordSettlement } from './till'
import {
  processConfirmedReservation, issueCashCreditNote,
  loadFeeContext, resolveServiceFee, calculateServiceFeeAmount, round,
} from './payment'
import {
  createReservationMolliePayment,
  reverifyAndFinalizeReservation,
  cancelReservationMolliePayment,
} from './reservation-payment'
import {
  BLOCKING_STATUSES, OP_DEPARTED, OP_NO_SHOW,
  RESERVATION_PAID_IN_CASH, RESERVATION_PROCESSING,
} from './reservation-status'
import {
  getVivaClient, isVivaPaymentRef, sessionFromVivaRef, vivaRefFromSession, toCents,
  VivaFeeGuardError, type VivaSession,
} from './viva'

/** sunbed-rental service code, shared with the QR/Mollie card-collect cascade lookup. */
const VIVA_SERVICE_CODE = 'sunbed-rental'

/** Default window `runCollectAbandonCard` polls `getSession` for after an abort
 * that doesn't resolve synchronously (raced the card read). Overridable via
 * `opts.collect.abortPollMs` — tests set this near-zero to stay fast. */
const DEFAULT_ABORT_POLL_MS = 8_000
const ABORT_POLL_INTERVAL_MS = 1_000

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ApplyOpts {
  /** Target seats for subset events (unreserve.seat, split.subset, …). */
  itemIds?: string[]
  /** Cash-settlement variant of an event (convert cash vs card). */
  cash?: boolean
  /** Staff-entered amount for staff.settle (falls back to paymentAmount). */
  amount?: number
  /**
   * Worker attribution for till writes (already resolved by the caller):
   * settle entries AND refund counter-entries (Option B — the refunder's
   * drawer pays out, not the original collector's).
   */
  employeeId?: string | null
  /** Injectable clock for tests. */
  now?: Date
  /**
   * Collect-flow context (collect.start / collect.abandon). The redirect URL
   * embeds the anonId the MACHINE mints, so the caller passes a builder, not a
   * string. `demo` short-circuits the provider with a pi_demo ref.
   */
  collect?: {
    demo?: boolean
    buildRedirectUrl?: (anonId: string) => string
    webhookUrl?: string
    /** 'card' routes collect.start/abandon through the Viva rows (cardPresent
     * condition) instead of QR/Mollie. Defaults to 'qr'. */
    method?: 'qr' | 'card'
    /** Required for a 'card' collect.start — the paired Viva Cloud Terminal
     * device (`VivaTerminal.terminalId`). Also accepted on collect.abandon so
     * the executor can resolve the terminal's `cashRegisterId` for abort;
     * when omitted on abandon, `cancelReservationVivaPayment` falls back to
     * the site's terminals (unambiguous only when there is exactly one). */
    terminalId?: string
    /** Override the abort-then-poll window (ms) on a card collect.abandon
     * whose abort didn't resolve synchronously. Default 8000; tests pass a
     * small value to stay fast. */
    abortPollMs?: number
  }
  /**
   * Provider-refund handler for user.cancel (the providerRefund effect). The
   * provider abstraction lives app-side; the MACHINE decides whether a refund
   * is required (paid state + real paymentRef) and orchestrates order: refund
   * BEFORE the status write — a refund failure aborts the cancel.
   */
  refund?: () => Promise<void>
}

export type ApplyResult =
  | { outcome: 'applied'; transition: TransitionSpec; state: CompoundState; newReservationId?: string; data?: Record<string, unknown> }
  | { outcome: 'rejected'; state: CompoundState; event: EventName; reason: string }
  | { outcome: 'conflict' }
  | { outcome: 'not_found' }
  | { outcome: 'unsupported'; effect: EffectKey; event: EventName }
  /** A provider-side effect failed AFTER guards passed; local state was reverted/kept safe. */
  | { outcome: 'effect-failed'; effect: EffectKey; event: EventName; error: string }

/** Effects this slice can execute. Everything else ⇒ outcome 'unsupported'. */
const IMPLEMENTED: ReadonlySet<EffectKey> = new Set<EffectKey>([
  'dayRow', 'deleteRow', 'tillRecord', 'tillVoid', 'tillPartition', 'receiptIssue',
  'creditNoteIssue', 'clearPaymentRef', 'conflictRecheck',
  'seatDisconnect', 'seatPartition', 'amountRepartition', 'lineageLink', 'dayRowClone',
  // Collect flow (P4 slice e). setPaymentRef/email are satisfied INSIDE their
  // composite executors (mollieCreate/demo write the ref; invoiceOnline emails).
  'amountFromDb', 'mintAnonId', 'mollieCreate', 'setPaymentRef',
  'reverifyOnce', 'mollieCancel', 'invoiceOnline', 'email', 'providerRefund',
  'vivaSale', 'vivaAbort',
])

// ─── Loading ─────────────────────────────────────────────────────────────────

interface Loaded {
  id: string
  siteId: string
  userId: string
  status: string
  operationalStatus: string
  isComp: boolean | null
  from: Date
  to: Date
  createdAt: Date
  checkedInAt: Date | null
  departedAt: Date | null
  refundedAt: Date | null
  paymentAmount: number | null
  paymentRef: string | null
  anonId: string | null
  guestName: string | null
  employeeId: string | null
  items: { id: string; price: number | null }[]
  tillEntries: { id: string; amount: number; settledAt: Date; employeeId: string | null; voidedAt: Date | null }[]
  site: { type: string | null; price: number | null; timeZone: string | null; locationLat: string | null; locationLng: string | null }
  todayOp: string | null
  todayDate: Date
  siteTz: SiteTimezone
}

async function load(reservationId: string): Promise<Loaded | null> {
  const r = await prisma.reservation.findUnique({
    where: { id: reservationId },
    select: {
      id: true, siteId: true, userId: true, status: true, operationalStatus: true,
      isComp: true, from: true, to: true, createdAt: true, checkedInAt: true,
      departedAt: true, refundedAt: true, paymentAmount: true, paymentRef: true,
      anonId: true, guestName: true, employeeId: true,
      items: { select: { id: true, price: true } },
      tillEntries: { select: { id: true, amount: true, settledAt: true, employeeId: true, voidedAt: true } },
      site: { select: { type: true, price: true, timeZone: true, locationLat: true, locationLng: true } },
    },
  })
  if (!r) return null
  const siteTz: SiteTimezone = {
    timeZone: r.site.timeZone,
    latitude: r.site.locationLat ? parseFloat(r.site.locationLat) : undefined,
    longitude: r.site.locationLng ? parseFloat(r.site.locationLng) : undefined,
  }
  const todayDate = new Date(siteDayKey(siteTz))
  const today = await prisma.reservationDay.findUnique({
    where: { reservationId_date: { reservationId, date: todayDate } },
    select: { operationalStatus: true },
  })
  return { ...r, todayOp: today?.operationalStatus ?? null, todayDate, siteTz }
}

// ─── Facts (auto-computed conditions — callers supply intent, never facts) ────

function computeConditions(r: Loaded, opts: ApplyOpts, now: Date): Condition[] {
  const conds: Condition[] = []
  const { start: dayStart, end: dayEnd } = siteDayBounds(r.siteTz, now)

  if (r.to > dayEnd) conds.push('hasFutureDays')
  else conds.push('lastDay')

  const departedAt = r.departedAt
  if (departedAt && departedAt >= dayStart && departedAt <= dayEnd) conds.push('sameCivilDay')

  if (r.to < now) conds.push('expired')
  if (now.getTime() - r.createdAt.getTime() > 15 * 60 * 1000) conds.push('stale15m')
  if (now.getTime() - r.createdAt.getTime() > 24 * 60 * 60 * 1000) conds.push('stale24h')

  if (r.refundedAt) conds.push('refundedAt')
  if (opts.cash) conds.push('cash')

  // cardPresent is a FACT: opts.collect.method on collect.start, or the
  // stored paymentRef's prefix on collect.abandon/pay.fail (the caller may
  // not repeat `method` on abandon — the ref itself already says which rail).
  if (opts.collect?.method === 'card' || isVivaPaymentRef(r.paymentRef)) {
    conds.push('cardPresent')
  }

  // subset is a FACT about opts.itemIds vs the reservation's seats
  if (opts.itemIds && opts.itemIds.length > 0) {
    const seatIds = new Set(r.items.map((i) => i.id))
    const allBelong = opts.itemIds.every((id) => seatIds.has(id))
    if (allBelong && opts.itemIds.length < r.items.length) conds.push('subset')
  }
  return conds
}

// ─── Shared executors ────────────────────────────────────────────────────────

/**
 * Day-row transition: upsert today's ReservationDay AND mirror onto the legacy
 * parent columns in one transaction (P2002-retried — Prisma upsert races under
 * concurrent RSC renders). Mirrors partner reservation-day.ts semantics.
 */
async function dayRowTransition(
  r: Loaded,
  op: string,
  stamps: { checkedInAt?: Date | null; departedAt?: Date | null },
  statusOverride?: string,
): Promise<void> {
  const run = () =>
    prisma.$transaction([
      prisma.reservationDay.upsert({
        where: { reservationId_date: { reservationId: r.id, date: r.todayDate } },
        create: {
          reservationId: r.id,
          date: r.todayDate,
          operationalStatus: op,
          checkedInAt: stamps.checkedInAt ?? null,
          departedAt: stamps.departedAt ?? null,
        },
        update: {
          operationalStatus: op,
          ...(stamps.checkedInAt !== undefined ? { checkedInAt: stamps.checkedInAt } : {}),
          ...(stamps.departedAt !== undefined ? { departedAt: stamps.departedAt } : {}),
        },
      }),
      prisma.reservation.update({
        where: { id: r.id },
        data: {
          operationalStatus: op,
          ...(stamps.checkedInAt !== undefined ? { checkedInAt: stamps.checkedInAt } : {}),
          ...(stamps.departedAt !== undefined ? { departedAt: stamps.departedAt } : {}),
          ...(statusOverride ? { status: statusOverride } : {}),
        },
      }),
    ])
  try {
    await run()
  } catch (err) {
    if ((err as { code?: string }).code === 'P2002') { await run(); return }
    throw err
  }
}

/** Occupancy timestamps per target occ. */
function stampsFor(occ: string, now: Date): { checkedInAt?: Date | null; departedAt?: Date | null } {
  switch (occ) {
    case 'present': return { checkedInAt: now, departedAt: null }
    case 'expected': return { checkedInAt: null, departedAt: null }
    case 'departed': return { departedAt: now }
    default: return {}
  }
}

/** PARTNER-only cash receipt — non-blocking, idempotent (track 015 precedent). */
async function issueReceipt(reservationId: string): Promise<void> {
  try {
    await processConfirmedReservation(reservationId, { skipCommission: true, skipEmail: true })
  } catch (e) {
    console.error('[reservation-machine] cash receipt', reservationId, e)
  }
}

/**
 * Credit note against the reservation's cash receipt — non-blocking, same
 * precedent as the receipt itself: the till void is the source of truth for
 * the refund; the credit note is the fiscal audit trail (I2). 'no-receipt' is
 * a normal skip (money was settled but the receipt issue had failed / predates
 * track 015) — logged for reconciliation, never an error.
 */
async function issueCreditNote(reservationId: string, amount: number): Promise<void> {
  try {
    const result = await issueCashCreditNote(reservationId, { amount })
    if (result.status === 'skipped') {
      console.warn(`[reservation-machine] creditNoteIssue skipped (${result.reason})`, reservationId)
    }
  } catch (e) {
    console.error('[reservation-machine] creditNoteIssue', reservationId, e)
  }
}

/**
 * I4 defense: a row with ANY till entry (voided included — refund history) or
 * invoice must never be hard-deleted, whatever the table says.
 */
async function violatesI4(r: Loaded): Promise<boolean> {
  if (r.tillEntries.length > 0) return true
  const invoice = await prisma.invoice.findFirst({ where: { reservationId: r.id }, select: { id: true } })
  return invoice !== null
}

/** Venue-local, today-window conflict recheck on the reservation's seats (excluding self). */
async function hasSeatConflict(r: Loaded, now: Date): Promise<boolean> {
  const { start, end } = siteDayBounds(r.siteTz, now)
  const endOfToday = end
  const conflict = await prisma.reservation.findFirst({
    where: {
      siteId: r.siteId,
      status: { in: BLOCKING_STATUSES as string[] },
      from: { lte: end },
      to: { gte: start },
      items: { some: { id: { in: r.items.map((i) => i.id) } } },
      id: { not: r.id },
      NOT: {
        operationalStatus: { in: [OP_DEPARTED, OP_NO_SHOW] },
        to: { lte: endOfToday },
      },
    },
    select: { id: true },
  })
  return conflict !== null
}

/** Per-seat price weights (DB prices only — I7). */
function seatWeights(items: { price: number | null }[], sitePrice: number | null): number[] {
  return items.map((i) => (i.price ?? null) || sitePrice || 0)
}

/**
 * Which of the reservation's ACTIVE till entries are already CLOSED — swept
 * into a TillClose hand-in by their worker. Option B (2026-08-12): a closed
 * entry is immutable history; refunding it appends a NEGATIVE counter-entry
 * (settledAt = now, attributed to the REFUNDER) instead of voiding — so
 * yesterday's day reports and close snapshots stay frozen, and today's drawer
 * shows the cash going out. Open entries (incl. unclosed carry-over — the cash
 * is still in the drawer) keep void semantics. Entries with no employee are
 * never swept by a close (TillClose is per-employee) ⇒ always open.
 */
async function closedEntryIds(
  r: Loaded,
): Promise<Set<string>> {
  const active = r.tillEntries.filter((e) => e.voidedAt === null && e.employeeId)
  const employeeIds = [...new Set(active.map((e) => e.employeeId!))]
  if (employeeIds.length === 0) return new Set()
  const closes = await prisma.tillClose.groupBy({
    by: ['employeeId'],
    where: { siteId: r.siteId, employeeId: { in: employeeIds } },
    _max: { closedAt: true },
  })
  const lastClose = new Map(closes.map((c) => [c.employeeId, c._max.closedAt!]))
  return new Set(
    active
      .filter((e) => {
        const lc = lastClose.get(e.employeeId!)
        return lc !== undefined && e.settledAt <= lc
      })
      .map((e) => e.id),
  )
}

// ─── Composite executor: seat split (seatPartition / lineage) ────────────────

// ─── Composite executor: seat split (seatPartition / lineage) ────────────────

/**
 * Split a strict subset of seats into a NEW reservation of the same state.
 * Executes: seatPartition + amountRepartition + tillPartition (settled rows) +
 * lineageLink + dayRowClone, atomically. This is the B1 fix: money follows
 * the seats (I1), receipts stay with the lineage (I2 is checked lineage-wide).
 */
async function runSplit(r: Loaded, row: TransitionSpec, opts: ApplyOpts): Promise<{ newReservationId: string }> {
  const subsetIds = opts.itemIds!
  const subsetItems = r.items.filter((i) => subsetIds.includes(i.id))
  const remainingItems = r.items.filter((i) => !subsetIds.includes(i.id))

  const weights = [
    seatWeights(remainingItems, r.site.price).reduce((s, w) => s + w, 0),
    seatWeights(subsetItems, r.site.price).reduce((s, w) => s + w, 0),
  ]
  const [remainingAmount, subsetAmount] = partitionAmount(r.paymentAmount ?? 0, weights) as [number, number]

  const withTill = row.effects.includes('tillPartition')
  const activeEntries = r.tillEntries.filter((e) => e.voidedAt === null)

  const newId = await prisma.$transaction(async (tx) => {
    // 1. seatPartition: disconnect subset; amountRepartition on the original.
    await tx.reservation.update({
      where: { id: r.id },
      data: { paymentAmount: remainingAmount, items: { disconnect: subsetIds.map((id) => ({ id })) } },
    })

    // 2. Create the lineage row — same stored state, attribution copied.
    const created = await tx.reservation.create({
      data: {
        siteId: r.siteId,
        userId: r.userId,
        type: 'days',
        status: r.status,
        operationalStatus: r.operationalStatus,
        checkedInAt: r.checkedInAt,
        from: r.from,
        to: r.to,
        paymentAmount: subsetAmount,
        ...(r.employeeId ? { employeeId: r.employeeId } : {}),
        ...(r.guestName ? { guestName: r.guestName } : {}),
        // lineageLink: conservation invariants (I1/I2) are checked across a lineage.
        splitFromId: r.id,
        items: { connect: subsetIds.map((id) => ({ id })) },
      },
      select: { id: true },
    })

    // 3. tillPartition (I1): void each active entry, recreate per-part entries
    //    preserving settledAt + employee. Sum is preserved exactly per entry.
    //    NOTE: the Option-B closed-entry hybrid deliberately does NOT apply to
    //    splits — no cash moves here; the re-attribution preserves value per
    //    (worker, settledAt), so day reports and close snapshots are unchanged.
    if (withTill && activeEntries.length > 0) {
      const now = opts.now ?? new Date()
      for (const entry of activeEntries) {
        const [keepAmt, moveAmt] = partitionAmount(entry.amount, weights) as [number, number]
        await tx.tillEntry.update({ where: { id: entry.id }, data: { voidedAt: now } })
        if (keepAmt > 0) {
          await tx.tillEntry.create({
            data: { siteId: r.siteId, reservationId: r.id, employeeId: entry.employeeId, amount: keepAmt, settledAt: entry.settledAt },
          })
        }
        if (moveAmt > 0) {
          await tx.tillEntry.create({
            data: { siteId: r.siteId, reservationId: created.id, employeeId: entry.employeeId, amount: moveAmt, settledAt: entry.settledAt },
          })
        }
      }
    }

    // 4. dayRowClone: copy today's row (if any) onto the lineage row.
    const todayRow = await tx.reservationDay.findUnique({
      where: { reservationId_date: { reservationId: r.id, date: r.todayDate } },
    })
    if (todayRow) {
      await tx.reservationDay.create({
        data: {
          reservationId: created.id,
          date: r.todayDate,
          operationalStatus: todayRow.operationalStatus,
          checkedInAt: todayRow.checkedInAt,
          departedAt: todayRow.departedAt,
        },
      })
    }

    return created.id
  })

  return { newReservationId: newId }
}

// ─── Composite executor: seat disconnect (unreserve.seat) ────────────────────

/** Free a subset of seats; the reservation survives with the remaining seats. */
async function runSeatDisconnect(r: Loaded, row: TransitionSpec, opts: ApplyOpts): Promise<void> {
  const freedIds = opts.itemIds!
  const remainingItems = r.items.filter((i) => !freedIds.includes(i.id))
  const freedItems = r.items.filter((i) => freedIds.includes(i.id))

  const weights = [
    seatWeights(remainingItems, r.site.price).reduce((s, w) => s + w, 0),
    seatWeights(freedItems, r.site.price).reduce((s, w) => s + w, 0),
  ]
  const [remainingAmount, freedAmount] = partitionAmount(r.paymentAmount ?? 0, weights) as [number, number]

  const withTill = row.effects.includes('tillPartition')
  const activeEntries = r.tillEntries.filter((e) => e.voidedAt === null)
  const now = opts.now ?? new Date()
  const closed = withTill ? await closedEntryIds(r) : new Set<string>()

  await prisma.$transaction(async (tx) => {
    await tx.reservation.update({
      where: { id: r.id },
      data: { paymentAmount: remainingAmount, items: { disconnect: freedIds.map((id) => ({ id })) } },
    })
    // The freed seats' cash leaves the drawer. Option B hybrid (2026-08-12):
    // OPEN entry → void + recreate only the kept share (original semantics);
    // CLOSED entry → immutable — append a negative counter-entry for the freed
    // share today, attributed to the refunder.
    if (withTill && activeEntries.length > 0) {
      for (const entry of activeEntries) {
        const [keepAmt, freedAmt] = partitionAmount(entry.amount, weights) as [number, number]
        if (closed.has(entry.id)) {
          if (freedAmt > 0) {
            await tx.tillEntry.create({
              data: {
                siteId: r.siteId, reservationId: r.id,
                employeeId: opts.employeeId ?? null,
                amount: -freedAmt, settledAt: now,
              },
            })
          }
        } else {
          await tx.tillEntry.update({ where: { id: entry.id }, data: { voidedAt: now } })
          if (keepAmt > 0) {
            await tx.tillEntry.create({
              data: { siteId: r.siteId, reservationId: r.id, employeeId: entry.employeeId, amount: keepAmt, settledAt: entry.settledAt },
            })
          }
        }
      }
    }
  })

  if (row.effects.includes('creditNoteIssue')) await issueCreditNote(r.id, freedAmount)
}


// ─── Composite executor: collect.start (QR payment for a cash walk-in) ───────

/**
 * Begin collecting an online payment for an UNSETTLED cash walk-in (the table
 * guarantees the pre-state — a settled walk-in is a reject cell, D6).
 * amountFromDb (never a client value, I7) → mintAnonId (the payer's browser
 * capability) → demo ref OR Mollie create (the reservation-payment helper
 * writes paymentRef + processing itself). A provider failure REVERTS to the
 * unsettled cash walk-in — the seat is never stranded.
 */
async function runCollectStart(
  r: Loaded,
  state: CompoundState,
  row: TransitionSpec,
  opts: ApplyOpts,
): Promise<ApplyResult> {
  const collect = opts.collect ?? {}

  // amountFromDb — the walk-in pricing rule (per-seat price ?? site price × civil days)
  const days = Math.max(1, Math.round((r.to.getTime() - r.from.getTime()) / 86_400_000))
  const perDay = r.items.reduce((s, it) => s + ((it.price ?? null) || r.site.price || 0), 0)
  const amount = perDay * days
  if (r.site.type !== 'paid' || amount <= 0) {
    return { outcome: 'rejected', state, event: row.event, reason: 'nothing to charge for this reservation' }
  }

  // Card-present (Viva): no anonId (nothing for the guest's browser). Demo
  // stays on the QR/demo path below REGARDLESS of method — a demo card
  // collect still mints a pi_demo_ ref, per the collect flow's existing
  // "demo short-circuits the provider" contract.
  if (collect.method === 'card' && !collect.demo) {
    await prisma.reservation.update({ where: { id: r.id }, data: { paymentAmount: amount } })
    return runCollectStartCard(r, state, row, opts, amount)
  }

  // mintAnonId + persist the DB-computed amount (non-state columns — direct write).
  const anonId = r.anonId ?? randomUUID()
  await prisma.reservation.update({
    where: { id: r.id },
    data: { paymentAmount: amount, ...(r.anonId ? {} : { anonId }) },
  })

  if (collect.demo) {
    await prisma.reservation.update({
      where: { id: r.id },
      data: { paymentRef: `pi_demo_${(opts.now ?? new Date()).getTime()}`, status: RESERVATION_PROCESSING },
    })
    return { outcome: 'applied', transition: row, state, data: { amount, demo: true } }
  }

  if (!collect.buildRedirectUrl || !collect.webhookUrl) {
    return { outcome: 'effect-failed', effect: 'mollieCreate', event: row.event, error: 'redirect/webhook URL not configured' }
  }

  const created = await createReservationMolliePayment(r.id, {
    redirectUrl: collect.buildRedirectUrl(anonId),
    webhookUrl: collect.webhookUrl,
    metadataExtra: { collect: true },
  })
  if (created.status === 'error') {
    // The helper marks payment_failed on provider errors; a walk-in must stay a
    // CASH walk-in (the guest is on the bed) — revert, never strand.
    await prisma.reservation.update({
      where: { id: r.id },
      data: { status: RESERVATION_PAID_IN_CASH, paymentRef: null },
    })
    return { outcome: 'effect-failed', effect: 'mollieCreate', event: row.event, error: created.error ?? 'payment creation failed' }
  }

  return { outcome: 'applied', transition: row, state, data: { amount, checkoutUrl: created.checkoutUrl } }
}

/**
 * Card-present collect.start (Viva Cloud Terminal). Requires a paired
 * `VivaTerminal` on this site and a connected `vivaMerchantId`; the ISV
 * markup is the `sunbed-rental` cascade fee (same lookup as the online path,
 * `processConfirmedReservation` ~L611), guarded 0 < fee < amount by the
 * client's shared `assertValidIsvFee` (VivaFeeGuardError) — a guard failure
 * is a clear effect-failed, never a silently-dropped fee. On any failure the
 * reservation REVERTS to the unsettled cash walk-in, mirroring the Mollie branch.
 */
async function runCollectStartCard(
  r: Loaded,
  state: CompoundState,
  row: TransitionSpec,
  opts: ApplyOpts,
  amount: number,
): Promise<ApplyResult> {
  const terminalId = opts.collect?.terminalId
  if (!terminalId) {
    return { outcome: 'effect-failed', effect: 'vivaSale', event: row.event, error: 'terminalId not supplied' }
  }
  const terminal = await prisma.vivaTerminal.findUnique({ where: { terminalId } })
  if (!terminal || terminal.siteId !== r.siteId) {
    return { outcome: 'effect-failed', effect: 'vivaSale', event: row.event, error: 'Viva terminal not found for this site' }
  }

  const { site, partnerAccount, settings } = await loadFeeContext(r.siteId, VIVA_SERVICE_CODE)
  // Deliberate v1 assumption (documented, revisit once Viva answers the
  // own-venue/no-fee question — see .claude/tracks/024-card-present-payments.md
  // Q2/Q3): every connected venue pays the ISV markup, no own-merchant carve-out.
  if (!partnerAccount?.vivaMerchantId) {
    return { outcome: 'effect-failed', effect: 'vivaSale', event: row.event, error: 'venue has not connected Viva' }
  }

  const tier = partnerAccount.subscription?.plan?.tier ?? null
  const matchedFee = resolveServiceFee(
    site.serviceFees,
    partnerAccount.serviceFees,
    settings?.serviceFees ?? [],
    VIVA_SERVICE_CODE,
    tier,
  )
  const feeAmount = round(calculateServiceFeeAmount(matchedFee, amount))
  const amountCents = toCents(amount)
  const feeCents = toCents(feeAmount)

  const sessionId = randomUUID()
  const seatCount = r.items.length
  const customerTrns = site.name ? `${site.name} · ${seatCount} seat${seatCount === 1 ? '' : 's'}` : 'Sunbnb'

  try {
    await getVivaClient().createSale({
      sessionId,
      terminalId,
      cashRegisterId: terminal.cashRegisterId,
      amount: amountCents,
      currencyCode: '978',
      merchantReference: r.id,
      customerTrns,
      isvDetails: { amount: feeCents, terminalMerchantId: partnerAccount.vivaMerchantId },
    })
  } catch (e) {
    await prisma.reservation.update({
      where: { id: r.id },
      data: { status: RESERVATION_PAID_IN_CASH, paymentRef: null },
    })
    const message =
      e instanceof VivaFeeGuardError
        ? `ISV fee guard rejected the sale (fee ${feeCents}c vs amount ${amountCents}c): ${e.message}`
        : e instanceof Error ? e.message : 'Viva sale failed'
    return { outcome: 'effect-failed', effect: 'vivaSale', event: row.event, error: message }
  }

  await prisma.reservation.update({
    where: { id: r.id },
    data: { paymentRef: vivaRefFromSession(sessionId), status: RESERVATION_PROCESSING },
  })
  return { outcome: 'applied', transition: row, state, data: { amount, card: true, sessionId } }
}

// ─── Composite executor: collect.abandon (operator closed the QR) ────────────

/**
 * Abandon an in-flight collection. reverifyOnce first — the payment may have
 * landed while the QR was closing; a paid race resolves as `pay.confirm` (the
 * returned transition is the CONFIRM row, honestly). Otherwise cancel at the
 * provider and REVERT to the unsettled cash walk-in.
 *
 * NEVER deletes, NEVER frees the seat (D5): abandon is a payment event and may
 * only touch the payment axis — freeing a bed is an explicit staff Unreserve.
 */
async function runCollectAbandon(
  r: Loaded,
  state: CompoundState,
  row: TransitionSpec,
  opts: ApplyOpts,
): Promise<ApplyResult> {
  const asConfirm = (): ApplyResult => ({
    outcome: 'applied',
    transition: resolveTransition(state, 'pay.confirm') ?? row,
    state,
    data: { paymentStatus: 'complete' },
  })

  const fin = await reverifyAndFinalizeReservation(r.id)
  if (fin.settled === 'complete') return asConfirm()

  if (isVivaPaymentRef(r.paymentRef)) {
    return runCollectAbandonCard(r, state, row, opts, asConfirm)
  }

  const cancel = await cancelReservationMolliePayment(r.id)
  if (cancel.status === 'paid') {
    const fin2 = await reverifyAndFinalizeReservation(r.id)
    if (fin2.settled === 'complete') return asConfirm()
  }

  // canceled, error, or uncertain → the guest keeps the bed as unsettled cash.
  await prisma.reservation.update({
    where: { id: r.id },
    data: { status: RESERVATION_PAID_IN_CASH, paymentRef: null },
  })
  return { outcome: 'applied', transition: row, state, data: { paymentStatus: 'cash' } }
}

/**
 * Poll `getSession` until it leaves `pending` or `deadline` passes. First call
 * always happens (even when `pollMs` is 0) — a session already resolved by
 * the time we ask (declined/aborted/approved) returns on the first check with
 * no wait, which is what keeps the fee-guard/immediate-marker tests fast; the
 * `pollMs` window only matters for a session still genuinely `pending`.
 */
async function pollVivaSession(sessionId: string, pollMs: number, now: Date): Promise<VivaSession> {
  const client = getVivaClient()
  const deadline = now.getTime() + pollMs
  let session = await client.getSession(sessionId)
  while (session.state === 'pending' && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, ABORT_POLL_INTERVAL_MS))
    session = await client.getSession(sessionId)
  }
  return session
}

/**
 * Card-present collect.abandon. Viva's abort only works BEFORE the card is
 * read (`cancelReservationVivaPayment`'s `error` status covers both "abort
 * failed" and "abort raced an in-progress read" — the http client's 200/409
 * both mean "go re-fetch the session"). On that ambiguity we poll rather than
 * revert: reverting a possibly-authorised card would strand a charge the
 * guest's bank thinks succeeded. This is the ONE deliberate divergence from
 * the Mollie abandon (which reverts unconditionally on anything but 'paid').
 */
async function runCollectAbandonCard(
  r: Loaded,
  state: CompoundState,
  row: TransitionSpec,
  opts: ApplyOpts,
  asConfirm: () => ApplyResult,
): Promise<ApplyResult> {
  const sessionId = sessionFromVivaRef(r.paymentRef!)
  let cashRegisterId: string | undefined
  if (opts.collect?.terminalId) {
    const terminal = await prisma.vivaTerminal.findUnique({ where: { terminalId: opts.collect.terminalId } })
    cashRegisterId = terminal?.cashRegisterId
  }

  const revertToCash = async (): Promise<ApplyResult> => {
    await prisma.reservation.update({
      where: { id: r.id },
      data: { status: RESERVATION_PAID_IN_CASH, paymentRef: null },
    })
    return { outcome: 'applied', transition: row, state, data: { paymentStatus: 'cash' } }
  }

  const cancel = await cancelReservationMolliePayment(r.id, cashRegisterId)
  if (cancel.status === 'paid') {
    const fin2 = await reverifyAndFinalizeReservation(r.id)
    if (fin2.settled === 'complete') return asConfirm()
  }
  if (cancel.status === 'canceled') return revertToCash()

  // abort errored or raced the card read (still 'pending' at the API) — poll
  // rather than guess. NEVER revert while the outcome is unresolved.
  const pollMs = opts.collect?.abortPollMs ?? DEFAULT_ABORT_POLL_MS
  const session = await pollVivaSession(sessionId, pollMs, opts.now ?? new Date())
  if (session.state === 'approved') {
    const fin3 = await reverifyAndFinalizeReservation(r.id)
    if (fin3.settled === 'complete') return asConfirm()
    // Viva says approved but our own re-verify didn't confirm yet — stay
    // processing rather than guess; the next poll/webhook will finalize it.
    return { outcome: 'applied', transition: row, state, data: { paymentStatus: 'processing' } }
  }
  if (session.state === 'declined' || session.state === 'aborted') return revertToCash()

  // still pending (or unknown) after the poll window — stay processing, the
  // caller keeps polling. This is the divergence documented above.
  return { outcome: 'applied', transition: row, state, data: { paymentStatus: 'processing' } }
}

// ─── applyTransition ─────────────────────────────────────────────────────────

export async function applyTransition(
  reservationId: string,
  event: EventName,
  opts: ApplyOpts = {},
): Promise<ApplyResult> {
  const now = opts.now ?? new Date()
  const r = await load(reservationId)
  if (!r) return { outcome: 'not_found' }

  const state = deriveState({
    status: r.status,
    operationalStatus: r.operationalStatus,
    todayOperationalStatus: r.todayOp,
    isComp: r.isComp,
    settled: r.tillEntries.some((e) => e.voidedAt === null),
    // stayOver only matters for release derivation, not transition matching
    stayOver: undefined,
  })

  const conditions = computeConditions(r, opts, now)
  const row = resolveTransition(state, event, conditions)
  if (!row) return { outcome: 'rejected', state, event, reason: 'no matching transition (must-reject cell)' }

  const unimplemented = row.effects.find((e) => !IMPLEMENTED.has(e))
  if (unimplemented) return { outcome: 'unsupported', effect: unimplemented, event }

  // ── Composite flows ──
  if (event === 'pay.initiate') {
    // Demo variant only: stamp a pi_demo ref and advance to processing. The
    // REAL initiation is createReservationMolliePayment (a sanctioned writer)
    // — routing it through this event is the consumer create-payment route's
    // future migration, not silently skipping the provider call.
    if (!opts.collect?.demo) return { outcome: 'unsupported', effect: 'mollieCreate', event }
    const ref = `pi_demo_${now.getTime()}`
    await prisma.reservation.update({
      where: { id: r.id },
      data: { paymentRef: ref, status: RESERVATION_PROCESSING },
    })
    return { outcome: 'applied', transition: row, state, data: { paymentRef: ref } }
  }
  if (event === 'collect.start') {
    return runCollectStart(r, state, row, { ...opts, now })
  }
  if (event === 'collect.abandon') {
    return runCollectAbandon(r, state, row, { ...opts, now })
  }
  if (row.effects.includes('seatPartition')) {
    const { newReservationId } = await runSplit(r, row, { ...opts, now })
    return { outcome: 'applied', transition: row, state, newReservationId }
  }
  if (row.effects.includes('seatDisconnect')) {
    await runSeatDisconnect(r, row, { ...opts, now })
    return { outcome: 'applied', transition: row, state }
  }

  // ── Simple flows, in contract order ──
  if (row.effects.includes('conflictRecheck')) {
    if (await hasSeatConflict(r, now)) return { outcome: 'conflict' }
  }

  if (row.post.deleted) {
    if (await violatesI4(r)) {
      return { outcome: 'rejected', state, event, reason: 'I4: row has till/invoice history — not deletable' }
    }
    await prisma.reservation.delete({ where: { id: r.id } })
    return { outcome: 'applied', transition: row, state }
  }

  // providerRefund (user.cancel): required only for a PAID state with a REAL
  // provider ref (demo refs have nothing to refund). Runs BEFORE the status
  // write; a throw here propagates and the cancel never happens.
  if (row.effects.includes('providerRefund')) {
    const needsRefund = state.pay === 'complete' && r.paymentRef && !r.paymentRef.startsWith('pi_demo_')
    if (needsRefund) {
      if (!opts.refund) {
        return { outcome: 'effect-failed', effect: 'providerRefund', event, error: 'refund handler not supplied' }
      }
      try {
        await opts.refund()
      } catch (e) {
        return { outcome: 'effect-failed', effect: 'providerRefund', event, error: e instanceof Error ? e.message : 'refund failed' }
      }
    }
  }

  // invoiceOnline (+ its confirmation email) — the idempotent invoice core owns
  // the status advance to complete; the generic post-write below is a no-op twin.
  if (row.effects.includes('invoiceOnline')) {
    await processConfirmedReservation(r.id)
  }

  if (row.effects.includes('tillVoid')) {
    // Option B hybrid (2026-08-12): void OPEN entries (cash still in the drawer);
    // CLOSED (handed-in) entries get a negative counter-entry today, attributed
    // to the refunder — posted periods stay immutable, today's drawer reconciles.
    const closed = await closedEntryIds(r)
    const active = r.tillEntries.filter((e) => e.voidedAt === null)
    const ops = []
    for (const entry of active) {
      if (closed.has(entry.id)) {
        ops.push(prisma.tillEntry.create({
          data: {
            siteId: r.siteId, reservationId: r.id,
            employeeId: opts.employeeId ?? null,
            amount: -entry.amount, settledAt: now,
          },
        }))
      } else {
        ops.push(prisma.tillEntry.update({ where: { id: entry.id }, data: { voidedAt: now } }))
      }
    }
    if (ops.length > 0) await prisma.$transaction(ops)
  }
  if (row.effects.includes('tillRecord')) {
    const amount = opts.amount ?? r.paymentAmount ?? 0
    if (amount > 0 && r.site.type === 'paid') {
      await recordSettlement({
        siteId: r.siteId,
        reservationId: r.id,
        employeeId: opts.employeeId ?? r.employeeId,
        amount,
        settledAt: now,
      })
    }
  }

  // Post-state write: occupancy via day-row (atomic with parent mirror + status),
  // or a bare status write when only the pay axis moves.
  const newStatus =
    row.post.pay !== undefined || row.post.kind !== undefined
      ? storageForState(row.post.kind ?? state.kind, row.post.pay ?? state.pay)
      : undefined

  if (row.post.occ !== undefined) {
    const op = opForOcc(row.post.kind ?? state.kind, row.post.occ)
    await dayRowTransition(r, op, stampsFor(row.post.occ, now), newStatus)
  } else if (newStatus !== undefined || row.effects.includes('clearPaymentRef')) {
    await prisma.reservation.update({
      where: { id: r.id },
      data: {
        ...(newStatus !== undefined ? { status: newStatus } : {}),
        ...(row.effects.includes('clearPaymentRef') ? { paymentRef: null } : {}),
      },
    })
  }

  if (row.effects.includes('creditNoteIssue')) {
    const refunded = r.tillEntries.filter((e) => e.voidedAt === null).reduce((s, e) => s + e.amount, 0)
    await issueCreditNote(r.id, refunded)
  }
  if (row.effects.includes('receiptIssue')) {
    await issueReceipt(r.id)
  }

  return { outcome: 'applied', transition: row, state }
}
