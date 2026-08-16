/**
 * HW API — shared device request filter (track 019, Q9).
 *
 * ONE gate for every `/api/hw/{code}/*` endpoint, so its behaviour cannot drift
 * between the state poll and the telemetry post.
 *
 * **This is a soft client filter, NOT authentication — deliberately.** There is no
 * secret anywhere in this surface: the request carries a `User-Agent` naming the
 * sensor firmware, and the `code` in the path is public routing (it is printed on
 * the device's sticker). Together they let us decline *obvious* non-sensor traffic
 * — scanners, bots, a stray browser — before paying for a DB query. They prove
 * nothing about who is calling, and are not meant to.
 *
 * Why that is the right altitude here (Q8/Q9, decided 2026-08-16): the data behind
 * this endpoint is whether a sunbed is free — already public via the consumer
 * availability API and visible to anyone standing on the beach. Spoofing it or its
 * telemetry is not worth an attacker's time, the damage is non-permanent, and there
 * is zero financial consequence. A real credential (per-device tokens, hashing,
 * OTA rotation, bench minting) would be standing complexity defending an asset
 * nobody will attack. The one residual risk is COST abuse — someone with the value
 * flooding a DB-hitting endpoint — and the backstop for that is edge rate-limiting,
 * a server-side lever, not a secret we would have to rotate through potted devices.
 *
 * Do not "harden" this into auth without revisiting Q9. If a device ever gains a
 * consequential write path (Q5), that is the trigger to reopen it.
 *
 * The binding moved from the `HW_DEVICE_MAP` env var (P1) to the `Device` /
 * `DeviceSeat` tables (P2). Every caller screens through here, so that swap
 * touched only this file and left the wire contract alone.
 *
 * Contract: `.claude/tracks/019-hw-api.md` (§Wire contract, §Identity & client filter).
 */

import { NextRequest } from 'next/server'
import prisma from '@repo/data/PrismaCient'

/**
 * Uniform rejection. Every decline — failed filter, unknown code, malformed code —
 * returns this exact response, so the reject stays opaque and callers learn nothing
 * from the difference. `401` is historical (it predates Q9, when there was a token);
 * `403` would read better for a filter, but the status is explicitly NOT a frozen
 * wire fact — the device treats any non-200 as amber.
 */
export function unauthorized() {
  return Response.json({ error: 'Unauthorized' }, { status: 401 })
}

/** Device cannot be answered honestly → non-200 so the LED goes amber, not green. */
export function unavailable() {
  return Response.json({ error: 'Unavailable' }, { status: 503 })
}

/**
 * Crockford base32 normalisation (contract §Identity): uppercase, `I`/`L` → `1`,
 * `O` → `0`. A human reading a code aloud from a windy beach is the reason the
 * alphabet was chosen; this is the decode half of that promise.
 */
export function normalizeCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[IL]/g, '1').replace(/O/g, '0')
}

/**
 * CONTAINS, not equality. `HW_CLIENT_UA` holds the opaque needle (e.g. `k3n8fq2p`)
 * while firmware sends a fuller, log-friendly string like
 * `Sunbnb-Sensor/1 (k3n8fq2p)` — so bumping `/1` → `/2` never needs a server
 * change. Matching the whole UA exactly would weld the firmware version into
 * server config, which is the one thing a potted fleet cannot afford.
 */
function clientMatches(header: string | null, expected: string): boolean {
  return !!header && header.includes(expected)
}

/**
 * A device whose lifecycle has ended serves nothing. `provisioned` DOES serve:
 * requiring `active` would trap bring-up — a freshly flashed device would be
 * declined until someone flipped a status by hand — and the fail-safe still
 * holds either way, since a declined device shows amber, never a false FREE.
 */
const RETIRED = 'retired'

/**
 * The binding: which seats sit under this device, **in mount order**
 * (`DeviceSeat.position`, 0 = leftmost LED segment). A physical installation
 * fact, stored explicitly and never derived from booking grouping (Q1).
 *
 * P1 read this from the `HW_DEVICE_MAP` env var; P2 reads the `Device` /
 * `DeviceSeat` tables. The wire contract is unchanged by the swap — mount order
 * is still mount order, it just has a home that survives a redeploy and can be
 * edited by the P4 field-binding flow.
 */
async function seatIdsForCode(code: string): Promise<string[] | null> {
  const device = await prisma.device.findUnique({
    where: { code },
    select: {
      status: true,
      seats: { select: { itemId: true }, orderBy: { position: 'asc' } },
    },
  })

  if (!device || device.status === RETIRED) return null
  // A device with no seats bound yet (provisioned, not installed) has nothing to
  // say about any seat — decline rather than answer an empty aggregate, which
  // would render as FREE.
  if (device.seats.length === 0) return null

  return device.seats.map((s) => s.itemId)
}

export type DeviceRequest =
  | { ok: true; code: string; seatIds: string[] }
  | { ok: false; response: Response }

/**
 * Screen a device request: client filter first, then binding lookup. On any
 * decline the caller returns `.response` verbatim and must NOT branch on the
 * reason — a uniform reject is the tidy default. On success the caller gets the
 * normalised `code` and the seat binding in mount order.
 *
 * ORDER MATTERS: the UA filter runs BEFORE the binding query, so junk traffic
 * costs a string compare and never a Postgres round-trip. That is the filter's
 * whole job at Q3's ~1.3 M polls/day.
 */
export async function screenDeviceRequest(
  request: NextRequest,
  rawCode: string,
): Promise<DeviceRequest> {
  const expected = process.env.HW_CLIENT_UA
  // No filter configured is OUR fault, not the caller's: 503 → amber, not a decline.
  // Fail CLOSED — an unset value must never mean "let everything through".
  if (!expected) return { ok: false, response: unavailable() }

  if (!clientMatches(request.headers.get('user-agent'), expected)) {
    return { ok: false, response: unauthorized() }
  }

  const code = normalizeCode(rawCode)

  let seatIds: string[] | null
  try {
    seatIds = await seatIdsForCode(code)
  } catch {
    // The binding is unreadable — that is not the caller's fault and must not
    // read as "unknown device": 503 → amber, never a confident answer.
    return { ok: false, response: unavailable() }
  }
  if (!seatIds) return { ok: false, response: unauthorized() }

  return { ok: true, code, seatIds }
}
