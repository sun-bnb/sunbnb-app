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
 * Refresh a Mollie OAuth access token using the refresh token.
 * Returns new access + refresh tokens.
 */
async function refreshAccessToken(refreshToken: string): Promise<{
  accessToken: string
  refreshToken: string
}> {
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
    throw new Error(`Mollie token refresh failed (${res.status})`)
  }

  const data = await res.json()
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
  }
}

/**
 * Get a valid Mollie access token for a partner, auto-refreshing if expired.
 *
 * Attempts to use the stored access token first. If Mollie returns 401,
 * refreshes the token using the stored refresh token, persists the new
 * tokens in the DB, and returns the fresh access token.
 *
 * @param partnerAccountId - The partner account's userId (PK)
 * @param currentAccessToken - The currently stored access token
 * @param currentRefreshToken - The currently stored refresh token
 * @returns A valid access token
 */
export async function getValidMollieToken(
  partnerAccountId: string,
  currentAccessToken: string,
  currentRefreshToken: string | null,
): Promise<string> {
  // Quick check: try the current token with a lightweight API call
  try {
    const testClient = createMollieClient({ accessToken: currentAccessToken })
    await testClient.profiles.page()
    return currentAccessToken
  } catch (err: any) {
    // If it's not a 401, the token is valid but something else is wrong — rethrow
    if (err?.statusCode !== 401) {
      throw err
    }
  }

  // Token expired — refresh it
  if (!currentRefreshToken) {
    throw new Error('Mollie access token expired and no refresh token available. Partner must reconnect.')
  }

  console.log('[Mollie] Access token expired, refreshing…')
  const tokens = await refreshAccessToken(currentRefreshToken)

  // Persist new tokens
  await prisma.partnerAccount.update({
    where: { userId: partnerAccountId },
    data: {
      mollieAccessToken: tokens.accessToken,
      mollieRefreshToken: tokens.refreshToken,
    },
  })

  console.log('[Mollie] Token refreshed successfully')
  return tokens.accessToken
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
