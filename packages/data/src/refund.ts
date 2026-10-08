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
import { providerFromRef, type PaymentProviderId } from './payment-refs'
import { refundReservationVivaPayment } from './reservation-payment'
import { stripeAdapter } from './payment-providers/stripe-adapter'
import { vivaAdapter } from './payment-providers/viva-adapter'
import { stripeAccountForPartner } from './payment-providers/stripe-account'

const MOLLIE_API_BASE = 'https://api.mollie.com/v2'


export type RefundOutcome =
  | { status: 'ok'; provider: PaymentProviderId }
  // `reason: 'permission'` marks a 403 (the partner's grant lacks refunds.write) —
  // the caller surfaces a re-consent ("Enable refunds") action rather than a retry.
  | { status: 'error'; error: string; reason?: 'permission' }

/**
 * Issue a full refund for a reservation's payment.
 *
 * @param paymentRef      The reservation's stored payment reference.
 * @param partnerAccountId PartnerAccount.userId whose Mollie account holds the payment.
 * @param ctx             `reservationId` is required only for a Viva card-present ref
 *                        (the Viva refund path loads the reservation itself).
 *
 * Returns `{ status: 'ok' }` on success (or for demo refs, where it is a no-op),
 * `{ status: 'error', error }` on any failure — never throws for an expected
 * failure path, so callers can surface the message without a try/catch.
 */
export async function issueReservationRefund(
  paymentRef: string | null | undefined,
  partnerAccountId: string | null | undefined,
  ctx?: { reservationId?: string },
): Promise<RefundOutcome> {
  if (!paymentRef) return { status: 'error', error: 'No payment to refund' }
  const provider = providerFromRef(paymentRef)
  switch (provider) {
    case 'demo':
      return { status: 'ok', provider: 'demo' }
    case 'mollie':
      return refundMolliePayment(paymentRef, partnerAccountId)
    case 'viva-terminal': {
      if (!ctx?.reservationId) {
        return { status: 'error', error: 'reservationId required for a Viva refund' }
      }
      const res = await refundReservationVivaPayment(ctx.reservationId)
      return res.status === 'ok'
        ? { status: 'ok', provider: 'viva-terminal' }
        : { status: 'error', error: res.error }
    }
    case 'stripe':
    case 'stripe-terminal':
      return refundStripePayment(paymentRef, partnerAccountId)
    case 'viva':
      return refundVivaCheckoutPayment(paymentRef, partnerAccountId)
    default:
      return { status: 'error', error: `Unknown payment provider for ref: ${paymentRef}` }
  }
}

/** Direct-charge refund on the venue's connected account; the application fee is refunded too. */
async function refundStripePayment(
  paymentRef: string,
  partnerAccountId: string | null | undefined,
): Promise<RefundOutcome> {
  if (!partnerAccountId) {
    return { status: 'error', error: 'Cannot find partner account for payment' }
  }
  const provider = providerFromRef(paymentRef) as PaymentProviderId
  try {
    const account = await stripeAccountForPartner(partnerAccountId)
    if (!account) return { status: 'error', error: 'Partner has not connected Stripe' }
    await stripeAdapter.refund(paymentRef, { partnerAccountId, stripeConnectAccountId: account })
    return { status: 'ok', provider }
  } catch (err) {
    console.error('[refund] Stripe refund failed', err)
    const e = err as { statusCode?: number; message?: string }
    if (e?.statusCode === 403) {
      return {
        status: 'error',
        error: 'Stripe refused the refund (permission) — check the venue\'s Stripe connection.',
        reason: 'permission',
      }
    }
    return { status: 'error', error: e?.message ? `Stripe refund failed: ${e.message}` : 'Stripe refund failed' }
  }
}

async function refundMolliePayment(
  paymentRef: string,
  partnerAccountId: string | null | undefined,
): Promise<RefundOutcome> {
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

/** Viva Smart Checkout full refund: the client reads the paid amount from the transaction (Viva reverses the ISV fee itself). */
async function refundVivaCheckoutPayment(
  paymentRef: string,
  partnerAccountId: string | null | undefined,
): Promise<RefundOutcome> {
  try {
    await vivaAdapter.refund(paymentRef, { partnerAccountId: partnerAccountId ?? '' })
    return { status: 'ok', provider: 'viva' }
  } catch (err) {
    console.error('[refund] Viva refund failed', err)
    return { status: 'error', error: err instanceof Error ? `Viva refund failed: ${err.message}` : 'Viva refund failed' }
  }
}
