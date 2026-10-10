/**
 * One-shot "this sign-in created the account" signal for GA4 `sign_up`.
 *
 * Creation happens in two places: the OAuth branch of the NextAuth `signIn` callback, and the
 * credentials `authorize` (via `validateOrCreateUser`). For OAuth the user object the `jwt`
 * callback later receives is not the one `signIn` saw, so the signal is parked here, keyed by
 * email, and consumed (deleted) by the `jwt` callback of the SAME callback request. The entry
 * expires quickly so it can never leak into a later, unrelated sign-in.
 *
 * On the token it is stored as a timestamp (`newUserAt`) and only surfaces on the session while
 * fresh, so a long-lived JWT cannot re-announce signup. No ids or PII leave the server: the
 * session only gets a boolean.
 */
const PENDING_TTL_MS = 60_000
export const NEW_USER_SESSION_TTL_MS = 5 * 60_000

const pending = new Map<string, number>()

const key = (email: string) => email.trim().toLowerCase()

export function markNewUser(email: string, now = Date.now()) {
  pending.set(key(email), now)
}

/** Returns true at most once per `markNewUser`; expired marks are discarded. */
export function consumeNewUser(email: string | null | undefined, now = Date.now()): boolean {
  if (!email) return false
  const k = key(email)
  const at = pending.get(k)
  pending.delete(k)
  return at !== undefined && now - at <= PENDING_TTL_MS
}

/** Whether a token's `newUserAt` is recent enough to be reported on the session. */
export function isFreshNewUser(newUserAt: unknown, now = Date.now()): boolean {
  return typeof newUserAt === 'number' && now - newUserAt >= 0 && now - newUserAt <= NEW_USER_SESSION_TTL_MS
}

export function resetNewUserSignals() {
  pending.clear()
}
