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
import { normalizeDeviceCode } from '@repo/data/device-code'

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
 *
 * Re-exported from `@repo/data/device-code`, deliberately NOT re-implemented:
 * minting (the provisioning script) and lookup (here) must fold a code
 * identically. A code minted under different rules than the route normalises by
 * is a device that can never be reached — and by then the sticker is glued to a
 * potted enclosure.
 */
export const normalizeCode = normalizeDeviceCode

/**
 * The header a device carries its customer's PARTNER CODE in. A header rather
 * than the URL (which is potted and must never hold anything reassignable) or
 * the body (which the state request does not have).
 */
export const PARTNER_HEADER = 'x-sunbnb-partner'

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
export interface DeviceAssignment {
  siteId: string
  parcel: number
  row: number
  seq: number
  /** A one-shot command to deliver on this poll, or null. */
  cmd: string | null
  /** Q2: emit seats right-to-left, for a device mounted rotated. */
  reverseSegments: boolean
}

/**
 * The device's ASSIGNED LOCATION (track 021 P5) — replaces the stored seat list.
 * A device answers for whatever unit occupies its location today, so a parcel
 * rebuilt at the same address needs no re-assignment.
 *
 * Returns null for retired, unknown, or not-yet-assigned devices: each has
 * nothing to say about any seat, and an empty aggregate would render as FREE.
 */
async function assignmentForCode(code: string): Promise<DeviceAssignment | null> {
  const device = await prisma.device.findUnique({
    where: { code },
    select: {
      status: true,
      assignedSiteId: true,
      assignedParcel: true,
      assignedRow: true,
      assignedSeq: true,
      pendingCmd: true,
      pendingCmdAt: true,
      reverseSegments: true,
    },
  })

  if (!device || device.status === RETIRED) return null

  const { assignedSiteId, assignedParcel, assignedRow, assignedSeq } = device
  if (
    assignedSiteId == null ||
    assignedParcel == null ||
    assignedRow == null ||
    assignedSeq == null
  ) {
    return null
  }

  return {
    siteId: assignedSiteId,
    parcel: assignedParcel,
    row: assignedRow,
    seq: assignedSeq,
    // A one-shot command EXPIRES rather than waiting for an ack there is no
    // channel for. A device that was asleep when "identify" was pressed should
    // not flash an hour later at whoever is standing there then.
    cmd: freshCommand(device.pendingCmd, device.pendingCmdAt),
    reverseSegments: device.reverseSegments,
  }
}

/** How long a pending command stays deliverable. Mirrors the partner action. */
export const CMD_TTL_MS = 2 * 60 * 1000

function freshCommand(cmd: string | null, at: Date | null): string | null {
  if (!cmd || !at) return null
  return Date.now() - at.getTime() <= CMD_TTL_MS ? cmd : null
}

/** `parcel-row-unit`, the human address echoed to the device and shown in the UI. */
export function formatAssignment(a: DeviceAssignment): string {
  return `${a.parcel}-${a.row}-${a.seq}`
}

/**
 * The seats of the unit at an assignment, in segment order.
 *
 * The parcel-scoped index does the narrowing; the ROW lives inside the encoded
 * seat number (parcel*10000 + row*100 + idx) so it is filtered here. Pool spares
 * parked at a unit are excluded — a spare is not a bed under that parasol and
 * must never claim a segment (track 021 P0).
 */
export function unitSeatFilter(a: DeviceAssignment) {
  return {
    siteId: a.siteId,
    group: a.parcel,
    sunbedGroup: { seq: a.seq },
    status: { not: 'pool' },
  }
}

export function isInAssignedRow(number: number, a: DeviceAssignment): boolean {
  return Math.floor(number / 100) % 100 === a.row
}

export type DeviceRequest =
  | { ok: true; code: string; assignment: DeviceAssignment | null; location: string | null }
  | { ok: false; response: Response }

export interface ScreenOptions {
  /**
   * Whether the device must already be bound to seats.
   *
   * TRUE (default, the state route): an unbound device has nothing to say about
   * any seat, and answering an empty aggregate would render as FREE.
   * FALSE (telemetry): an UNASSIGNED device must be able to announce itself, or
   * it can never appear in the fleet list to be assigned from (track 021 P5).
   */
  requireBinding?: boolean
}

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
  options: ScreenOptions = {},
): Promise<DeviceRequest> {
  const expected = process.env.HW_CLIENT_UA
  // No filter configured is OUR fault, not the caller's: 503 → amber, not a decline.
  // Fail CLOSED — an unset value must never mean "let everything through".
  if (!expected) return { ok: false, response: unavailable() }

  if (!clientMatches(request.headers.get('user-agent'), expected)) {
    return { ok: false, response: unauthorized() }
  }

  const code = normalizeCode(rawCode)

  // Telemetry stops here: it needs no binding, and it must NOT reveal whether a
  // code is known. It always answers 204 and merely persists more when it can,
  // so an unassigned device can announce itself without the endpoint becoming
  // an existence oracle for codes printed on public stickers.
  if (options.requireBinding === false) return { ok: true, code, assignment: null, location: null }

  let assignment: DeviceAssignment | null
  try {
    assignment = await assignmentForCode(code)
  } catch {
    // The assignment is unreadable — that is not the caller's fault and must not
    // read as "unknown device": 503 → amber, never a confident answer.
    return { ok: false, response: unavailable() }
  }
  if (!assignment) return { ok: false, response: unauthorized() }

  return { ok: true, code, assignment, location: formatAssignment(assignment) }
}
