/**
 * Reservation state machine — the PURE model (track 018, P2).
 *
 * This module is the single source of truth for:
 *   - `deriveState`  — the ONE derivation of a reservation's compound state
 *     (kind × pay-phase × occupancy). The partner grid, every action guard, and
 *     every test read state through this function only.
 *   - `TRANSITIONS`  — the intended transition table as DATA (contract:
 *     `.claude/tracks/018-state-machine-intended.md`). Anything not matched by
 *     `resolveTransition` is a MUST-REJECT cell (asserted by the generated matrix).
 *   - `partitionAmount` — sum-preserving money partition used by split effects
 *     (invariant I1: splits partition till money, never create or destroy it).
 *
 * CLIENT-SAFE: no prisma import, no side effects — this file is imported by
 * client components (the manage grid). The DB interpreter (`applyTransition`,
 * effect execution) lives in a separate server-only module.
 *
 * Determinism contract (track 018 P2):
 *   1. Reified state — this module's deriveState is the only derivation.
 *   2. Single writer — enforced by a meta-guard test over action sources.
 *   3. Effects as data — each row lists named effect keys; interpreters execute
 *      them, actions never hand-roll the side effects.
 *   4. Mechanical verification — matrix + property tests are generated from
 *      TRANSITIONS; analysis is table lookup, never code-path simulation.
 */

import {
  RESERVATION_PENDING,
  RESERVATION_PROCESSING,
  RESERVATION_COMPLETE,
  RESERVATION_PAID_IN_CASH,
  RESERVATION_HELD,
  RESERVATION_PAYMENT_FAILED,
  RESERVATION_CANCELED,
  RESERVATION_REFUNDED,
  OP_EXPECTED,
  OP_CHECKED_IN,
  OP_WALKED_IN,
  OP_DEPARTED,
  OP_NO_SHOW,
  OP_COMP,
} from './reservation-status'

// ─── State axes ──────────────────────────────────────────────────────────────

/** The five entity kinds. Derived, not stored (track 018 decision: no kind column). */
export type Kind = 'online' | 'walkin' | 'hold' | 'comp' | 'block'

/** Payment phase. Online and walkin have distinct vocabularies; zero-money kinds have 'none'. */
export type Pay =
  // online
  | 'pending' | 'processing' | 'complete' | 'payment_failed' | 'canceled' | 'refunded'
  // walkin (settled ⇔ ≥1 non-voided TillEntry; collecting/collected = QR-collect phases)
  | 'unsettled' | 'settled' | 'collecting' | 'collected'
  // hold / comp / block
  | 'none'

/** Occupancy for TODAY (venue-local civil day). 'present' unifies checked-in and walked-in. */
export type Occ = 'expected' | 'present' | 'departed' | 'no-show' | 'none'

export interface CompoundState {
  kind: Kind
  pay: Pay
  occ: Occ
  /** Bed is free despite the row: (departed | no-show) ∧ stay is over. */
  released: boolean
}

/**
 * Input to deriveState — the raw stored tuple. `todayOperationalStatus` is
 * today's ReservationDay row when loaded (null/undefined ⇒ fall back to the
 * parent column, mirroring read-side behavior everywhere).
 */
export interface StateInput {
  status: string
  operationalStatus: string
  todayOperationalStatus?: string | null
  isComp?: boolean | null
  /** ≥1 non-voided TillEntry linked to this reservation. */
  settled?: boolean | null
  /** No reserved days remain after today (computed venue-local). */
  stayOver?: boolean | null
}

// ─── deriveState ─────────────────────────────────────────────────────────────

/** Raw string used on Reservation.operationalStatus for out-of-service beds. */
export const OP_BLOCKED = 'blocked' as const

/** Legacy literal some old rows carry instead of payment_failed. */
const LEGACY_ERROR = 'error'

function effectiveOp(input: StateInput): string {
  // Blocked is sticky and has no day rows — the parent is always authoritative.
  if (input.operationalStatus === OP_BLOCKED) return OP_BLOCKED
  return input.todayOperationalStatus ?? input.operationalStatus
}

