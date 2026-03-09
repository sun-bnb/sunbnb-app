/**
 * Simple in-memory sliding-window rate limiter.
 *
 * On Vercel serverless each cold start gets a fresh map, so this is
 * best-effort — it stops sustained brute-force within a single instance
 * lifetime.  For a stronger guarantee, swap to a Redis / Upstash backend.
 */

interface Entry {
  timestamps: number[]
}

const store = new Map<string, Entry>()

// Evict stale entries every 5 minutes to prevent memory growth
const CLEANUP_INTERVAL = 5 * 60 * 1000
let lastCleanup = Date.now()

function cleanup(windowMs: number) {
  const now = Date.now()
  if (now - lastCleanup < CLEANUP_INTERVAL) return
  lastCleanup = now
  for (const [key, entry] of store) {
    entry.timestamps = entry.timestamps.filter((t) => now - t < windowMs)
    if (entry.timestamps.length === 0) store.delete(key)
  }
}

/**
 * Check whether a request identified by `key` (e.g. IP or email) is
 * within the allowed rate.  Returns `{ allowed: true }` or
 * `{ allowed: false, retryAfterMs }`.
 */
export function rateLimit(
  key: string,
  { maxAttempts = 5, windowMs = 15 * 60 * 1000 }: { maxAttempts?: number; windowMs?: number } = {}
): { allowed: true } | { allowed: false; retryAfterMs: number } {
  cleanup(windowMs)

  const now = Date.now()
  let entry = store.get(key)

  if (!entry) {
    entry = { timestamps: [] }
    store.set(key, entry)
  }

  // Remove timestamps outside the window
  entry.timestamps = entry.timestamps.filter((t) => now - t < windowMs)

  if (entry.timestamps.length >= maxAttempts) {
    const oldest = entry.timestamps[0]!
    const retryAfterMs = windowMs - (now - oldest)
    return { allowed: false, retryAfterMs }
  }

  entry.timestamps.push(now)
  return { allowed: true }
}
