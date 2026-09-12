/**
 * HW API — device telemetry (track 019, P1.5 → P5 → legacy).
 *
 * `POST /api/hw/{code}/telemetry` — `{ fw, battMv, rssiDbm, upSec, polls, tempC?, loc? }`
 * → `204`. Last-values only, fire-and-forget.
 *
 * **Not the tracking path any more.** Tracking rides the state poll as the
 * `x-sunbnb-telemetry` request header (`../device-report`), because a second
 * request on a battery-constrained device is a request that gets dropped — and
 * it was: the firmware never called this, and the fleet list went blind. This
 * route is kept as the ESCAPE HATCH for a report that outgrows a header (a boot
 * diagnostic dump, say). It writes through the same recorder as the poll, so the
 * two cannot drift, but UNTHROTTLED — a call here is rare and explicit.
 *
 * Contract: `.claude/tracks/019-hw-api.md` (§Wire contract). Two rules are
 * load-bearing here and must not be "tidied":
 *
 *   1. **Telemetry must never fail the device's poll loop.** Once the request is
 *      accepted, the response is 204 regardless of the body — a malformed or absent
 *      payload is still accepted, and so is a database that is down.
 *   2. **Same request gate** as the state route — the soft `User-Agent` client
 *      filter in `../hw-filter` (Q9: a filter, not auth; there is no secret here).
 *      Screened with `track: false` so the header recorder does not run — the body
 *      is recorded here instead, once.
 */

import { NextRequest } from 'next/server'
import prisma from '@repo/data/PrismaCient'
import { PARTNER_HEADER, screenDeviceRequest } from '../hw-filter'
import { recordDeviceReport, reportFromBody } from '../device-report'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest, { params }: { params: { code: string } }) {
  const screened = await screenDeviceRequest(request, params.code, {
    requireBinding: false,
    track: false,
  })
  if (!screened.ok) return screened.response

  // Everything below is best-effort. Rule 1 is absolute: once the request is
  // accepted the answer is 204, whatever happens.
  try {
    const raw = await request.text()
    const payload = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
    const last = await prisma.device.findUnique({
      where: { code: screened.code },
      select: { fw: true, battMv: true, rssiDbm: true, upSec: true, reportedLocation: true, lastSeenAt: true },
    })
    await recordDeviceReport(screened.code, reportFromBody(payload), {
      partnerClaim: request.headers.get(PARTNER_HEADER),
      last,
      force: true,
    })
  } catch {
    // Deliberately swallowed — see rule 1.
  }

  return new Response(null, { status: 204 })
}