/**
 * THE state derivation. Notes on edges (all deliberate, all tested):
 * - `paid-in-cash` is overloaded in storage; kind disambiguates via op/isComp.
 * - A QR-collected walk-in (`complete` + walked-in) is kind walkin, pay
 *   'collected'. Once its multiday stay cycles to `expected`, it derives as
 *   online·complete — deliberate convergence: a fully-paid booking expected to
 *   return behaves like an online booking from there on.
 * - Legacy 'error' status maps to payment_failed.
 */
export function deriveState(input: StateInput): CompoundState {
  const op = effectiveOp(input)

  // kind
  let kind: Kind
  if (op === OP_BLOCKED) kind = 'block'
  else if (input.isComp === true || op === OP_COMP) kind = 'comp'
  else if (input.status === RESERVATION_HELD) kind = 'hold'
  else if (input.status === RESERVATION_PAID_IN_CASH) kind = 'walkin'
  else if (
    (input.status === RESERVATION_PROCESSING || input.status === RESERVATION_COMPLETE) &&
    op === OP_WALKED_IN
  ) kind = 'walkin' // QR-collect phases of a walk-in
  else kind = 'online'

  // pay
  let pay: Pay
  if (kind === 'hold' || kind === 'comp' || kind === 'block') pay = 'none'
  else if (kind === 'walkin') {
    switch (input.status) {
      case RESERVATION_PAID_IN_CASH: pay = input.settled ? 'settled' : 'unsettled'; break
      case RESERVATION_PROCESSING: pay = 'collecting'; break
      case RESERVATION_COMPLETE: pay = 'collected'; break
      case RESERVATION_REFUNDED: pay = 'refunded'; break
      default: pay = 'unsettled' // defensive: unknown walkin status reads unpaid, never paid
    }
  } else {
    switch (input.status) {
      case RESERVATION_PENDING: pay = 'pending'; break
      case RESERVATION_PROCESSING: pay = 'processing'; break
      case RESERVATION_COMPLETE: pay = 'complete'; break
      case RESERVATION_PAYMENT_FAILED: case LEGACY_ERROR: pay = 'payment_failed'; break
      case RESERVATION_CANCELED: pay = 'canceled'; break
      case RESERVATION_REFUNDED: pay = 'refunded'; break
      default: pay = 'pending' // defensive: unknown online status is never treated as paid
    }
  }

  // occ
  let occ: Occ
  switch (op) {
    case OP_EXPECTED: occ = 'expected'; break
    case OP_CHECKED_IN: case OP_WALKED_IN: case OP_COMP: occ = 'present'; break
    case OP_DEPARTED: occ = 'departed'; break
    case OP_NO_SHOW: occ = 'no-show'; break
    default: occ = 'none'
  }

  const released = (occ === 'departed' || occ === 'no-show') && input.stayOver === true

  return { kind, pay, occ, released }
}

// ─── Events, conditions, effects ─────────────────────────────────────────────

export const EVENTS = [
  // create
  'consumer.book.paid', 'consumer.book.free',
  'staff.walkIn.cash', 'staff.walkIn.card',
  'staff.hold', 'staff.comp', 'staff.block',
  // payment rail
  'pay.initiate', 'pay.initiate.fail', 'collect.start',
  'pay.confirm', 'pay.fail', 'collect.abandon', 'pay.refund.webhook',
  // cash
  'staff.settle', 'staff.unreserve.whole', 'staff.unreserve.seat',
  // occupancy
  'staff.checkIn', 'staff.resume', 'staff.resume.undoDepart',
  'staff.depart', 'staff.noShow', 'staff.move',
  // split / convert
  'split.subset', 'convert.holdToWalkIn.whole', 'convert.holdToWalkIn.subset',
  // release / end
  'staff.releaseHold', 'staff.uncomp', 'staff.unblock',
  'partner.cancel', 'partner.refund', 'user.cancel', 'user.delete',
  'staff.removeFailed', 'cron.gc',
] as const
export type EventName = (typeof EVENTS)[number]

/**
 * Context conditions a caller supplies alongside the event. A row matches only
 * when every condition it lists is present. Conditions are FACTS about the
 * situation, never judgment calls — each maps to one computable predicate.
 */
