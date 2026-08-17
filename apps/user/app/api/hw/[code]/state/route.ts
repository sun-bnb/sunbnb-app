/**
 * HW API — device state (track 019, P1).
 *
 * `GET /api/hw/{code}/state` — the seat state a mounted device's LED bar renders.
 * Polled directly over HTTPS by an ESP32-C6 (`../sunbnb-hw` ADR 0008); this is the
 * first API consumer in the platform that is not a browser.
 *
 * Contract: `.claude/tracks/019-hw-api.md` (§Wire contract) — normative for both
 * repos. One rule from it is load-bearing here and must not be "tidied":
 *
 *   **Never resolve doubt toward FREE.** A wrong OCCUPIED costs one unsold
 *   seat-hour; a wrong FREE puts two parties on one lounger. Anything we cannot
 *   derive confidently is OCCUPIED, and anything we cannot answer at all is a
 *   non-200 so the device shows amber instead of a confident lie.
 *
 * The projection itself lives in `./projection.ts` — a Next.js route file may
 * export only the handlers and a fixed set of config fields, and it is the SECOND
 * SHELL over `deriveState` (@repo/data/reservation-machine), exactly as the partner
 * grid's `bed-state.ts` is: never a second opinion about what a seat's state is
 * (track 018, determinism contract #1). This file is I/O only.
 *
 * The request gate (soft `User-Agent` client filter + the device lookup, Q9 —
 * NOT auth; there is no secret on this surface) is shared with the telemetry post
 * through `../hw-filter`, so the two endpoints cannot drift. Placement has moved
 * twice — `HW_DEVICE_MAP` (P1), `DeviceSeat` bindings (P2), now an assigned
 * ADDRESS (track 021) — and the wire shape did not change with any of them.
 */

import { NextRequest } from 'next/server'
import { createHash } from 'crypto'
import prisma from '@repo/data/PrismaCient'
import { siteDayBounds, siteDayKey } from '@repo/data/site-day'
import { RESERVATION_CANCELED, RESERVATION_REFUNDED } from '@repo/data/reservation-status'
import { screenDeviceRequest, unavailable, unitAddressWhere, SEGMENT_SEATS } from '../hw-filter'
import {
  activeStateForSeat,
  aggregateState,
  wireStateFor,
  type ReservationRow,
  type WireState,
} from './projection'

export const dynamic = 'force-dynamic'

/** Server-driven poll cadence. Firmware obeys this and never hardcodes an interval. */
const POLL_AFTER_SEC = 60

// ─── route ───────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest, { params }: { params: { code: string } }) {
  const screened = await screenDeviceRequest(request, params.code)
  if (!screened.ok) return screened.response
  const { code, assignment } = screened
  if (!assignment) return unavailable()

  try {
    // Track 021 P5: the seats are THE UNIT AT THE ASSIGNED LOCATION, resolved
    // per request rather than stored — so a parcel rebuilt at the same address
    // needs no re-assignment. One indexed lookup on the unit's stored address
    // (UNIQUE(site_id, parcel, row_idx, seq)); the row used to be filtered here
    // in JS because it lived inside the encoded seat number.
    const unit = await prisma.sunbedGroup.findUnique({
      where: unitAddressWhere(assignment),
      select: {
        items: {
          where: SEGMENT_SEATS,
          select: {
            id: true,
            number: true,
            seatLabel: true,
            siteId: true,
            site: { select: { timeZone: true, locationLat: true, locationLng: true } },
          },
          orderBy: { number: 'asc' },
        },
      },
    })
    const items = unit?.items ?? []

    // Assigned to a location that holds no unit — the parcel shrank, or the spot
    // was dismounted. That is a misconfigured device, not a free bed: answer
    // nothing rather than a confident FREE for a bed that is not there.
    if (items.length === 0) return unavailable()
    // A device is mounted at one venue; a unit spanning sites means the data is
    // wrong, and "today" would be ambiguous.
    if (new Set(items.map((i) => i.siteId)).size !== 1) return unavailable()

    const seatIds = items.map((item) => item.id)

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

    // Emitted in seat order within the unit, flipped when the device is mounted
    // rotated (Q2). The bar's segments run left-to-right from the DEVICE's point
    // of view, so a rotated mount — or a row numbered right-to-left — would
    // otherwise light the wrong half. Resolved HERE rather than on the device:
    // firmware holding its own opinion about a physical fact is the thing this
    // design keeps avoiding, and it is why the projection lives server-side too.
    const orderedIds = assignment.reverseSegments ? [...seatIds].reverse() : seatIds
    const seats = orderedIds.map((id) => {
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
      // Track 021 P5: the device's CONFIG rides the poll response. It sits
      // inside the hashed `stable` object deliberately — a reassignment then
      // busts the ETag and reaches the device on its next poll, while an
      // unchanged assignment keeps 304ing. Declarative, not an event: it is
      // present in every 200, so a device that rebooted, lost NVS or was out of
      // range simply converges, with no acknowledgement protocol.
      location: screened.location,
      // Delivered on the next poll and expiring on its own — `identify` flashes
      // the bar so staff can confirm the right box before walking away. It sits
      // in `stable`, so setting one busts the ETag and it actually arrives.
      cmd: assignment.cmd,
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
