/**
 * Pure helpers behind the partner app's GA4 instrumentation (the tag itself is
 * `@repo/ui/google-analytics`). Kept free of window/React so the "fire once" and
 * "new account vs returning login" rules are unit-testable.
 */

/** A user row created within this window of the sign-in is a brand-new account. */
export const NEW_ACCOUNT_WINDOW_MS = 2 * 60 * 1000

export interface GaAuthEvent {
  event: 'sign_up' | 'login'
  /** NextAuth provider id ('google', 'credentials', …) — never a user identifier. */
  method: string
  /** Sign-in timestamp (ms) — the per-sign-in idempotency stamp, not personal data. */
  at: number
}

/**
 * Decide whether a sign-in is a first-ever sign-in (GA4 `sign_up`) or a returning one
 * (`login`). `userCreatedAt` is the User row's createdAt: the row is created by the adapter
 * (OAuth) or `validateOrCreateUser` (credentials) moments before this runs, so a row younger
 * than the window means this very sign-in created the account. Returns null when we cannot tell
 * (no createdAt) — better to send nothing than a wrong sign_up.
 */
export function gaAuthEventFor(
  userCreatedAt: Date | string | null | undefined,
  provider: string | undefined,
  now: number = Date.now(),
): GaAuthEvent | null {
  if (!userCreatedAt || !provider) return null
  const created = new Date(userCreatedAt).getTime()
  if (Number.isNaN(created)) return null
  const isNew = now - created >= 0 && now - created < NEW_ACCOUNT_WINDOW_MS
  return { event: isNew ? 'sign_up' : 'login', method: provider, at: now }
}

/** Minimal Storage surface (localStorage in the browser, a stub in tests). */
export interface OnceStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

const ONCE_PREFIX = 'ga-once:'

export function hasFired(storage: OnceStorage, key: string): boolean {
  try {
    return storage.getItem(ONCE_PREFIX + key) !== null
  } catch {
    return false
  }
}

export function markFired(storage: OnceStorage, key: string): void {
  try {
    storage.setItem(ONCE_PREFIX + key, '1')
  } catch {
    /* private mode / quota — worst case an event may repeat */
  }
}

/** True when the key has not fired before (does not mark it). */
export function shouldFire(storage: OnceStorage, key: string): boolean {
  return !hasFired(storage, key)
}