export const CONDITIONS = [
  'hasFutureDays',   // reservation.to extends past today's venue-local day end
  'lastDay',         // ¬hasFutureDays
  'sameCivilDay',    // event occurs on the same venue-local day as the depart
  'subset',          // the operation targets a strict subset of the seats
  'cash',            // cash settlement variant (vs card/unsettled)
  'refundedAt',      // a provider refund was already issued (stamped)
  'stale15m',        // row older than the 15-minute payment-flow cutoff
  'stale24h',        // row older than the 24-hour failed-row cutoff
  'expired',         // stay is over (venue-local `to` in the past)
] as const
export type Condition = (typeof CONDITIONS)[number]

/**
 * Effect vocabulary. Interpreters (server-side) execute these; the table only
 * NAMES them. "What does X do to the till" = read the row.
 */
export const EFFECTS = [
  'conflictGuardCreate', // reserveWithConflictGuard create (FOR UPDATE + re-check)
  'conflictGuardMove',   // moveReservationWithConflictGuard
  'conflictRecheck',     // re-check availability without creating (undo-depart, extend)
  'priceFromDb',         // paymentAmount from DB prices (I7)
  'amountFromDb',        // recompute amount from DB prices at event time (I7)
  'amountRepartition',   // repartition paymentAmount across a seat partition (I7)
  'tillRecord',          // create a TillEntry (cash in drawer)
  'tillVoid',            // void all entries (cash returned)
  'tillPartition',       // void + recreate entries per partition, settledAt/employee preserved (I1)
  'receiptIssue',        // PARTNER-only cash receipt invoice (idempotent)
  'creditNoteIssue',     // credit note referencing the receipt (I2)
  'invoiceOnline',       // PARTNER+PLATFORM invoices (idempotent) + status advance
  'email',               // confirmation email (non-blocking)
  'mollieCreate',        // create provider payment (or demoRef in demo mode)
  'mollieCancel',        // cancel provider payment (reverify-once first)
  'mollieRefund',        // provider refund (idempotent via refundedAt)
  'providerRefund',      // consumer-side refund via provider-agnostic issueRefund
  'reverifyOnce',        // one reverify before acting (abandon race safety)
  'setPaymentRef', 'clearPaymentRef',
  'mintAnonId',          // anonId capability for the payer's browser
  'seatDisconnect',      // disconnect seat(s), reservation survives (I3)
  'seatPartition',       // partition seats into original + new lineage row (I3)
  'lineageLink',         // stamp splitFromId on the new row
  'dayRow',              // applyDayTransition (day row + parent mirror, atomic)
  'dayRowClone',         // create today-row for the new lineage row
  'deleteRow',           // hard delete — ONLY permitted where I4 allows (never money rows)
] as const
export type EffectKey = (typeof EFFECTS)[number]

// ─── Transition table ────────────────────────────────────────────────────────

/** Pre-state pattern: array ⇒ any-of; omitted axis ⇒ any. 'create' ⇒ no existing row. */
export interface StatePattern {
  kind: Kind[]
  pay?: Pay[]
  occ?: Occ[]
}

export interface TransitionSpec {
  event: EventName
  /** 'create' for row-creating events; otherwise a pattern over the current state. */
  pre: StatePattern | 'create'
  /** All listed conditions must be supplied by the caller for this row to match. */
  when?: Condition[]
  /** Post-state deltas; omitted axis unchanged. `deleted` ⇒ row removed (I4-checked). */
  post: { kind?: Kind; pay?: Pay; occ?: Occ; deleted?: boolean; kept?: boolean }
  effects: EffectKey[]
  note?: string
}

/**
 * THE TABLE. Contract: `018-state-machine-intended.md` §3. Row order matters only
 * among same-event rows (first full match wins — put more-conditioned rows first).
 * Every (event × state × conditions) combination with NO matching row is a
 * must-reject cell.
 */
