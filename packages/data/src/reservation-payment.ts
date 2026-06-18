/**
 * Shared Mollie payment creation + status for reservations.
 *
 * Extracted from the user app's `POST /api/payment/mollie/create-payment` route
 * so BOTH the consumer online flow AND the partner manage page (QR walk-in
 * collection) create payments through one code path. `fetch`-based — no
 * `@mollie/api-client` dependency in `@repo/data` — mirroring `refund.ts`, and
 * reusing `getValidMollieToken` as the single token-refresh authority.
 *
 * The payment is created on the PARTNER's Mollie account (OAuth token), making
 * the partner the Merchant of Record; our platform commission rides along as an
 * `applicationFee` Mollie routes to us. See `.claude/rules/payments.md`.
 *
 * These functions DO write the reservation's `paymentRef`/`status` (the side
 * effect callers depend on), but contain no HTTP/auth/ownership concerns — the
 * caller (route or server action) owns those.
 */

import prisma from '../index'
import {
  loadFeeContext,
  resolveServiceFee,
  calculateServiceFeeAmount,
  round,
  processConfirmedReservation,
} from './payment'
import { getValidMollieToken } from './mollie-tokens'
import { isTestMode } from './env'
import {
  RESERVATION_PROCESSING,
  RESERVATION_PAYMENT_FAILED,
} from './reservation-status'

const MOLLIE_API_BASE = 'https://api.mollie.com/v2'
const SERVICE_CODE = 'sunbed-rental'

/** Mollie payment IDs start with `tr_`; demo refs with `pi_demo_`. */
function isMolliePaymentRef(ref: string): boolean {
  return ref.startsWith('tr_')
}
function isDemoPaymentRef(ref: string): boolean {
  return ref.startsWith('pi_demo_')
}

export interface CreatePaymentOptions {
  /** Where Mollie returns the payer after checkout (origin-validated by the caller). */
  redirectUrl: string
  /** Absolute URL of the `/api/webhooks/mollie` endpoint that will process the result. */
  webhookUrl: string
  /**
   * Extra metadata merged into the Mollie payment metadata alongside the base
   * `{ type:'reservation', entityId, siteId }`. The partner collect flow passes
   * `{ collect: true }` so the webhook reverts a failed payment to paid-in-cash
   * instead of marking the whole walk-in payment_failed.
   */
  metadataExtra?: Record<string, unknown>
}

/**
 * `reason` lets the HTTP caller map a failure to its existing status code so the
 * consumer route's behavior is byte-for-byte preserved after the extraction.
 */
export type CreatePaymentResult =
  | { status: 'ok'; checkoutUrl: string; paymentId: string }
  | {
      status: 'error'
      error: string
      reason:
        | 'invalid_amount'
        | 'no_mollie'
        | 'token'
        | 'no_profile'
        | 'provider_422'
        | 'provider_error'
        | 'no_checkout'
    }

/**
 * Create a Mollie payment for an existing reservation whose `paymentAmount` is
 * already set in the DB. On success stores `paymentRef` + `status: processing`;
 * on a provider error stores `status: payment_failed` (canonical terminal state,
 * GC'd by the cleanup cron) and returns the failure. Never throws for an
 * expected failure path.
 */
