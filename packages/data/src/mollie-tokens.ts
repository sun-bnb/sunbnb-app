/**
 * Centralized Mollie OAuth token manager (Mollie for Platforms).
 *
 * The single authority for keeping a partner's Mollie access token valid. Both
 * apps call `getValidMollieToken(partnerAccountId)` instead of refreshing on
 * their own — this is what ends the "refresh-token sprawl" where several
 * uncoordinated code paths each refreshed and rotated the token, invalidating
 * one another (Mollie rotates the refresh token on every refresh).
 *
 * Strategy:
 *  - **Proactive, expiry-based.** We persist `mollieTokenExpiresAt` and trust it,
 *    so the common path is a pure DB read with no Mollie round-trip (no per-call
 *    `profiles.page()` probe).
 *  - **Single-locked.** When a refresh is actually due, it runs inside a
 *    transaction holding a per-partner Postgres advisory lock, so concurrent
 *    requests — even across processes/instances — serialize: the first refreshes,
 *    the rest re-read the now-fresh token instead of spending the rotated one.
 *  - **Self-healing.** A genuinely rejected refresh token (`invalid_grant`)
 *    clears the stored tokens (so the partner UI shows "disconnected") and throws
 *    {@link MollieReconnectRequiredError}; transient failures keep the connection.
 */

import prisma from '../index'

const MOLLIE_TOKEN_URL = 'https://api.mollie.com/oauth2/tokens'

/** Refresh slightly before the real expiry to avoid using a token mid-flight. */
const EXPIRY_BUFFER_MS = 120_000

/**
 * Thrown when the partner genuinely needs to reconnect Mollie (no/dead refresh
 * token). The stored tokens are cleared before this is thrown.
 */
export class MollieReconnectRequiredError extends Error {
  constructor(message = 'Mollie account must be reconnected') {
    super(message)
    this.name = 'MollieReconnectRequiredError'
  }
}

/** Internal: a refresh token Mollie rejected — unrecoverable without reconnect. */
class MollieInvalidGrantError extends Error {}

/** Pure: is a token still fresh enough to use (with the safety buffer)? */
export function isMollieTokenFresh(
  expiresAt: Date | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!expiresAt) return false
  return now.getTime() < expiresAt.getTime() - EXPIRY_BUFFER_MS
}

/** Pure: compute the persisted expiry from Mollie's `expires_in` (seconds). */
export function mollieTokenExpiresAtFrom(
  expiresInSeconds: number | null | undefined,
): Date | null {
  if (!expiresInSeconds || expiresInSeconds <= 0) return null
  return new Date(Date.now() + expiresInSeconds * 1000)
}

interface RefreshResult {
  accessToken: string
  refreshToken: string
  expiresIn: number | null
}

/**
 * Exchange a refresh token for a fresh access + refresh pair. Mollie rotates the
 * refresh token, so the new one must be persisted. Distinguishes a dead token
 * (400 `invalid_grant`) from a transient failure.
 */
async function refreshMollieToken(refreshToken: string): Promise<RefreshResult> {
  const clientId = process.env.MOLLIE_CLIENT_ID
  const clientSecret = process.env.MOLLIE_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    throw new Error('MOLLIE_CLIENT_ID and MOLLIE_CLIENT_SECRET are required for token refresh')
  }

  const res = await fetch(MOLLIE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    console.error('[Mollie] Token refresh failed:', res.status, body)
    if (res.status === 400 && body.includes('invalid_grant')) {
      throw new MollieInvalidGrantError('invalid_grant')
    }
    throw new Error(`Mollie token refresh failed (${res.status})`)
  }

  const data = await res.json()
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: typeof data.expires_in === 'number' ? data.expires_in : null,
  }
}

/**
 * Refresh under a per-partner advisory lock so only one refresh runs at a time
 * across all processes. Re-reads inside the lock so a request that waited
 * returns the token a concurrent refresh just produced, instead of spending the
 * (now-rotated) refresh token a second time.
 */
