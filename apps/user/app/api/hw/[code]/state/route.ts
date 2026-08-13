/**
 * HW API — device state (track 019, P1).
 *
 * `GET /api/hw/{code}/state` — the seat state a mounted device's LED bar renders.
 * Polled directly over HTTPS by an ESP32-C6 (`../sunbnb-hw` ADR 0008); this is the
 * first API consumer in the platform that is not a browser.
 *
 * Contract: `.claude/tracks/019-hw-api.md` (§Wire contract) — normative for both
 * repos. Two rules from it are load-bearing here and must not be "tidied":
 *
 *   1. **Never resolve doubt toward FREE.** A wrong OCCUPIED costs one unsold
 *      seat-hour; a wrong FREE puts two parties on one lounger. Anything we cannot
 *      derive confidently is OCCUPIED, and anything we cannot answer at all is a
 *      non-200 so the device shows amber instead of a confident lie.
 *   2. **Uniform 401.** An unknown code and a bad token are indistinguishable to a
 *      caller. The code is printed on a sticker on a public beach, so a
 *      distinguishable 404 would turn the code space into a free oracle.
 *
 * This route is a SECOND SHELL over `deriveState` (@repo/data/reservation-machine),
 * exactly as the partner grid's `bed-state.ts` is — never a second opinion about
 * what a seat's state is (track 018, determinism contract #1).
 *
 * P1 binds devices through `HW_DEVICE_MAP` env config and authenticates with a
 * single shared `HW_TOKEN`; P2 replaces both with the `Device` table and per-device
 * hashed tokens. The wire shape does not change when it does.
 */

import { NextRequest } from 'next/server'
import { createHash, timingSafeEqual } from 'crypto'
import prisma from '@repo/data/PrismaCient'
import { deriveState, type CompoundState } from '@repo/data/reservation-machine'
import { siteDayBounds, siteDayKey } from '@repo/data/site-day'
import {
  RESERVATION_CANCELED,
  RESERVATION_REFUNDED,
  RESERVATION_PAYMENT_FAILED,
  OP_WALKED_IN,
  OP_COMP,
  OP_EXPECTED,
} from '@repo/data/reservation-status'

export const dynamic = 'force-dynamic'

/** The closed wire vocabulary. Adding a member breaks fielded devices. */
export type WireState = 'FREE' | 'RESERVED' | 'OCCUPIED' | 'UNAVAILABLE'

/** Server-driven poll cadence. Firmware obeys this and never hardcodes an interval. */
const POLL_AFTER_SEC = 60

/** Blocking rank for the aggregate rule: UNAVAILABLE > OCCUPIED > RESERVED > FREE. */
const BLOCKING_RANK: Record<WireState, number> = {
  FREE: 0,
  RESERVED: 1,
  OCCUPIED: 2,
  UNAVAILABLE: 3,
}

/** Legacy literal some old rows carry instead of payment_failed. */
const LEGACY_ERROR = 'error'

// ─── auth ────────────────────────────────────────────────────────────────────

/**
 * Uniform failure. Every rejection — bad token, unknown code, malformed code —
 * returns this exact response. Do not add a reason field or a distinct status:
 * the whole point is that a caller learns nothing about whether a code exists.
 */
function unauthorized() {
  return Response.json({ error: 'Unauthorized' }, { status: 401 })
}

/** Device cannot be answered honestly → non-200 so the LED goes amber, not green. */
function unavailable() {
  return Response.json({ error: 'Unavailable' }, { status: 503 })
}

/**
 * Constant-time bearer comparison over sha256 digests — digests are fixed-length,
 * so unlike a raw buffer compare this leaks neither content nor token length.
 */
function bearerMatches(header: string | null, expected: string): boolean {
  if (!header?.startsWith('Bearer ')) return false
  const given = createHash('sha256').update(header.slice(7)).digest()
  const want = createHash('sha256').update(expected).digest()
  return timingSafeEqual(given, want)
}

/**
 * Crockford base32 normalisation (contract §Identity & credentials): uppercase,
 * `I`/`L` → `1`, `O` → `0`. A human reading a code aloud from a windy beach is the
 * reason the alphabet was chosen; this is the decode half of that promise.
 */
export function normalizeCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[IL]/g, '1').replace(/O/g, '0')
}

/**
 * P1 binding: `HW_DEVICE_MAP` is JSON `{"<code>": ["<itemId>", …]}`, and **array
 * order is mount order** — index 0 is the leftmost LED segment. That is the same
 * physical fact `DeviceSeat.position` carries in P2 (Q1, decided): the binding is
 * an installation fact, never derived from booking grouping.
 */
