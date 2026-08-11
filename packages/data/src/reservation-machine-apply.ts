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
import { recordSettlement, voidSettlementsForReservation } from './till'
import { processConfirmedReservation } from './payment'
import { BLOCKING_STATUSES, OP_DEPARTED, OP_NO_SHOW } from './reservation-status'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ApplyOpts {
  /** Target seats for subset events (unreserve.seat, split.subset, …). */
  itemIds?: string[]
  /** Cash-settlement variant of an event (convert cash vs card). */
  cash?: boolean
  /** Staff-entered amount for staff.settle (falls back to paymentAmount). */
  amount?: number
  /** Worker attribution for till writes (already resolved by the caller). */
  employeeId?: string | null
  /** Injectable clock for tests. */
  now?: Date
}

export type ApplyResult =
  | { outcome: 'applied'; transition: TransitionSpec; state: CompoundState; newReservationId?: string }
  | { outcome: 'rejected'; state: CompoundState; event: EventName; reason: string }
  | { outcome: 'conflict' }
  | { outcome: 'not_found' }
  | { outcome: 'unsupported'; effect: EffectKey; event: EventName }

/** Effects this slice can execute. Everything else ⇒ outcome 'unsupported'. */
const IMPLEMENTED: ReadonlySet<EffectKey> = new Set<EffectKey>([
  'dayRow', 'deleteRow', 'tillRecord', 'tillVoid', 'tillPartition', 'receiptIssue',
  'creditNoteIssue', 'clearPaymentRef', 'conflictRecheck',
  'seatDisconnect', 'seatPartition', 'amountRepartition', 'lineageLink', 'dayRowClone',
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
      guestName: true, employeeId: true,
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

/** Credit-note stub — P2 slice (d) builds the invoice type; until then, loudly logged. */
async function issueCreditNoteStub(reservationId: string, amount: number): Promise<void> {
  console.warn(
    `[reservation-machine] TODO creditNoteIssue: reservation ${reservationId} refunded €${amount.toFixed(2)} — credit-note invoice not yet implemented (track 018 P2d / track 015 deferred)`,
  )
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
        // lineageLink: TODO stamp splitFromId once the additive migration lands (P2c).
        items: { connect: subsetIds.map((id) => ({ id })) },
      },
      select: { id: true },
    })

    // 3. tillPartition (I1): void each active entry, recreate per-part entries
    //    preserving settledAt + employee. Sum is preserved exactly per entry.
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

  await prisma.$transaction(async (tx) => {
    await tx.reservation.update({
      where: { id: r.id },
      data: { paymentAmount: remainingAmount, items: { disconnect: freedIds.map((id) => ({ id })) } },
    })
    // The freed seats' cash leaves the drawer: void + recreate only the kept share.
    if (withTill && activeEntries.length > 0) {
      for (const entry of activeEntries) {
        const [keepAmt] = partitionAmount(entry.amount, weights) as [number, number]
        await tx.tillEntry.update({ where: { id: entry.id }, data: { voidedAt: now } })
        if (keepAmt > 0) {
          await tx.tillEntry.create({
            data: { siteId: r.siteId, reservationId: r.id, employeeId: entry.employeeId, amount: keepAmt, settledAt: entry.settledAt },
          })
        }
      }
    }
  })

  if (row.effects.includes('creditNoteIssue')) await issueCreditNoteStub(r.id, freedAmount)
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

  if (row.effects.includes('tillVoid')) {
    await voidSettlementsForReservation(r.id)
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
    await issueCreditNoteStub(r.id, refunded)
  }
  if (row.effects.includes('receiptIssue')) {
    await issueReceipt(r.id)
  }

  return { outcome: 'applied', transition: row, state }
}