export const TRANSITIONS: TransitionSpec[] = [
  // ── Create ──
  { event: 'consumer.book.paid', pre: 'create', post: { kind: 'online', pay: 'pending', occ: 'expected' }, effects: ['conflictGuardCreate', 'priceFromDb'] },
  { event: 'consumer.book.free', pre: 'create', post: { kind: 'online', pay: 'complete', occ: 'expected' }, effects: ['conflictGuardCreate'] },
  { event: 'staff.walkIn.cash', pre: 'create', post: { kind: 'walkin', pay: 'settled', occ: 'present' }, effects: ['conflictGuardCreate', 'priceFromDb', 'tillRecord', 'receiptIssue'] },
  { event: 'staff.walkIn.card', pre: 'create', post: { kind: 'walkin', pay: 'unsettled', occ: 'present' }, effects: ['conflictGuardCreate', 'priceFromDb'] },
  { event: 'staff.hold', pre: 'create', post: { kind: 'hold', pay: 'none', occ: 'expected' }, effects: ['conflictGuardCreate'] },
  { event: 'staff.comp', pre: 'create', post: { kind: 'comp', pay: 'none', occ: 'present' }, effects: ['conflictGuardCreate'] },
  { event: 'staff.block', pre: 'create', post: { kind: 'block', pay: 'none', occ: 'none' }, effects: ['conflictGuardCreate'], note: 'sentinel `to`; conflict window [today, ∞)' },

  // ── Payment rail ──
  { event: 'pay.initiate', pre: { kind: ['online'], pay: ['pending'] }, post: { pay: 'processing' }, effects: ['mollieCreate', 'setPaymentRef'] },
  { event: 'pay.initiate.fail', pre: { kind: ['online'], pay: ['pending'] }, post: { pay: 'payment_failed' }, effects: [] },
  { event: 'collect.start', pre: { kind: ['walkin'], pay: ['unsettled'], occ: ['present'] }, post: { pay: 'collecting' }, effects: ['amountFromDb', 'mintAnonId', 'mollieCreate', 'setPaymentRef'], note: 'settled NOT in pre — D6 reject cell' },
  { event: 'pay.confirm', pre: { kind: ['online'], pay: ['processing'] }, post: { pay: 'complete' }, effects: ['invoiceOnline', 'email'] },
  { event: 'pay.confirm', pre: { kind: ['walkin'], pay: ['collecting'] }, post: { pay: 'collected' }, effects: ['invoiceOnline', 'email'] },
  { event: 'pay.fail', pre: { kind: ['online'], pay: ['processing'] }, post: { pay: 'payment_failed' }, effects: [] },
  { event: 'pay.fail', pre: { kind: ['walkin'], pay: ['collecting'] }, post: { pay: 'unsettled' }, effects: ['clearPaymentRef'] },
  { event: 'collect.abandon', pre: { kind: ['walkin'], pay: ['collecting'], occ: ['present'] }, post: { pay: 'unsettled' }, effects: ['reverifyOnce', 'mollieCancel', 'clearPaymentRef'], note: 'NEVER deletes/frees — D5' },
  { event: 'pay.refund.webhook', pre: { kind: ['online'], pay: ['complete'] }, post: { pay: 'refunded' }, effects: [] },
  { event: 'pay.refund.webhook', pre: { kind: ['walkin'], pay: ['collected'] }, post: { pay: 'refunded' }, effects: [], note: 'a QR-collected walk-in refunded by the partner' },

  // ── Cash ──
  { event: 'staff.settle', pre: { kind: ['walkin'], pay: ['unsettled'], occ: ['present', 'expected'] }, post: { pay: 'settled' }, effects: ['tillRecord', 'receiptIssue'], note: 'settled pre absent ⇒ double-settle rejected' },
  { event: 'staff.unreserve.whole', pre: { kind: ['walkin'], pay: ['settled'] }, post: { pay: 'refunded', occ: 'departed', kept: true }, effects: ['tillVoid', 'creditNoteIssue', 'dayRow'], note: 'money row KEPT (I4); cash handed back' },
  { event: 'staff.unreserve.whole', pre: { kind: ['walkin'], pay: ['unsettled'] }, post: { deleted: true }, effects: ['deleteRow'] },
  { event: 'staff.unreserve.seat', pre: { kind: ['walkin'], pay: ['settled'], occ: ['present'] }, when: ['subset'], post: {}, effects: ['seatDisconnect', 'amountRepartition', 'tillPartition', 'creditNoteIssue'], note: 'freed seat’s share voided + credit-noted; dialog shows exactly that share (D2)' },
  { event: 'staff.unreserve.seat', pre: { kind: ['walkin'], pay: ['unsettled'], occ: ['present'] }, when: ['subset'], post: {}, effects: ['seatDisconnect', 'amountRepartition'] },

  // ── Occupancy ──
  { event: 'staff.checkIn', pre: { kind: ['online'], pay: ['complete'], occ: ['expected'] }, post: { occ: 'present' }, effects: ['dayRow'], note: 'complete only (D10)' },
  { event: 'staff.resume', pre: { kind: ['walkin'], pay: ['settled', 'unsettled'], occ: ['expected'] }, post: { occ: 'present' }, effects: ['dayRow'] },
  { event: 'staff.resume.undoDepart', pre: { kind: ['walkin'], pay: ['settled', 'unsettled'], occ: ['departed'] }, when: ['sameCivilDay'], post: { occ: 'present' }, effects: ['conflictRecheck', 'dayRow'], note: 'departed re-seatable same day (P1 decision); bed may have been re-let ⇒ recheck' },
  { event: 'staff.depart', pre: { kind: ['online'], pay: ['complete'], occ: ['present'] }, when: ['hasFutureDays'], post: { occ: 'expected' }, effects: ['dayRow'] },
  { event: 'staff.depart', pre: { kind: ['online'], pay: ['complete'], occ: ['present'] }, when: ['lastDay'], post: { occ: 'departed' }, effects: ['dayRow'] },
  { event: 'staff.depart', pre: { kind: ['walkin'], pay: ['settled', 'unsettled', 'collected'], occ: ['present'] }, when: ['hasFutureDays'], post: { occ: 'expected' }, effects: ['dayRow'], note: 'money untouched — keeping cash is Depart’s meaning' },
  { event: 'staff.depart', pre: { kind: ['walkin'], pay: ['settled', 'unsettled', 'collected'], occ: ['present'] }, when: ['lastDay'], post: { occ: 'departed' }, effects: ['dayRow'] },
  { event: 'staff.noShow', pre: { kind: ['online'], pay: ['complete'], occ: ['expected'] }, post: { occ: 'no-show' }, effects: ['dayRow'] },
  { event: 'staff.noShow', pre: { kind: ['walkin'], pay: ['settled', 'unsettled'], occ: ['expected'] }, post: { occ: 'no-show' }, effects: ['dayRow'], note: 'holds no-show via releaseHold, not here (D10)' },
  { event: 'staff.move', pre: { kind: ['online', 'walkin', 'hold', 'comp'], occ: ['expected', 'present'] }, post: {}, effects: ['conflictGuardMove'], note: 'identity/money/invoices preserved' },

  // ── Split / convert ──
  { event: 'split.subset', pre: { kind: ['walkin'], pay: ['settled'], occ: ['present'] }, when: ['subset'], post: {}, effects: ['seatPartition', 'amountRepartition', 'tillPartition', 'lineageLink', 'dayRowClone'], note: 'B1 fix: till follows the seats (I1)' },
  { event: 'split.subset', pre: { kind: ['walkin'], pay: ['unsettled'], occ: ['present'] }, when: ['subset'], post: {}, effects: ['seatPartition', 'amountRepartition', 'lineageLink', 'dayRowClone'], note: 'collecting/collected NOT splittable' },
  { event: 'convert.holdToWalkIn.whole', pre: { kind: ['hold'], occ: ['expected'] }, when: ['cash'], post: { kind: 'walkin', pay: 'settled', occ: 'present' }, effects: ['amountFromDb', 'tillRecord', 'receiptIssue', 'dayRow'], note: 'dayRow atomic with kind change (D9)' },
  { event: 'convert.holdToWalkIn.whole', pre: { kind: ['hold'], occ: ['expected'] }, post: { kind: 'walkin', pay: 'unsettled', occ: 'present' }, effects: ['amountFromDb', 'dayRow'] },
  { event: 'convert.holdToWalkIn.subset', pre: { kind: ['hold'], occ: ['expected'] }, when: ['subset', 'cash'], post: {}, effects: ['seatDisconnect', 'conflictRecheck', 'amountFromDb', 'tillRecord', 'receiptIssue', 'lineageLink', 'dayRowClone'] },
  { event: 'convert.holdToWalkIn.subset', pre: { kind: ['hold'], occ: ['expected'] }, when: ['subset'], post: {}, effects: ['seatDisconnect', 'conflictRecheck', 'amountFromDb', 'lineageLink', 'dayRowClone'] },

  // ── Release / end ──
  { event: 'staff.releaseHold', pre: { kind: ['hold'] }, when: ['subset'], post: {}, effects: ['seatDisconnect'] },
  { event: 'staff.releaseHold', pre: { kind: ['hold'] }, post: { deleted: true }, effects: ['deleteRow'] },
  { event: 'staff.uncomp', pre: { kind: ['comp'] }, when: ['subset'], post: {}, effects: ['seatDisconnect'] },
  { event: 'staff.uncomp', pre: { kind: ['comp'] }, post: { deleted: true }, effects: ['deleteRow'] },
  { event: 'staff.unblock', pre: { kind: ['block'] }, when: ['subset'], post: {}, effects: ['seatDisconnect'] },
  { event: 'staff.unblock', pre: { kind: ['block'] }, post: { deleted: true }, effects: ['deleteRow'] },
  { event: 'partner.cancel', pre: { kind: ['online'], pay: ['complete'] }, when: ['refundedAt'], post: { pay: 'refunded', kept: true }, effects: [], note: 'terminal status alone frees the bed (grid + guard exclude it); day-row untouched' },
  { event: 'partner.cancel', pre: { kind: ['online'], pay: ['complete'] }, post: { pay: 'canceled', kept: true }, effects: [] },
  { event: 'partner.refund', pre: { kind: ['online'], pay: ['complete'] }, post: {}, effects: ['mollieRefund'], note: 'stamps refundedAt only; bed stays occupied' },
  { event: 'user.cancel', pre: { kind: ['online'], pay: ['complete'] }, post: { pay: 'canceled', kept: true }, effects: ['providerRefund'], note: 'refund executes BEFORE the status write via the caller-supplied handler (provider abstraction is app-side); refund failure aborts the cancel' },
  { event: 'user.cancel', pre: { kind: ['online'], pay: ['pending'] }, post: { pay: 'canceled', kept: true }, effects: [] },
  { event: 'user.delete', pre: { kind: ['online'], pay: ['pending', 'payment_failed', 'canceled'] }, post: { deleted: true }, effects: ['deleteRow'], note: 'consumer removes an unpaid/abandoned booking. processing is REJECTED (the payment may still land); a paid-then-canceled row is blocked by the I4 defense (it has invoices)' },
  { event: 'staff.removeFailed', pre: { kind: ['online'], pay: ['payment_failed'] }, post: { deleted: true }, effects: ['deleteRow'] },

  // ── Cron GC (I4: only zero-money rows are deletable; settled walkins have NO row here — reject ⇒ sweep must exclude them) ──
  { event: 'cron.gc', pre: { kind: ['online'], pay: ['pending', 'processing'], occ: ['expected', 'departed', 'no-show', 'none'] }, when: ['stale15m'], post: { deleted: true }, effects: ['deleteRow'], note: 'occ present excluded — protects mid-collection seats' },
  { event: 'cron.gc', pre: { kind: ['online'], pay: ['payment_failed'] }, when: ['stale24h'], post: { deleted: true }, effects: ['deleteRow'] },
  { event: 'cron.gc', pre: { kind: ['hold', 'comp'] }, when: ['expired'], post: { deleted: true }, effects: ['deleteRow'] },
  { event: 'cron.gc', pre: { kind: ['walkin'], pay: ['unsettled'] }, when: ['expired'], post: { deleted: true }, effects: ['deleteRow'] },
]