async function refreshUnderLock(partnerAccountId: string): Promise<string> {
  // The dead-token clear must COMMIT, so it cannot be a `throw` inside the
  // transaction — Prisma rolls the callback's writes back on throw, which would
  // leave the partner stuck "connected" but unable to pay (every call loops on
  // "session expired"). Instead we signal a dead token by returning null, let the
  // transaction commit the clear, then throw the reconnect error outside it.
  const accessToken = await prisma.$transaction(
    async (tx): Promise<string | null> => {
      // Serialize refreshes for this partner (released at transaction end).
      // $executeRaw (not $queryRaw): pg_advisory_xact_lock returns `void`, which
      // the pg driver adapter can't deserialize as a result column ("Failed to
      // deserialize column of type 'void'"). $executeRaw returns an affected-row
      // count and never deserializes the result set, so it sidesteps that.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('mollie_token_refresh'), hashtext(${partnerAccountId}))`

      const acct = await tx.partnerAccount.findUnique({
        where: { userId: partnerAccountId },
        select: {
          mollieAccessToken: true,
          mollieRefreshToken: true,
          mollieTokenExpiresAt: true,
        },
      })
      if (!acct?.mollieAccessToken) {
        throw new MollieReconnectRequiredError('Mollie is not connected — reconnect required.')
      }
      // A concurrent holder may have already refreshed while we waited.
      if (isMollieTokenFresh(acct.mollieTokenExpiresAt)) {
        return acct.mollieAccessToken
      }
      if (!acct.mollieRefreshToken) {
        throw new MollieReconnectRequiredError(
          'Mollie access token expired and no refresh token is stored — reconnect required.',
        )
      }

      try {
        const tokens = await refreshMollieToken(acct.mollieRefreshToken)
        await tx.partnerAccount.update({
          where: { userId: partnerAccountId },
          data: {
            mollieAccessToken: tokens.accessToken,
            mollieRefreshToken: tokens.refreshToken,
            mollieTokenExpiresAt: mollieTokenExpiresAtFrom(tokens.expiresIn),
          },
        })
        console.log('[Mollie] Token refreshed (centralized)')
        return tokens.accessToken
      } catch (err) {
        if (!(err instanceof MollieInvalidGrantError)) throw err // transient — roll back, keep the connection
        // Genuinely dead — clear so the partner UI prompts a reconnect. Returning
        // null (not throwing) lets this clear commit; the throw happens below.
        await tx.partnerAccount.update({
          where: { userId: partnerAccountId },
          data: {
            mollieAccessToken: null,
            mollieRefreshToken: null,
            mollieTokenExpiresAt: null,
          },
        })
        return null
      }
    },
    { timeout: 20_000 },
  )

  if (accessToken === null) {
    throw new MollieReconnectRequiredError(
      'Mollie refresh token was rejected — the partner must reconnect their Mollie account.',
    )
  }
  return accessToken
}

/**
 * Get a valid Mollie access token for a partner, refreshing proactively (before
 * expiry) and under a per-partner lock. Throws {@link MollieReconnectRequiredError}
 * only when the partner genuinely needs to reconnect.
 *
 * @param partnerAccountId - PartnerAccount.userId (PK)
 */
export async function getValidMollieToken(partnerAccountId: string): Promise<string> {
  const acct = await prisma.partnerAccount.findUnique({
    where: { userId: partnerAccountId },
    select: { mollieAccessToken: true, mollieTokenExpiresAt: true },
  })
  if (!acct?.mollieAccessToken) {
    throw new MollieReconnectRequiredError('Mollie is not connected — reconnect required.')
  }
  // Fast path: trust the stored expiry — no Mollie round-trip, no refresh.
  if (isMollieTokenFresh(acct.mollieTokenExpiresAt)) {
    return acct.mollieAccessToken
  }
  return refreshUnderLock(partnerAccountId)
}
