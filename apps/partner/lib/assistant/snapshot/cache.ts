/**
 * The snapshot LRU (track 030 G1), kept free of any PGlite import so the proposal lifecycle can
 * invalidate a site without pulling the WASM database into the apply/undo server-action bundle.
 *
 * Per server instance (module state): on Vercel each warm function instance has its own cache, so
 * invalidation reaches only the instance that applied the proposal — the snapshot fingerprint
 * check in `load.ts` (counts + newest updatedAt) and the TTL cover the others.
 */

export const MAX_ENTRIES = 2
export const TTL_MS = 10 * 60 * 1000

export interface CacheEntry<T extends { close(): Promise<void> }> {
  promise: Promise<{ db: T }>
  expiresAt: number
}

// Map iteration order = recency (re-inserted on every hit).
const cache = new Map<string, CacheEntry<{ close(): Promise<void> }>>()

function dispose(entry: CacheEntry<{ close(): Promise<void> }>) {
  entry.promise.then((s) => s.db.close()).catch(() => {})
}

export function cacheGet(siteId: string) {
  return cache.get(siteId)
}

export function cacheTouch(siteId: string) {
  const hit = cache.get(siteId)
  if (!hit) return
  cache.delete(siteId)
  cache.set(siteId, hit)
}

/** Insert (closing any previous entry for the site) and evict the least recently used past `MAX_ENTRIES`. */
export function cacheSet(siteId: string, entry: CacheEntry<{ close(): Promise<void> }>) {
  const prev = cache.get(siteId)
  if (prev && prev !== entry) dispose(prev)
  cache.delete(siteId)
  cache.set(siteId, entry)
  entry.promise.catch(() => {
    if (cache.get(siteId) === entry) cache.delete(siteId)
  })
  while (cache.size > MAX_ENTRIES) {
    const [oldestKey, oldest] = cache.entries().next().value!
    cache.delete(oldestKey)
    dispose(oldest)
  }
}

/** Drop (and close) a site's snapshot — called after any proposal for that site is applied or undone. */
export function invalidateSnapshot(siteId: string): void {
  const entry = cache.get(siteId)
  if (!entry) return
  cache.delete(siteId)
  dispose(entry)
}

export function cachedSiteIds(): string[] {
  return [...cache.keys()]
}

/** Test hook: drop and close every cached snapshot. */
export async function resetSnapshotCache(): Promise<void> {
  const entries = [...cache.values()]
  cache.clear()
  await Promise.all(entries.map((e) => e.promise.then((s) => s.db.close()).catch(() => {})))
}
