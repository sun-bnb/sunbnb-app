/**
 * Device telemetry history — retention sweep (track 019 P6).
 *
 * `Device`'s telemetry columns are a LAST VALUE: they answer "how is this unit
 * now", which is what a fleet list needs. Almost every question actually worth
 * asking of telemetry is a TREND — is this unit energy-positive, what does a
 * power mode cost on real hardware, is the cell ageing, is one unit faulty
 * against the fleet — and a trend cannot be backfilled. `device_telemetry` is
 * that series; this module is the only thing that bounds it.
 *
 * ## The volume arithmetic, because it is the whole design
 *
 * A row is appended per RECORDED report, not per poll. The device reports on
 * every poll and the server throttles the write (`reportIsDue`), so the series
 * is exactly the sequence of readings the server kept:
 *
 *   worst case per device = the 5-minute `lastSeenAt` floor  = 288 rows/day
 *   plus one row per notable change (mode, disc, brownout, a threshold crossed)
 *
 * At today's handful of devices that is nothing. At the planned 1 500-unit fleet
 * it is ~4.3 x 10^5 rows/day, and the default 365-day retention holds ~1.6 x
 * 10^8 rows. **That is the number to look at before raising the default**, and
 * the two levers are this retention window and the write floor in
 * `reportIsDue` (a coarser floor for the history than for the last-value row
 * would decouple them, and is the obvious next move if the fleet grows before
 * anything reads the series).
 *
 * Recording every poll was never affordable — that is why the throttle exists
 * at all (track 019 Q3: ~1.3 M polls/day) — so "keep every reading" means every
 * reading the server keeps.
 *
 * ## Why a chunked delete rather than one `deleteMany`
 *
 * The sweep runs in a serverless invocation with a wall-clock limit, against a
 * table that can be very large the first time anyone shortens the window. One
 * unbounded `DELETE` would hold a long transaction, bloat WAL and risk timing
 * out halfway — and a timeout mid-delete is the worst outcome, because the next
 * run starts from scratch. Deleting in bounded chunks makes the sweep
 * RESUMABLE: whatever it finished is committed, and the next run continues from
 * there. It is idempotent by construction — deleting rows past a cutoff twice
 * deletes nothing the second time.
 */

import prisma from '../index'
import { getPreference } from './preferences'

/** Rows per statement. Small enough to commit quickly, large enough to be cheap. */
export const PRUNE_CHUNK_ROWS = 5_000

/**
 * Most rows one invocation will remove. A ceiling, not a target: it exists so a
 * first sweep after someone cuts retention from a year to a week cannot run for
 * minutes. The remainder is taken by the next daily run, and the day's worth of
 * over-retained rows that leaves is not a problem anyone can observe.
 */
export const PRUNE_MAX_ROWS = 250_000

export interface PruneResult {
  /** Rows deleted this run. */
  deleted: number
  /** Everything past the cutoff is gone — false when the ceiling stopped it. */
  complete: boolean
  /** The age boundary used, so a caller can log what it actually enforced. */
  cutoff: Date
  retentionDays: number
}

/**
 * Delete telemetry readings older than the configured retention window.
 *
 * Oldest-first, which is the only eviction order that makes sense for a series:
 * the newest readings are the ones every question starts from.
 */
export async function pruneDeviceTelemetry(now = new Date()): Promise<PruneResult> {
  const retentionDays = await getPreference('device-telemetry-retention-days')
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000)

  let deleted = 0
  let complete = true

  for (;;) {
    if (deleted >= PRUNE_MAX_ROWS) {
      complete = false
      break
    }
    // `id` is the BIGSERIAL, so ordering by it is insertion order — the same
    // order as `recorded_at` for all practical purposes and far cheaper to walk.
    // The subquery keeps the row set bounded; the outer delete does the work.
    const removed = await prisma.$executeRaw`
      DELETE FROM device_telemetry
      WHERE id IN (
        SELECT id FROM device_telemetry
        WHERE recorded_at < ${cutoff}
        ORDER BY id
        LIMIT ${PRUNE_CHUNK_ROWS}
      )
    `
    deleted += removed
    if (removed < PRUNE_CHUNK_ROWS) break
  }

  return { deleted, complete, cutoff, retentionDays }
}