// ─── Resolution ──────────────────────────────────────────────────────────────

function matchesPattern(state: CompoundState, p: StatePattern): boolean {
  if (!p.kind.includes(state.kind)) return false
  if (p.pay && !p.pay.includes(state.pay)) return false
  if (p.occ && !p.occ.includes(state.occ)) return false
  return true
}

/**
 * Resolve an event against the current state (null ⇒ creating). Returns the
 * matching transition row, or null ⇒ MUST REJECT. Among same-event rows the
 * first full match wins (more-conditioned rows are listed first).
 */
export function resolveTransition(
  state: CompoundState | null,
  event: EventName,
  conditions: Condition[] = [],
): TransitionSpec | null {
  for (const t of TRANSITIONS) {
    if (t.event !== event) continue
    if (t.pre === 'create') {
      if (state !== null) continue
    } else {
      if (state === null || !matchesPattern(state, t.pre)) continue
    }
    if (t.when && !t.when.every((c) => conditions.includes(c))) continue
    return t
  }
  return null
}

// ─── State → storage mapping (deriveState's inverse, used by the interpreter) ─

/**
 * The Reservation.status string that stores a given (kind, pay). Inverse of
 * deriveState's pay derivation — keeping both here means the mapping can never
 * fork between reader and writer.
 */
