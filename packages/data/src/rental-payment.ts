/**
 * Shared Mollie payment creation + status for rental bookings.
 *
 * Extracted into `@repo/data` so BOTH the consumer online flow (user app) AND
 * the partner manage page (QR walk-in collection) create and verify payments
 * through one code path. `fetch`-based — no `@mollie/api-client` dependency in
 * `@repo/data` — mirroring `reservation-payment.ts` and `refund.ts`, and
 * reusing `getValidMollieToken` as the single token-refresh authority.
 *
 * `createRentalBookingMolliePayment` accepts a LIST of booking ids: a single
 * rental-card collect is `[bookingId]`; a walk-in that created multiple bookings
 * (one per distinct rental item) passes the whole group. One Mollie payment is
 * created for the summed `paymentAmount`; all bookings in the group receive the
 * same `paymentRef` so `processConfirmedRentalBooking(paymentRef)` finalizes them
 * all at once. The fee/service code is `'equipment-rental'` (not `'sunbed-rental'`).
 *
 * The payment is created on the PARTNER's Mollie account (OAuth token), making
 * the partner the Merchant of Record; our platform commission rides along as an
 * `applicationFee` Mollie routes to us. See `.claude/rules/payments.md`.
 *
 * These functions DO write the booking's `paymentRef`/`status` (the side effect
 * callers depend on), but contain no HTTP/auth/ownership concerns — the caller
 * (route or server action) owns those.
 */

import prisma from '../index'
import {
  loadFeeContext,
  resolveServiceFee,
  calculateServiceFeeAmount,
  round,
  processConfirmedRentalBooking,
} from './payment'
import { getValidMollieToken } from './mollie-tokens'
import { isTestMode } from './env'
import {
  RENTAL_PROCESSING,
  RENTAL_PAYMENT_FAILED,
} from './reservation-status'

