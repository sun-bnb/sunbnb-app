/**
 * Shared fixed-window rate limiter (track 027, marketing bot protection) — SERVER-ONLY.
 *
 * `./rate-limit` keeps its counters in process memory, so on Vercel every cold start and every
 * parallel instance starts from zero: behind ad traffic that is no limit at all. This one counts
 * in the `rate_limit_counter` table with a single atomic upsert, so all instances share one
 * number per key per window.
 *
 * Fixed windows, not sliding: one row and one round trip per check, at the cost of allowing up to
 * twice the limit across a window boundary — fine for abuse and spend caps.
 *
 * Keys are hashed (`scope:subject` → SHA-256), so no raw IP or email address is stored; rows are
 * dead after their window and `pruneRateLimitCounters` deletes them.
 *
 * If the database is unreachable the check FAILS OPEN onto the in-memory limiter with the same
 * policy: the marketing page must keep working, and a per-instance limit is still a limit.
 */
import { createHash } from 'node:crypto'
import prisma from '../index'
import { rateLimit } from './rate-limit'

export interface SharedLimit {
  maxAttempts: number
  windowMs: number
}

export interface SharedLimitResult {
  allowed: boolean
  /** Attempts in this window, this one included (0 when the database was unreachable). */
  count: number
}

/** Start of the fixed window `now` falls in. Pure; exported for tests. */
export function windowStart(nowMs: number, windowMs: number): number {
  return Math.floor(nowMs / windowMs) * windowMs
}

/** The stored row key for a limiter key in a window. Pure; exported for tests. */
export function counterKey(key: string, startMs: number): string {
  return `${createHash('sha256').update(key).digest('hex')}:${startMs}`
}

/** Count one attempt against `key` and say whether it is within `limit`. */
export async function rateLimitShared(key: string, limit: SharedLimit, now = new Date()): Promise<SharedLimitResult> {
  const start = windowStart(now.getTime(), limit.windowMs)
  try {
    const rows = await prisma.$queryRaw<{ count: number }[]>`
      INSERT INTO rate_limit_counter (key, count, expires_at)
      VALUES (${counterKey(key, start)}, 1, ${new Date(start + limit.windowMs)})
      ON CONFLICT (key) DO UPDATE SET count = rate_limit_counter.count + 1
      RETURNING count`
    const count = Number(rows[0]?.count ?? 1)
    return { allowed: count <= limit.maxAttempts, count }
  } catch (err) {
    console.error('[rate-limit-shared] counter unavailable, using the in-memory limiter', err)
    return { allowed: rateLimit(key, limit).allowed, count: 0 }
  }
}

/** Delete counters whose window has ended. */
export async function pruneRateLimitCounters(now = new Date()): Promise<number> {
  const { count } = await prisma.rateLimitCounter.deleteMany({ where: { expiresAt: { lt: now } } })
  return count
}