function seatIdsForCode(code: string): string[] | null {
  const raw = process.env.HW_DEVICE_MAP
  if (!raw) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null

  const entry = (parsed as Record<string, unknown>)[code]
  if (!Array.isArray(entry)) return null

  const ids = entry.filter((id): id is string => typeof id === 'string' && id.length > 0)
  return ids.length > 0 ? ids : null
}

// ─── derivation ──────────────────────────────────────────────────────────────

type ReservationRow = {
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
 * opens the grid, and at 1 500 devices × 60 s an upsert-on-read would be 1.3 M
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
function todayOperationalStatus(res: ReservationRow): string {
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
function activeStateForSeat(rows: ReservationRow[], endOfToday: Date): CompoundState | null {
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

// ─── route ───────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest, { params }: { params: { code: string } }) {
  const token = process.env.HW_TOKEN
  if (!token) return unavailable()

  if (!bearerMatches(request.headers.get('authorization'), token)) {
    return unauthorized()
  }

  const code = normalizeCode(params.code)
  const seatIds = seatIdsForCode(code)
  // Unknown code is a 401, NOT a 404 — see the uniform-401 rule at the top.
  if (!seatIds) return unauthorized()

  try {
    const items = await prisma.inventoryItem.findMany({
      where: { id: { in: seatIds } },
      select: {
        id: true,
        number: true,
        seatLabel: true,
        siteId: true,
        site: { select: { timeZone: true, locationLat: true, locationLng: true } },
      },
    })

    // A binding that does not fully resolve is a misconfigured device, not a free
    // bed: answer nothing rather than a partial truth.
    if (items.length !== seatIds.length) return unavailable()
    // A device is mounted at one venue; mixed sites means the map is wrong, and
    // "today" would be ambiguous.
    if (new Set(items.map((i) => i.siteId)).size !== 1) return unavailable()

    const site = items[0]!.site
    const siteTz = {
      timeZone: site.timeZone ?? null,
      latitude: site.locationLat ? parseFloat(site.locationLat) : undefined,
      longitude: site.locationLng ? parseFloat(site.locationLng) : undefined,
    }
    // Venue-local civil day — never the server's UTC day (track 017).
    const { start: startOfToday, end: endOfToday } = siteDayBounds(siteTz)
    const todayKey = siteDayKey(siteTz)

    const reservations = await prisma.reservation.findMany({
      where: {
        items: { some: { id: { in: seatIds } } },
        // Keep payment_failed visible (it still holds the bed until staff clear it);
        // only truly-gone rows drop out. Mirrors the manage grid's query.
        status: { notIn: [RESERVATION_CANCELED, RESERVATION_REFUNDED] },
        from: { lte: endOfToday },
        to: { gte: startOfToday },
      },
      select: {
        status: true,
        operationalStatus: true,
        isComp: true,
        to: true,
        items: { select: { id: true } },
        tillEntries: { where: { voidedAt: null }, select: { id: true } },
        days: { where: { date: new Date(todayKey) }, select: { operationalStatus: true } },
      },
    })

    const byId = new Map(items.map((i) => [i.id, i]))

    // Emitted in BINDING order (the HW_DEVICE_MAP array), which is mount order —
    // not a sort over seat numbers, which would light the wrong half of a bar on a
    // rotated mount or a right-to-left row. (Q1, decided)
    const seats = seatIds.map((id) => {
      const item = byId.get(id)!
      const rows = reservations.filter((r) => r.items.some((i) => i.id === id))
      const state = activeStateForSeat(rows as ReservationRow[], endOfToday)
      return {
        id,
        label: item.seatLabel ?? String(item.number),
        state: state ? wireStateFor(state) : ('FREE' as WireState),
      }
    })

    // Everything the device acts on. `serverTime` is deliberately NOT in here:
    // it changes every request, so including it would make the ETag unique per
    // poll and the 304 path dead code.
    const stable = {
      code,
      state: aggregateState(seats.map((s) => s.state)),
      seats,
      pollAfterSec: POLL_AFTER_SEC,
      cmd: null as string | null,
    }
    const body = { ...stable, serverTime: new Date().toISOString() }

    const etag = `"${createHash('sha256').update(JSON.stringify(stable)).digest('hex').slice(0, 32)}"`

    const headers = {
      'cache-control': 'no-store',
      etag,
    }

    // The device already sends If-None-Match; a 304 is the cheapest possible poll
    // and the first lever against Q3's invocation arithmetic.
    if (request.headers.get('if-none-match') === etag) {
      return new Response(null, { status: 304, headers })
    }

    return Response.json(body, { headers })
  } catch {
    // Never leak internals to a device, and never answer FREE on the way out.
    return unavailable()
  }
}
