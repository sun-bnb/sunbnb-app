/**
 * Cron: Reap stale deposit holds
 *
 * Deletes PENDING_PAYMENT table reservations whose deposit was never collected
 * (older than 20 min), so abandoned checkouts stop blocking the slot. Mirrors the
 * partner reservations-cleanup. Protected by CRON_SECRET; gated by the
 * `restaurants` flag.
 *
 * GET /api/cron/table-deposit-cleanup
 */

import { NextResponse } from 'next/server'
import { cleanupStalePendingDeposits } from '@repo/table-reservations-core'
import { isFlagEnabled } from '@/app/flags'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 503 })
  }
  if (request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!(await isFlagEnabled('restaurants'))) {
    return NextResponse.json({ ok: true, removed: 0, skipped: 'flag_off' })
  }
  const { removed } = await cleanupStalePendingDeposits(20)
  return NextResponse.json({ ok: true, removed })
}
