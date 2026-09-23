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
 * **A row per POLL that carries a report — unthrottled** (founder call,
 * 2026-09-23: full fidelity matters more than volume while the fleet is being
 * brought up, and a throttled series answers "what did the cell do between
 * 10:33 and 10:38" with a shrug). `reportIsDue` still throttles the `Device`
 * last-value row, which costs nothing now that the history is complete: that row
 * is a cache of the latest reading, this table is the record.
 *
 * So the POLL INTERVAL sets the row rate, which makes the cadence preference a
 * storage lever as much as a battery one:
 *
 *   one device at 60 s (the fleet default) = 1 440 rows/day
 *   one device at 15 s (the ladder's retry) = 5 760 rows/day
 *
 * One unit under bring-up is trivial. **A 1 500-unit fleet at 60 s is ~2.2 x
 * 10^6 rows per DAY** — roughly 8 x 10^8 rows and comfortably past 100 GB at the
 * default 365-day retention. Three levers exist when that day comes, in order of
 * bluntness: shorten retention (this preference), lengthen the poll interval, or
 * reintroduce a sampling floor for the series alone. The first is one field in
 * the admin app; do not let the table get there by accident.
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