const MOLLIE_API_BASE = 'https://api.mollie.com/v2'
const SERVICE_CODE = 'equipment-rental'

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
   * `{ type:'rental-booking', entityId, bookingIds, siteId }`. The partner collect flow passes
   * `{ collect: true }` so the webhook reverts a failed payment to paid-in-cash
   * instead of marking the booking payment_failed.
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
 * Create a single Mollie payment for one or more rental bookings. The caller
 * passes a list of booking ids:
 *   - single rental-card collect: `[bookingId]`
 *   - walk-in with multiple items: all booking ids from that walk-in session
 *
 * Amount = sum of `paymentAmount` across all bookings (DB only — never a
 * client-supplied value; see payments.md). All bookings must belong to the same
 * site (one Mollie account, one fee context). On success, the same `paymentRef`
 * is written to ALL bookings so `processConfirmedRentalBooking(paymentRef)`
 * finalizes the whole group at once. On provider error, ALL bookings are set to
 * `payment_failed` (canonical terminal state, GC'd by the cleanup cron).
 * Never throws for an expected failure path.
 */
export async function createRentalBookingMolliePayment(
  bookingIds: string[],
  opts: CreatePaymentOptions,
): Promise<CreatePaymentResult> {
  // ── Validate the id list ──────────────────────────────────────────────────
  if (bookingIds.length === 0 || bookingIds.length > 20) {
    return {
      status: 'error',
      error: 'Booking list must contain between 1 and 20 ids',
      reason: 'invalid_amount',
    }
  }

  const bookings = await prisma.rentalBooking.findMany({
    where: { id: { in: bookingIds } },
  })
  if (bookings.length !== bookingIds.length) {
    return { status: 'error', error: 'One or more rental bookings not found', reason: 'invalid_amount' }
  }

  // All bookings must share the same site — one Mollie account, one fee context.
  // bookings is non-empty here: bookingIds was length-checked (1–20) and
  // bookings.length === bookingIds.length, so index 0 exists.
  const siteId = bookings[0]!.siteId
  if (bookings.some((b) => b.siteId !== siteId)) {
    return {
      status: 'error',
      error: 'All bookings must belong to the same site',
      reason: 'invalid_amount',
    }
  }

  // Amount comes from the DB — never a client-supplied value (payments.md).
  const paymentAmount = round(bookings.reduce((sum, b) => sum + (b.paymentAmount ?? 0), 0))
  if (paymentAmount <= 0) {
    return { status: 'error', error: 'Invalid payment amount', reason: 'invalid_amount' }
  }

  // Representative booking id for Mollie metadata (informational; the webhook
  // and reverify keying is by paymentRef, not entityId).
  const primaryBookingId = bookings[0]!.id

  const { site, partnerAccount, settings } = await loadFeeContext(siteId, SERVICE_CODE)
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
    console.error('[rental-payment] token refresh failed:', err)
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
      console.error('[rental-payment] profiles fetch failed', profRes.status)
      return {
        status: 'error',
        error: 'Failed to retrieve merchant website profiles',
        reason: 'provider_error',
      }
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

  // Create one payment on the partner's account covering the full group amount.
  const payRes = await fetch(`${MOLLIE_API_BASE}/payments`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      profileId,
      amount: { value: paymentAmount.toFixed(2), currency: 'EUR' },
      description: `Equipment rental ${primaryBookingId}`,
      redirectUrl: opts.redirectUrl,
      webhookUrl: opts.webhookUrl,
      // `type:'rental-booking'` + `bookingIds` is the contract the user app's
      // /api/webhooks/mollie handler keys on: success finalizes by paymentRef
      // (whole group), and the failure branch updates every id in `bookingIds`.
      metadata: JSON.stringify({
        type: 'rental-booking',
        entityId: primaryBookingId,
        bookingIds,
        siteId,
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
    console.error('[rental-payment] Mollie create failed', payRes.status, detail)
    // Mark ALL bookings in the group as failed — canonical terminal state so the
    // cleanup cron can GC them and the manage page renders them as removable.
    await prisma.rentalBooking.updateMany({
      where: { id: { in: bookingIds } },
      data: { status: RENTAL_PAYMENT_FAILED },
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
    console.error('[rental-payment] no checkout URL for payment', payment?.id)
    return { status: 'error', error: 'Failed to get checkout URL', reason: 'no_checkout' }
  }

  // Write the SAME paymentRef to all bookings in the group — one Mollie payment
  // covers the group; processConfirmedRentalBooking(paymentRef) finalizes all.
  await prisma.rentalBooking.updateMany({
    where: { id: { in: bookingIds } },
    data: { paymentRef: payment.id, status: RENTAL_PROCESSING },
  })

  return { status: 'ok', checkoutUrl, paymentId: payment.id }
}

export type PaymentStatusResult =
  | { status: 'ok'; providerStatus: string; succeeded: boolean; failed: boolean }
  | { status: 'error'; error: string }

/**
 * Re-verify a rental booking's payment status straight from Mollie (the webhook
 * is primary; this is the fallback the partner manage poll uses). Demo refs always
 * read as paid. Resolves the partner token via the site owner (`site.userId` on
 * the booking's site), so no reverse payment→partner lookup.
 */
export async function getRentalBookingPaymentStatus(
  bookingId: string,
): Promise<PaymentStatusResult> {
  const booking = await prisma.rentalBooking.findUnique({
    where: { id: bookingId },
    select: { paymentRef: true, site: { select: { userId: true } } },
  })
  if (!booking?.paymentRef) {
    return { status: 'error', error: 'No payment to verify' }
  }
  const ref = booking.paymentRef

  if (isDemoPaymentRef(ref)) {
    return { status: 'ok', providerStatus: 'paid', succeeded: true, failed: false }
  }
  if (!isMolliePaymentRef(ref)) {
    return { status: 'error', error: `Unknown payment provider for ref: ${ref}` }
  }

  let token: string
  try {
    token = await getValidMollieToken(booking.site.userId)
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
 * Polling-fallback finalizer (the webhook is primary). Re-verifies the booking's
 * payment with Mollie and, on success, runs the idempotent
 * `processConfirmedRentalBooking(paymentRef)` (invoices + status → complete).
 * Returns the settled outcome; it does NOT mutate status on failure — the caller
 * (partner action) decides whether a failed collection reverts to paid-in-cash
 * or payment_failed. Living here keeps `processConfirmedRentalBooking` out of
 * the partner app's unit-test surface (partner mocks this module).
 */
export type FinalizeResult = {
  settled: 'complete' | 'failed' | 'pending'
  providerStatus?: string
}

export async function reverifyAndFinalizeRentalBooking(
  bookingId: string,
): Promise<FinalizeResult> {
  const verify = await getRentalBookingPaymentStatus(bookingId)
  if (verify.status === 'error') return { settled: 'pending' }
  if (verify.succeeded) {
    // processConfirmedRentalBooking is keyed by paymentRef, so retrieve it first.
    const booking = await prisma.rentalBooking.findUnique({
      where: { id: bookingId },
      select: { paymentRef: true },
    })
    if (!booking?.paymentRef) return { settled: 'pending' }
    await processConfirmedRentalBooking(booking.paymentRef)
    return { settled: 'complete', providerStatus: verify.providerStatus }
  }
  if (verify.failed) return { settled: 'failed', providerStatus: verify.providerStatus }
  return { settled: 'pending', providerStatus: verify.providerStatus }
}
