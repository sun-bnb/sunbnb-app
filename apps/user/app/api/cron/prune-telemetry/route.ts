/**
 * Cron: prune device telemetry history (track 019 P6).
 *
 * Deletes readings older than the `device-telemetry-retention-days` preference
 * (admin app → /preferences, default 365). Oldest first — the newest readings
 * are where every question starts.
 *
 * Daily, and daily is enough: the window is measured in days, so a sweep that
 * runs once a day over-retains by at most a day. It lives in the USER app
 * because that is where the telemetry is written (`/api/hw/{code}/state`), so
 * the writer and the reaper ship together and cannot drift apart.
 *
 * Protected by CRON_SECRET, like `/api/cron/send-reminders`.
 *
 * GET /api/cron/prune-telemetry
 */

import { NextResponse } from 'next/server'
import { pruneDeviceTelemetry } from '@repo/data/device-telemetry'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (!cronSecret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 503 })
  }
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await pruneDeviceTelemetry()
    // `complete: false` means the per-run ceiling stopped it, not that anything
    // failed — the remainder goes with tomorrow's run. Reported rather than
    // retried here, because a sweep that keeps going until it is done is
    // exactly the unbounded delete this is built to avoid.
    return NextResponse.json({
      deleted: result.deleted,
      complete: result.complete,
      retentionDays: result.retentionDays,
      cutoff: result.cutoff.toISOString(),
    })
  } catch (err) {
    console.error('[prune-telemetry] sweep failed', err)
    return NextResponse.json({ error: 'Prune failed' }, { status: 500 })
  }
}
