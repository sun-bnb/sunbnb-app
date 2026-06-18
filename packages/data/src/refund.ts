/**
 * Provider-agnostic reservation refund (Mollie + demo).
 *
 * Shared so any app can issue a refund through the partner's Mollie account.
 * `fetch`-based (no `@mollie/api-client` dependency in `@repo/data`) — mirrors
 * the OAuth flow in `mollie-tokens.ts`, reusing its `getValidMollieToken` as the
 * single token-refresh authority.
 *
 * The caller supplies `partnerAccountId` (PartnerAccount.userId) directly rather
 * than reverse-looking-up the payment → partner. The partner manage flow already
 * knows whose payment it is (it's their own site), so this avoids duplicating the
 * `findPartnerAccountForPayment` lookup that lives in the user app's payment path.
 *
 * Idempotency is the caller's responsibility (e.g. the partner action guards on
 * `Reservation.refundedAt`). This function performs no DB writes.
 */

import { getValidMollieToken } from './mollie-tokens'
import { isTestMode } from './env'

const MOLLIE_API_BASE = 'https://api.mollie.com/v2'

/** Demo payment refs (`pi_demo_…`) have no real provider — refunding is a no-op. */
function isDemoPaymentRef(ref: string): boolean {
  return ref.startsWith('pi_demo_')
}

/** Mollie payment IDs start with `tr_`. */
function isMolliePaymentRef(ref: string): boolean {
  return ref.startsWith('tr_')
}

export type RefundOutcome =
  | { status: 'ok'; provider: 'mollie' | 'demo' }
  // `reason: 'permission'` marks a 403 (the partner's grant lacks refunds.write) —
  // the caller surfaces a re-consent ("Enable refunds") action rather than a retry.
  | { status: 'error'; error: string; reason?: 'permission' }

/**
 * Issue a full refund for a reservation's payment.
 *
 * @param paymentRef      The reservation's stored payment reference.
 * @param partnerAccountId PartnerAccount.userId whose Mollie account holds the payment.
 *
 * Returns `{ status: 'ok' }` on success (or for demo refs, where it is a no-op),
 * `{ status: 'error', error }` on any failure — never throws for an expected
 * failure path, so callers can surface the message without a try/catch.
 */
export async function issueReservationRefund(
  paymentRef: string | null | undefined,
  partnerAccountId: string | null | undefined,
): Promise<RefundOutcome> {
  if (!paymentRef) return { status: 'error', error: 'No payment to refund' }
  if (isDemoPaymentRef(paymentRef)) return { status: 'ok', provider: 'demo' }
  if (!isMolliePaymentRef(paymentRef)) {
    return { status: 'error', error: `Unknown payment provider for ref: ${paymentRef}` }
  }
  if (!partnerAccountId) {
    return { status: 'error', error: 'Cannot find partner account for payment' }
  }

  const testmode = isTestMode()
  const qs = testmode ? '?testmode=true' : ''

  let token: string
  try {
    token = await getValidMollieToken(partnerAccountId)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Mollie token unavailable'
    return { status: 'error', error: msg }
  }

  // 1. Look up the payment to get its (refundable) amount. Mollie requires an
  //    explicit amount on the refund; for a full refund we echo payment.amount.
  const payRes = await fetch(
    `${MOLLIE_API_BASE}/payments/${encodeURIComponent(paymentRef)}${qs}`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  if (!payRes.ok) {
    return { status: 'error', error: `Mollie payment lookup failed (${payRes.status})` }
  }
  const payment = await payRes.json()
  const amount = payment?.amount
  if (!amount?.value || !amount?.currency) {
    return { status: 'error', error: 'Payment has no refundable amount' }
  }

  // 2. Create the refund on the partner's account.
  const refundRes = await fetch(
    `${MOLLIE_API_BASE}/payments/${encodeURIComponent(paymentRef)}/refunds`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount, ...(testmode ? { testmode: true } : {}) }),
    },
  )
  if (!refundRes.ok) {
    const body = await refundRes.text().catch(() => '')
    console.error('[refund] Mollie refund failed', refundRes.status, body)
    // 403 = the partner's OAuth grant lacks `refunds.write`. This happens for
    // accounts connected before that scope was added — actionable: reconnect.
    if (refundRes.status === 403) {
      return {
        status: 'error',
        error: 'Refunds are not enabled on this Mollie connection — reconnect Mollie to grant refund permission.',
        reason: 'permission',
      }
    }
    return { status: 'error', error: `Mollie refund failed (${refundRes.status})` }
  }

  return { status: 'ok', provider: 'mollie' }
}
