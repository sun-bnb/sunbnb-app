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
 * The projection itself lives in `./projection.ts` — a Next.js route file may
 * export only the handlers and a fixed set of config fields, and it is the SECOND
 * SHELL over `deriveState` (@repo/data/reservation-machine), exactly as the partner
 * grid's `bed-state.ts` is: never a second opinion about what a seat's state is
 * (track 018, determinism contract #1). This file is I/O only.
 *
 * P1 binds devices through `HW_DEVICE_MAP` env config and authenticates with a
 * single shared `HW_TOKEN`; P2 replaces both with the `Device` table and per-device
 * hashed tokens. The wire shape does not change when it does.
 */

import { NextRequest } from 'next/server'
import { createHash, timingSafeEqual } from 'crypto'
import prisma from '@repo/data/PrismaCient'
import { siteDayBounds, siteDayKey } from '@repo/data/site-day'
import { RESERVATION_CANCELED, RESERVATION_REFUNDED } from '@repo/data/reservation-status'
import {
  activeStateForSeat,
  aggregateState,
  normalizeCode,
  wireStateFor,
  type ReservationRow,
  type WireState,
} from './projection'

export const dynamic = 'force-dynamic'

/** Server-driven poll cadence. Firmware obeys this and never hardcodes an interval. */
const POLL_AFTER_SEC = 60

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