export function storageForState(kind: Kind, pay: Pay): string {
  if (kind === 'hold') return RESERVATION_HELD
  if (kind === 'comp' || kind === 'block') return RESERVATION_PAID_IN_CASH
  if (kind === 'walkin') {
    switch (pay) {
      case 'unsettled': case 'settled': return RESERVATION_PAID_IN_CASH
      case 'collecting': return RESERVATION_PROCESSING
      case 'collected': return RESERVATION_COMPLETE
      case 'refunded': return RESERVATION_REFUNDED
      default: return RESERVATION_PAID_IN_CASH
    }
  }
  // online: pay values ARE the status strings
  return pay === 'none' ? RESERVATION_PENDING : pay
}

/**
 * The operationalStatus string that stores a given occupancy for a kind.
 * 'present' is the kind-dependent one: walk-ins stay walked-in (red), online
 * bookings are checked-in (blue), comps stay comp (sky).
 */
export function opForOcc(kind: Kind, occ: Occ): string {
  switch (occ) {
    case 'expected': return OP_EXPECTED
    case 'present':
      if (kind === 'walkin') return OP_WALKED_IN
      if (kind === 'comp') return OP_COMP
      return OP_CHECKED_IN
    case 'departed': return OP_DEPARTED
    case 'no-show': return OP_NO_SHOW
    case 'none': return kind === 'block' ? OP_BLOCKED : OP_EXPECTED
  }
}

