/**
 * Shared Mollie Utilities for API Routes
 *
 * Centralizes Mollie client creation, payment status retrieval,
 * and common helper functions used across payment-related routes.
 *
 * Mollie for Platforms (OAuth / Mollie Connect) flow:
 * 1. Partner onboards via Mollie Connect → we store their accessToken
 * 2. Server creates a payment on the partner's account (using their accessToken)
 *    with an applicationFee routed to our platform organization
 * 3. Mollie sends a webhook with the payment ID (server fetches status)
 * 4. Customer is redirected back to our redirectUrl
 *
 * The partner is the Merchant of Record. We never hold their funds —
 * Mollie splits the applicationFee to us automatically.
 */

import createMollieClient from '@mollie/api-client'
import prisma from '@repo/data/PrismaCient'
import { isTestMode } from '@repo/data/env'

/**
 * Create a Mollie client using the platform's own API key.
 * Used for non-payment operations (e.g. reading payment statuses).
 */
export function getMollieClient() {
  const { MOLLIE_API_KEY } = process.env
  if (!MOLLIE_API_KEY) {
    throw new Error('MOLLIE_API_KEY is not set')
  }
  return createMollieClient({ apiKey: MOLLIE_API_KEY })
}

/**
 * Create a Mollie client using a partner's OAuth access token.
 * Payments created with this client belong to the partner's Mollie account,
 * making them the Merchant of Record.
 */
export function getMollieClientForPartner(accessToken: string) {
  if (!accessToken) {
    throw new Error('Partner Mollie access token is required')
  }
  return createMollieClient({ accessToken })
}

// ── Token Refresh ───────────────────────────────────────────────────────────

const MOLLIE_TOKEN_URL = 'https://api.mollie.com/oauth2/tokens'

/**
 * Thrown when Mollie rejects the refresh token (`invalid_grant`). This is
 * unrecoverable without a fresh OAuth connect — the partner must reconnect.
 * The stored tokens are cleared before this is thrown so the partner UI shows
 * "disconnected" and prompts a reconnect.
 */
export class MollieReconnectRequiredError extends Error {
  constructor(message = 'Mollie account must be reconnected') {
    super(message)
    this.name = 'MollieReconnectRequiredError'
  }
}

/** Internal: distinguishes a dead refresh token from a transient failure. */
class MollieInvalidGrantError extends Error {}

interface RefreshedTokens {
  accessToken: string
  refreshToken: string
}

/**
 * Exchange a refresh token for a new access + refresh pair. Mollie ROTATES the
 * refresh token on every call (the old one is then invalid). Throws
 * {@link MollieInvalidGrantError} on a rejected token (400 invalid_grant) and a
 * generic Error on any other (transient) failure, so the caller can react
 * differently — only the former warrants disconnecting the partner.
 */
async function refreshAccessToken(refreshToken: string): Promise<RefreshedTokens> {
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
  return { accessToken: data.access_token, refreshToken: data.refresh_token }
}

async function persistTokens(partnerAccountId: string, tokens: RefreshedTokens): Promise<void> {
  await prisma.partnerAccount.update({
    where: { userId: partnerAccountId },
    data: { mollieAccessToken: tokens.accessToken, mollieRefreshToken: tokens.refreshToken },
  })
}

// Per-partner in-flight refresh promise. Concurrent requests in this process
// share one refresh so they don't each spend the same (rotating) refresh token
// and invalidate one another.
const inflightRefresh = new Map<string, Promise<string>>()

/**
 * Refresh a partner's Mollie token, deduped per partner and robust to the
 * stored refresh token being rotated out-of-sync by another request/process: on
 * `invalid_grant` it re-reads the latest stored refresh token and retries once.
 * Only clears the stored tokens (forcing a reconnect) when the token is
 * genuinely dead — transient failures keep the connection intact.
 */
function refreshPartnerToken(partnerAccountId: string, refreshToken: string): Promise<string> {
  const existing = inflightRefresh.get(partnerAccountId)
  if (existing) return existing

  const run = (async (): Promise<string> => {
    try {
      const tokens = await refreshAccessToken(refreshToken)
      await persistTokens(partnerAccountId, tokens)
      console.log('[Mollie] Token refreshed successfully')
      return tokens.accessToken
    } catch (err) {
      if (!(err instanceof MollieInvalidGrantError)) throw err // transient — keep connection

      // Another request/process may have just rotated the token — retry with the latest.
      const latest = await prisma.partnerAccount.findUnique({
        where: { userId: partnerAccountId },
        select: { mollieRefreshToken: true },
      })
      if (latest?.mollieRefreshToken && latest.mollieRefreshToken !== refreshToken) {
        try {
          const tokens = await refreshAccessToken(latest.mollieRefreshToken)
          await persistTokens(partnerAccountId, tokens)
          console.log('[Mollie] Token refreshed via latest stored token')
          return tokens.accessToken
        } catch (retryErr) {
          if (!(retryErr instanceof MollieInvalidGrantError)) throw retryErr
        }
      }

      // Genuinely dead — clear so the partner UI prompts a reconnect.
      await prisma.partnerAccount.update({
        where: { userId: partnerAccountId },
        data: { mollieAccessToken: null, mollieRefreshToken: null },
      })
      throw new MollieReconnectRequiredError(
        'Mollie refresh token was rejected — the partner must reconnect their Mollie account.',
      )
    }
  })()

  inflightRefresh.set(partnerAccountId, run)
  return run.finally(() => inflightRefresh.delete(partnerAccountId))
}

