/**
 * HW API — device telemetry (track 019, P1.5).
 *
 * `POST /api/hw/{code}/telemetry` — `{ fw, battMv, rssiDbm, upSec, polls, tempC? }`
 * → `204`. Battery / RSSI / uptime, fire-and-forget, last-values only (no time
 * series). Polled directly over HTTPS by an ESP32-C6 alongside the state GET.
 *
 * This is a STUB: it authenticates and accepts, but persists NOTHING. Its only job
 * is to let the firmware exercise the real endpoint shape from bring-up onward
 * instead of discovering it at P5 — P5 promotes it to last-values writes on the
 * `Device` row plus an operator health view.
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
import { screenDeviceRequest } from '../hw-filter'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest, { params }: { params: { code: string } }) {
  const screened = await screenDeviceRequest(request, params.code)
  if (!screened.ok) return screened.response

  // P1.5 stub: drain and drop. The body shape is read by P5, not here — but we
  // still consume it so a device that sends a payload never sees a broken
  // connection, and a malformed/absent body can never become a non-2xx (rule 1).
  try {
    await request.text()
  } catch {
    // Deliberately swallowed — see rule 1.
  }

  return new Response(null, { status: 204 })
}