// ─── Money partition (I1 helper) ─────────────────────────────────────────────

/**
 * Partition `total` (euros, 2dp) across `weights`, preserving the sum exactly.
 * Largest-remainder in integer cents; zero/negative weight vectors fall back to
 * an equal split. Used by tillPartition / amountRepartition so splits can never
 * create or destroy money (invariant I1).
 */
export function partitionAmount(total: number, weights: number[]): number[] {
  if (weights.length === 0) return []
  const totalCents = Math.round(total * 100)
  const weightSum = weights.reduce((s, w) => s + (w > 0 ? w : 0), 0)
  const effWeights = weightSum > 0 ? weights.map((w) => (w > 0 ? w : 0)) : weights.map(() => 1)
  const effSum = weightSum > 0 ? weightSum : weights.length

  const raw = effWeights.map((w) => (totalCents * w) / effSum)
  const floors = raw.map(Math.floor)
  let remainder = totalCents - floors.reduce((s, c) => s + c, 0)

  // Distribute leftover cents to the largest fractional parts (stable by index).
  const order = raw
    .map((r, i) => ({ frac: r - Math.floor(r), i }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i)
  const cents = [...floors]
  for (const { i } of order) {
    if (remainder <= 0) break
    cents[i]! += 1
    remainder -= 1
  }
  return cents.map((c) => c / 100)
}
