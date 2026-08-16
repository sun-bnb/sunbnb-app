/**
 * HW API — device telemetry (track 019, P1.5).
 *
 * `POST /api/hw/{code}/telemetry` — `{ fw, battMv, rssiDbm, upSec, polls, tempC? }`
 * → `204`. Battery / RSSI / uptime, fire-and-forget, last-values only (no time
 * series). Polled directly over HTTPS by an ESP32-C6 alongside the state GET.
 *
 * P5: promoted from the P1.5 stub to LAST-VALUES writes on the `Device` row —
 * `fw`, `battMv`, `rssiDbm`, `upSec`, `lastSeenAt`, plus the location the device
 * reports it is RUNNING. No time series: an operator needs "is this one dark,
 * and is its battery going", not history.
 *
 * **This is also how a device SELF-REGISTERS.** Unlike the state route, it does
 * NOT require a binding — an unassigned device must be able to announce itself,
 * or it can never appear in the fleet list to be assigned from (track 021 P5).
 *
 * Contract: `.claude/tracks/019-hw-api.md` (§Wire contract). Two rules are
 * load-bearing here and must not be "tidied":
 *
 *   1. **Telemetry must never fail the device's poll loop.** Once the request is
 *      accepted, the response is 204 regardless of the body — a malformed or absent
 *      payload is still accepted. We never make a device retry telemetry, and a
 *      well-behaved device already tolerates any non-2xx here — but a bad body must
 *      never cost a 4xx/5xx.
 *   2. **Same request gate** as the state route — the soft `User-Agent` client
 *      filter in `../hw-filter` (Q9: a filter, not auth; there is no secret here).
 *      Sharing it is what keeps the two endpoints from drifting.
 */

import { NextRequest } from 'next/server'
import prisma from '@repo/data/PrismaCient'
import { screenDeviceRequest } from '../hw-filter'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest, { params }: { params: { code: string } }) {
  const screened = await screenDeviceRequest(request, params.code, { requireBinding: false })
  if (!screened.ok) return screened.response

  // Everything below is best-effort. Rule 1 is absolute: once the request is
  // accepted the answer is 204, whatever happens — a malformed body, an unknown
  // code, or a database that is down must never make a device retry telemetry.
  try {
    const raw = await request.text()
    const payload = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}

    await prisma.device.updateMany({
      where: { code: screened.code },
      data: {
        lastSeenAt: new Date(),
        ...pickString(payload, 'fw', 'fw'),
        ...pickString(payload, 'loc', 'reportedLocation'),
        ...pickInt(payload, 'battMv', 'battMv'),
        ...pickInt(payload, 'rssiDbm', 'rssiDbm'),
        ...pickInt(payload, 'upSec', 'upSec'),
        // `polls` and `tempC` are accepted and dropped — no column earns its
        // keep yet, and inventing one now would freeze a guess into the wire.
      },
    })
  } catch {
    // Deliberately swallowed — see rule 1.
  }

  return new Response(null, { status: 204 })
}

/**
 * Field pickers that OMIT rather than null. A device sending a partial payload
 * (or a firmware that drops a field between versions) must not wipe the last
 * known value — "we have not heard a battery reading lately" and "the battery
 * is unknown" are different things to an operator.
 */
function pickString(payload: Record<string, unknown>, from: string, to: string) {
  const value = payload[from]
  return typeof value === 'string' && value.length > 0 && value.length <= 64
    ? { [to]: value }
    : {}
}

function pickInt(payload: Record<string, unknown>, from: string, to: string) {
  const value = payload[from]
  return typeof value === 'number' && Number.isFinite(value)
    ? { [to]: Math.trunc(value) }
    : {}
}