export async function createReservationMolliePayment(
  reservationId: string,
  opts: CreatePaymentOptions,
): Promise<CreatePaymentResult> {
  const reservation = await prisma.reservation.findUnique({
    where: { id: reservationId },
  })
  if (!reservation) {
    return { status: 'error', error: 'Reservation not found', reason: 'invalid_amount' }
  }

  // Amount comes from the DB — never a client-supplied value (payments.md).
  const paymentAmount = reservation.paymentAmount ?? 0
  if (paymentAmount <= 0) {
    return { status: 'error', error: 'Invalid payment amount', reason: 'invalid_amount' }
  }

  const { site, partnerAccount, settings } = await loadFeeContext(
    reservation.siteId,
    SERVICE_CODE,
  )
  if (!partnerAccount?.mollieAccessToken) {
    return {
      status: 'error',
      error: 'Partner has not connected their Mollie account',
      reason: 'no_mollie',
    }
  }

  let token: string
  try {
    token = await getValidMollieToken(partnerAccount.userId)
  } catch (err) {
    console.error('[reservation-payment] token refresh failed:', err)
    return {
      status: 'error',
      error:
        'Partner Mollie session has expired. Please ask the merchant to reconnect their Mollie account.',
      reason: 'token',
    }
  }

  // Platform commission via the three-tier cascade (site → account → settings).
  const tier = partnerAccount.subscription?.plan?.tier ?? null
  const matchedFee = resolveServiceFee(
    site.serviceFees,
    partnerAccount.serviceFees,
    settings?.serviceFees ?? [],
    SERVICE_CODE,
    tier,
  )
  const applicationFeeAmount = round(calculateServiceFeeAmount(matchedFee, paymentAmount))

  const testmode = isTestMode()

  // Resolve the website profile (required when creating with an OAuth token).
  let profileId = partnerAccount.mollieProfileId
  if (!profileId) {
    const profRes = await fetch(
      `${MOLLIE_API_BASE}/profiles${testmode ? '?testmode=true' : ''}`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
    if (!profRes.ok) {
      console.error('[reservation-payment] profiles fetch failed', profRes.status)
      return { status: 'error', error: 'Failed to retrieve merchant website profiles', reason: 'provider_error' }
    }
    const profJson = await profRes.json()
    const profiles: any[] = profJson?._embedded?.profiles ?? []
    const active = profiles.find((p) => p.status === 'verified' || p.status === 'unverified')
    if (!active) {
      return {
        status: 'error',
        error: 'Merchant has no active website profile. Please create one in the Mollie Dashboard.',
        reason: 'no_profile',
      }
    }
    profileId = active.id
  }

  // Create the payment on the partner's account.
  const payRes = await fetch(`${MOLLIE_API_BASE}/payments`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      profileId,
      amount: { value: paymentAmount.toFixed(2), currency: 'EUR' },
      description: `Reservation ${reservationId}`,
      redirectUrl: opts.redirectUrl,
      webhookUrl: opts.webhookUrl,
      metadata: JSON.stringify({
        type: 'reservation',
        entityId: reservationId,
        siteId: reservation.siteId,
        ...opts.metadataExtra,
      }),
      ...(applicationFeeAmount > 0 && {
        applicationFee: {
          amount: { value: applicationFeeAmount.toFixed(2), currency: 'EUR' },
          description: 'Platform fee',
        },
      }),
      ...(testmode ? { testmode: true } : {}),
    }),
  })

  if (!payRes.ok) {
    const detail = await payRes.text().catch(() => '')
    console.error('[reservation-payment] Mollie create failed', payRes.status, detail)
    // Canonical terminal status so the cleanup cron GCs it and the grid renders
    // it as a removable failed seat rather than an orphan blocking the bed.
    await prisma.reservation.update({
      where: { id: reservationId },
      data: { status: RESERVATION_PAYMENT_FAILED },
    })
    if (payRes.status === 422) {
      return {
        status: 'error',
        error: 'Payment could not be processed. Please try again or contact support.',
        reason: 'provider_422',
      }
    }
    return { status: 'error', error: 'Failed to create payment', reason: 'provider_error' }
  }

  const payment = await payRes.json()
  const checkoutUrl: string | undefined = payment?._links?.checkout?.href
  if (!checkoutUrl) {
    console.error('[reservation-payment] no checkout URL for payment', payment?.id)
    return { status: 'error', error: 'Failed to get checkout URL', reason: 'no_checkout' }
  }

  await prisma.reservation.update({
    where: { id: reservationId },
    data: { paymentRef: payment.id, status: RESERVATION_PROCESSING },
  })

  return { status: 'ok', checkoutUrl, paymentId: payment.id }
}

export type PaymentStatusResult =
  | { status: 'ok'; providerStatus: string; succeeded: boolean; failed: boolean }
  | { status: 'error'; error: string }

/**
 * Re-verify a reservation's payment status straight from Mollie (the webhook is
 * primary; this is the fallback the partner manage poll uses). Demo refs always
 * read as paid. Resolves the partner token via the site owner (PartnerAccount is
 * keyed by `userId === site.userId`), so no reverse payment→partner lookup.
 */
export async function getReservationPaymentStatus(
  reservationId: string,
): Promise<PaymentStatusResult> {
  const reservation = await prisma.reservation.findUnique({
    where: { id: reservationId },
    select: { paymentRef: true, site: { select: { userId: true } } },
  })
  if (!reservation?.paymentRef) {
    return { status: 'error', error: 'No payment to verify' }
  }
  const ref = reservation.paymentRef

  if (isDemoPaymentRef(ref)) {
    return { status: 'ok', providerStatus: 'paid', succeeded: true, failed: false }
  }
  if (!isMolliePaymentRef(ref)) {
    return { status: 'error', error: `Unknown payment provider for ref: ${ref}` }
  }

  let token: string
  try {
    token = await getValidMollieToken(reservation.site.userId)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Mollie token unavailable'
    return { status: 'error', error: msg }
  }

  const testmode = isTestMode()
  const res = await fetch(
    `${MOLLIE_API_BASE}/payments/${encodeURIComponent(ref)}${testmode ? '?testmode=true' : ''}`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  if (!res.ok) {
    return { status: 'error', error: `Mollie payment lookup failed (${res.status})` }
  }
  const payment = await res.json()
  const providerStatus: string = payment?.status ?? 'unknown'
  return {
    status: 'ok',
    providerStatus,
    succeeded: providerStatus === 'paid',
    failed: ['canceled', 'expired', 'failed'].includes(providerStatus),
  }
}

/**
 * Polling-fallback finalizer (the webhook is primary). Re-verifies the
 * reservation's payment with Mollie and, on success, runs the idempotent
 * `processConfirmedReservation` (invoices + status → complete). Returns the
 * settled outcome; it does NOT mutate status on failure — the caller decides
 * whether a failed collection reverts to paid-in-cash (manage walk-in) or
 * payment_failed (consumer flow). Living here keeps `processConfirmedReservation`
 * out of the partner app's unit-test surface (partner mocks this module).
 */
export type FinalizeResult = {
  settled: 'complete' | 'failed' | 'pending'
  providerStatus?: string
}

export async function reverifyAndFinalizeReservation(
  reservationId: string,
): Promise<FinalizeResult> {
  const verify = await getReservationPaymentStatus(reservationId)
  if (verify.status === 'error') return { settled: 'pending' }
  if (verify.succeeded) {
    await processConfirmedReservation(reservationId)
    return { settled: 'complete', providerStatus: verify.providerStatus }
  }
  if (verify.failed) return { settled: 'failed', providerStatus: verify.providerStatus }
  return { settled: 'pending', providerStatus: verify.providerStatus }
}