/**
 * Get a valid Mollie access token for a partner. Probes the stored access
 * token; if it's expired, refreshes (deduped + rotation-safe via
 * {@link refreshPartnerToken}). Throws {@link MollieReconnectRequiredError} only
 * when the partner genuinely needs to reconnect (no/dead refresh token).
 *
 * @param partnerAccountId - The partner account's userId (PK), for persistence
 * @param currentAccessToken - The currently stored access token
 * @param currentRefreshToken - The currently stored refresh token
 */
export async function getValidMollieToken(
  partnerAccountId: string,
  currentAccessToken: string,
  currentRefreshToken: string | null,
): Promise<string> {
  // Probe: is the stored access token still valid?
  try {
    await createMollieClient({ accessToken: currentAccessToken }).profiles.page()
    return currentAccessToken
  } catch {
    // Probe failed (expired / scope / transient) — fall through to refresh.
  }

  if (!currentRefreshToken) {
    throw new MollieReconnectRequiredError(
      'Mollie access token expired and no refresh token is stored — reconnect required.',
    )
  }

  console.log('[Mollie] Access token probe failed, refreshing…')
  return refreshPartnerToken(partnerAccountId, currentRefreshToken)
}

// ── Partner Token Lookup ────────────────────────────────────────────────────

/**
 * Find the partner's Mollie access token for a given paymentRef.
 * Checks both reservations and orders since either could hold the ref.
 */
async function findPartnerTokenForPayment(paymentRef: string): Promise<{
  accessToken: string
  refreshToken: string | null
  partnerAccountId: string
} | null> {
  // Check reservations first
  const reservation = await prisma.reservation.findFirst({
    where: { paymentRef },
    select: {
      site: {
        select: {
          user: {
            select: {
              partnerAccount: {
                select: {
                  userId: true,
                  mollieAccessToken: true,
                  mollieRefreshToken: true,
                },
              },
            },
          },
        },
      },
    },
  })
  const rPA = reservation?.site?.user?.partnerAccount
  if (rPA?.mollieAccessToken) {
    return {
      accessToken: rPA.mollieAccessToken,
      refreshToken: rPA.mollieRefreshToken,
      partnerAccountId: rPA.userId,
    }
  }

  // Check orders
  const order = await prisma.order.findFirst({
    where: { paymentRef },
    select: {
      site: {
        select: {
          user: {
            select: {
              partnerAccount: {
                select: {
                  userId: true,
                  mollieAccessToken: true,
                  mollieRefreshToken: true,
                },
              },
            },
          },
        },
      },
    },
  })
  const oPA = order?.site?.user?.partnerAccount
  if (oPA?.mollieAccessToken) {
    return {
      accessToken: oPA.mollieAccessToken,
      refreshToken: oPA.mollieRefreshToken,
      partnerAccountId: oPA.userId,
    }
  }

  // Check rental bookings
  const rentalBooking = await prisma.rentalBooking.findFirst({
    where: { paymentRef },
    select: {
      site: {
        select: {
          user: {
            select: {
              partnerAccount: {
                select: {
                  userId: true,
                  mollieAccessToken: true,
                  mollieRefreshToken: true,
                },
              },
            },
          },
        },
      },
    },
  })
  const rbPA = rentalBooking?.site?.user?.partnerAccount
  if (rbPA?.mollieAccessToken) {
    return {
      accessToken: rbPA.mollieAccessToken,
      refreshToken: rbPA.mollieRefreshToken,
      partnerAccountId: rbPA.userId,
    }
  }

  return null
}

/**
 * Retrieve the status of a Mollie payment by its ID.
 *
 * Because payments are created on the partner's Mollie account (via OAuth),
 * we must use the partner's access token to read them.
 * The `testmode` param is only valid with OAuth access tokens.
 *
 * Mollie statuses: open, canceled, pending, authorized, expired, failed, paid
 */
export async function getMolliePaymentStatus(paymentId: string): Promise<string> {
  const partnerInfo = await findPartnerTokenForPayment(paymentId)
  if (!partnerInfo) {
    throw new Error(`Cannot find partner access token for Mollie payment: ${paymentId}`)
  }

  // Ensure the token is valid (auto-refresh if expired)
  const validToken = await getValidMollieToken(
    partnerInfo.partnerAccountId,
    partnerInfo.accessToken,
    partnerInfo.refreshToken,
  )

  const mollie = getMollieClientForPartner(validToken)
  const payment = await mollie.payments.get(paymentId, { testmode: isTestMode() } as any)
  return payment.status
}

/**
 * Check if a paymentRef is a Mollie payment (Mollie IDs start with "tr_").
 */
export function isMolliePayment(paymentRef: string | null): boolean {
  return paymentRef?.startsWith('tr_') ?? false
}

/**
 * Fetch a Mollie payment using the partner's OAuth token — for refunds.
 * Returns both the Mollie client and the payment object so the caller
 * can issue the refund on the same client instance.
 */
export async function getMolliePaymentForRefund(paymentRef: string) {
  const partnerInfo = await findPartnerTokenForPayment(paymentRef)
  if (!partnerInfo) {
    throw new Error(`Cannot find partner access token for Mollie payment: ${paymentRef}`)
  }

  const validToken = await getValidMollieToken(
    partnerInfo.partnerAccountId,
    partnerInfo.accessToken,
    partnerInfo.refreshToken,
  )

  const client = getMollieClientForPartner(validToken)
  const payment = await client.payments.get(paymentRef, { testmode: isTestMode() } as any)
  return { client, payment }
}
