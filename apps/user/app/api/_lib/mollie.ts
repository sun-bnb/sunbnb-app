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

/**
 * Retrieve the status of a Mollie payment by its ID.
 * Mollie statuses: open, canceled, pending, authorized, expired, failed, paid
 */
export async function getMolliePaymentStatus(paymentId: string): Promise<string> {
  const mollie = getMollieClient()
  const payment = await mollie.payments.get(paymentId)
  return payment.status
}

/**
 * Check if a paymentRef is a Mollie payment (Mollie IDs start with "tr_").
 */
export function isMolliePayment(paymentRef: string | null): boolean {
  return paymentRef?.startsWith('tr_') ?? false
}
