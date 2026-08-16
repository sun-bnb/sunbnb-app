/**
 * HW API — the pure projection from reservation state to wire state (track 019).
 *
 * Split out of `route.ts` because a Next.js route file may export ONLY the HTTP
 * handlers and a fixed set of config fields (`dynamic`, `revalidate`, …) — any
 * other export fails `next build` with "is not a valid Route export field".
 * `tsc`, ESLint and vitest all pass on the illegal version, so the split is
 * load-bearing, not cosmetic: keep pure logic here and let `route.ts` hold only
 * I/O (auth, env binding, prisma, headers).
 *
 * Everything in this module is pure — no prisma, no env, no Request. That is
 * what lets the contract be tested directly rather than through the route.
 *
 * Contract: `.claude/tracks/019-hw-api.md` §Wire contract.
 */

import { deriveState, type CompoundState } from '@repo/data/reservation-machine'
import {
  RESERVATION_PAYMENT_FAILED,
  OP_WALKED_IN,
  OP_COMP,
  OP_EXPECTED,
} from '@repo/data/reservation-status'

/** The closed wire vocabulary. Adding a member breaks fielded devices. */
export type WireState = 'FREE' | 'RESERVED' | 'OCCUPIED' | 'UNAVAILABLE'

/** Blocking rank for the aggregate rule: UNAVAILABLE > OCCUPIED > RESERVED > FREE. */
const BLOCKING_RANK: Record<WireState, number> = {
  FREE: 0,
  RESERVED: 1,
  OCCUPIED: 2,
  UNAVAILABLE: 3,
}

/** Legacy literal some old rows carry instead of payment_failed. */
const LEGACY_ERROR = 'error'

/** The reservation shape the route selects — exactly the inputs deriveState needs. */
export type ReservationRow = {
  status: string
  operationalStatus: string
  isComp: boolean
  to: Date
  items: { id: string }[]
  tillEntries: { id: string }[]
  days: { operationalStatus: string }[]
}

function isFailedStatus(status: string): boolean {
  return status === RESERVATION_PAYMENT_FAILED || status === LEGACY_ERROR
}

/**
 * Today's operational status WITHOUT writing a row.
 *
 * The manage page lazy-upserts today's `ReservationDay` (`resolveTodayRow`) and so
 * never meets the gap this closes: a device polls long before any staff member
 * opens the grid, and at 1 500 devices × 60 s an upsert-on-read would be ~1.3 M
 * writes/day. So we mirror what `resolveTodayRow` *would* create, read-only:
 * walk-ins and comps are present-now kinds that track the parent directly; every
 * per-day-cycling kind starts a fresh civil day as `expected`.
 *
 * Falling back to the parent column instead (deriveState's default for a null
 * today-row) would be wrong here: a multiday guest who checked in yesterday and
 * has not arrived today would read `checked-in` → OCCUPIED (dark) when the truth
 * is `expected` → RESERVED (red). Blocked rows are unaffected — deriveState treats
 * the parent as authoritative for them regardless of what we pass. (track 012/018)
 */
export function todayOperationalStatus(res: ReservationRow): string {
  const row = res.days[0]
  if (row) return row.operationalStatus
  return res.operationalStatus === OP_WALKED_IN || res.operationalStatus === OP_COMP
    ? res.operationalStatus
    : OP_EXPECTED
}

function derive(res: ReservationRow, endOfToday: Date): CompoundState {
  return deriveState({
    status: res.status,
    operationalStatus: res.operationalStatus,
    todayOperationalStatus: todayOperationalStatus(res),
    isComp: res.isComp,
    settled: res.tillEntries.length > 0,
    // No reserved days remain after today. Venue-local, never the server's UTC day.
    stayOver: res.to <= endOfToday,
  })
}

/**
 * Projects the machine's compound state onto the wire vocabulary
 * (contract §Wire contract, the derivation table).
 *
 * The `default` arm is the fail-safe and is deliberately unreachable-by-design: an
 * unrecognised compound state must read OCCUPIED, never FREE. If a future `Occ`
 * member lands here, the device dims rather than double-selling the bed.
 */
export function wireStateFor(state: CompoundState): WireState {
  if (state.kind === 'block') return 'UNAVAILABLE'
  switch (state.occ) {
    case 'present':
      return 'OCCUPIED'
    case 'expected':
      return 'RESERVED'
    // Survived the released filter ⇒ multiday mid-stay: still holds the bed. (track 012)
    case 'departed':
    case 'no-show':
      return 'RESERVED'
    // hold, and pending/processing payment — money not settled, bed not free.
    case 'none':
      return 'RESERVED'
    default:
      return 'OCCUPIED'
  }
}

/**
 * The seat's active reservation, mirroring the grid's `getActiveReservation`:
 * released bookings drop out, and a failed one is only chosen when it is the sole
 * candidate — so a red ✕ can never mask a real paid booking on the same seat.
 */
export function activeStateForSeat(
  rows: ReservationRow[],
  endOfToday: Date,
): CompoundState | null {
  const candidates = rows
    .map((res) => ({ res, state: derive(res, endOfToday) }))
    .filter((c) => !c.state.released)

  if (candidates.length === 0) return null
  const nonFailed = candidates.find((c) => !isFailedStatus(c.res.status))
  return (nonFailed ?? candidates[0]!).state
}

/** Aggregate: FREE only if every seat is FREE; otherwise the most blocking member. */
export function aggregateState(states: WireState[]): WireState {
  return states.reduce<WireState>(
    (worst, s) => (BLOCKING_RANK[s] > BLOCKING_RANK[worst] ? s : worst),
    'FREE',
  )
}
