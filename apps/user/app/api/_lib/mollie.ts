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

// ── Token validity & refresh (centralized in @repo/data) ─────────────────────

// Token freshness + rotation-safe, single-locked, expiry-based refresh is owned
// by @repo/data/mollie-tokens so the user and partner apps share ONE refresh
// authority (no refresh-token rotation drift between uncoordinated paths).
// getValidMollieToken reads the partner's tokens + expiry from the DB itself, so
// callers pass only the partner account id.
export { getValidMollieToken, MollieReconnectRequiredError } from '@repo/data/mollie-tokens'
import { getValidMollieToken } from '@repo/data/mollie-tokens'

// ── Partner Token Lookup ────────────────────────────────────────────────────

/**
 * Find the partner account id that owns a given paymentRef. Checks reservations,
 * orders, rental bookings, and table-reservation deposits (the latter is owned
 * via restaurant → partnerAccount, not site → user).
 */
export async function findPartnerAccountForPayment(paymentRef: string): Promise<string | null> {
  const reservation = await prisma.reservation.findFirst({
    where: { paymentRef },
    select: { site: { select: { user: { select: { partnerAccount: { select: { userId: true } } } } } } },
  })
  const rId = reservation?.site?.user?.partnerAccount?.userId
  if (rId) return rId

  const order = await prisma.order.findFirst({
    where: { paymentRef },
    select: { site: { select: { user: { select: { partnerAccount: { select: { userId: true } } } } } } },
  })
  const oId = order?.site?.user?.partnerAccount?.userId
  if (oId) return oId

  const rentalBooking = await prisma.rentalBooking.findFirst({
    where: { paymentRef },
    select: { site: { select: { user: { select: { partnerAccount: { select: { userId: true } } } } } } },
  })
  const rbId = rentalBooking?.site?.user?.partnerAccount?.userId
  if (rbId) return rbId

  // Table-reservation deposits: partner is reached via restaurant → partnerAccount.
  const tableReservation = await prisma.tableReservation.findFirst({
    where: { paymentRef },
    select: { restaurant: { select: { partnerAccount: { select: { userId: true } } } } },
  })
  const trId = tableReservation?.restaurant?.partnerAccount?.userId
  if (trId) return trId

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
  const partnerAccountId = await findPartnerAccountForPayment(paymentId)
  if (!partnerAccountId) {
    throw new Error(`Cannot find partner account for Mollie payment: ${paymentId}`)
  }

  const validToken = await getValidMollieToken(partnerAccountId)
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
  const partnerAccountId = await findPartnerAccountForPayment(paymentRef)
  if (!partnerAccountId) {
    throw new Error(`Cannot find partner account for Mollie payment: ${paymentRef}`)
  }

  const validToken = await getValidMollieToken(partnerAccountId)
  const client = getMollieClientForPartner(validToken)
  const payment = await client.payments.get(paymentRef, { testmode: isTestMode() } as any)
  return { client, payment }
}
