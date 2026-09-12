/**
 * HW API — shared device request filter (track 019, Q9).
 *
 * ONE gate for every `/api/hw/{code}/*` endpoint, so its behaviour cannot drift
 * between the state poll and the legacy telemetry post. It also RECORDS the
 * device's self-report (`./device-report`), which rides the poll as a header —
 * so a device is tracked by the one request it always makes, and an unassigned
 * one is registered before it is declined.
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
 * How a device is placed has changed twice — the `HW_DEVICE_MAP` env var (P1),
 * then `Device`/`DeviceSeat` seat bindings (P2), now an assigned ADDRESS
 * resolved against `SunbedGroup` (track 021). Every caller screens through here,
 * so each swap touched only this file and left the wire contract alone.
 *
 * Contract: `.claude/tracks/019-hw-api.md` (§Wire contract, §Identity & client filter).
 */

import { NextRequest } from 'next/server'
import prisma from '@repo/data/PrismaCient'
import { normalizeDeviceCode } from '@repo/data/device-code'
import { TELEMETRY_HEADER, parseTelemetryHeader, recordDeviceReport } from './device-report'

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
 * Where this device is mounted. The seats under it follow from the address, so
 * the device is bound to a SPOT rather than to specific seat rows — a parcel
 * rebuilt at the same address needs no re-assignment.
 *
 * Segment order comes from the unit's seats in seat order, flipped by
 * `reverseSegments` for a rotated mount (Q2). That is a physical installation
 * fact and is resolved server-side, never on the device.
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
 * ONE row read per request. The assignment (what to serve) and the last values
 * (what the device's report is compared against before it earns a write) come
 * from the same `findUnique`, so tracking costs no extra query on the poll.
 */
const DEVICE_SELECT = {
  status: true,
  assignedSiteId: true,
  assignedParcel: true,
  assignedRow: true,
  assignedSeq: true,
  pendingCmd: true,
  pendingCmdAt: true,
  reverseSegments: true,
  fw: true,
  battMv: true,
  rssiDbm: true,
  upSec: true,
  reportedLocation: true,
  lastSeenAt: true,
} as const

type DeviceRow = NonNullable<Awaited<ReturnType<typeof readDevice>>>

function readDevice(code: string) {
  return prisma.device.findUnique({ where: { code }, select: DEVICE_SELECT })
}

function assignmentFromRow(device: DeviceRow | null): DeviceAssignment | null {
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
 * The unit standing at an assignment, looked up by its stored ADDRESS — one
 * indexed hit on `UNIQUE(site_id, parcel, row_idx, seq)` (track 021).
 *
 * Re-exported from `@repo/data/unit-address` rather than written here: the same
 * lookup has to be used by the partner action that assigns a device and by the
 * guard that refuses to delete the seats under one. Each used to re-derive the
 * address separately — parcel from `InventoryItem.group`, row decoded out of
 * `InventoryItem.number` — which is precisely how a device, the UI that assigned
 * it and the guard protecting it could end up with three different opinions
 * about where it was.
 */
export { unitAddressWhere, SEGMENT_SEATS } from '@repo/data/unit-address'

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
  /**
   * Record the report header on this request (default TRUE). The legacy
   * telemetry POST passes false and records its JSON body itself, so a request
   * is never written twice.
   */
  track?: boolean
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

  let device: DeviceRow | null
  try {
    device = await readDevice(code)
  } catch {
    // The row is unreadable — that is not the caller's fault and must not read
    // as "unknown device": 503 → amber, never a confident answer.
    return { ok: false, response: unavailable() }
  }

  // TRACKING, before any decline. The report rides every poll as a header
  // (`../device-report`), and it is recorded for a device that is about to be
  // declined for having no assignment — that is precisely the device that must
  // appear in the fleet list to be assigned from. Self-registration is the
  // `device === null` case: the partner claim creates the row. Best-effort and
  // swallowing; the poll never pays for a failed write.
  if (options.track !== false) {
    await recordDeviceReport(code, parseTelemetryHeader(request.headers.get(TELEMETRY_HEADER)), {
      partnerClaim: request.headers.get(PARTNER_HEADER),
      last: device,
    })
  }

  // The legacy telemetry POST stops here: it needs no binding, and it must NOT
  // reveal whether a code is known — it always answers 204, so it never becomes
  // an existence oracle for codes printed on public stickers.
  if (options.requireBinding === false) return { ok: true, code, assignment: null, location: null }

  const assignment = assignmentFromRow(device)
  if (!assignment) return { ok: false, response: unauthorized() }

  return { ok: true, code, assignment, location: formatAssignment(assignment) }
}
