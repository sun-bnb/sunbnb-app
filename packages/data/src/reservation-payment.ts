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
import { isOwnAccountApplicationFeeError } from './mollie-app-fee'
import { isTestMode } from './env'
import {
  RESERVATION_PROCESSING,
  RESERVATION_PAYMENT_FAILED,
} from './reservation-status'
import { getVivaClient, isVivaPaymentRef, sessionFromVivaRef, toCents } from './viva'

export type CancelPaymentResult =
  | { status: 'canceled' }
  | { status: 'paid' }
  | { status: 'error'; error: string }

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
  const paymentBody = {
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
  }

  const attemptCreate = (body: object) =>
    fetch(`${MOLLIE_API_BASE}/payments`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

  let payRes = await attemptCreate(paymentBody)

  // Own-account fallback: platform-operated venues (partner OAuth = our own
  // Mollie org) cannot carry an applicationFee — retry once without it.
  if (!payRes.ok && payRes.status === 422 && 'applicationFee' in paymentBody) {
    const detail = await payRes.clone().text().catch(() => '')
    if (isOwnAccountApplicationFeeError(detail)) {
      console.warn(
        '[reservation-payment] Own-account applicationFee rejected by Mollie — retrying without fee (platform-operated venue; commission not routed)',
      )
      const { applicationFee: _dropped, ...withoutFee } = paymentBody as Record<string, unknown>
      payRes = await attemptCreate(withoutFee)
    }
  }

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
  if (isVivaPaymentRef(ref)) {
    // unknown (transient 404) reads as pending, not failed — a live tap must
    // never be reverted by a lookup race (see reservation-machine-apply.ts's
    // abandon-while-pending divergence).
    try {
      const session = await getVivaClient().getSession(sessionFromVivaRef(ref))
      return {
        status: 'ok',
        providerStatus: session.state,
        succeeded: session.state === 'approved',
        failed: session.state === 'declined' || session.state === 'aborted',
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Viva session lookup failed'
      return { status: 'error', error: msg }
    }
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

/**
 * Cancel an in-flight Mollie payment for a reservation.
 *
 * Intended for the partner QR-collection abandon flow: when staff dismiss the
 * QR screen before the consumer pays, this cancels the payment at the provider
 * level so the consumer can't complete it out-of-band and create an untracked
 * paid reservation.
 *
 * This function ONLY talks to Mollie. It does NOT delete the reservation, change
 * its status, or touch the till — the caller (partner `cancelCollection`) owns
 * all local state changes based on the returned status.
 *
 * Status semantics for the caller:
 * - `canceled` → payment is gone; caller should delete/revert the reservation.
 * - `paid`     → Mollie returned 422 (payment was already authorized/paid before
 *               the DELETE landed); caller should finalize it as complete instead
 *               of deleting. The QR consumer paid while the abandon was in flight.
 * - `error`    → unexpected failure; keep the reservation safe (revert to cash
 *               walk-in, don't delete — it may still be in flight).
 *
 * Demo refs and missing refs short-circuit without touching Mollie.
 */
export async function cancelReservationMolliePayment(
  reservationId: string,
  /** Only meaningful for a Viva ref — see `cancelReservationVivaPayment`. */
  cashRegisterId?: string,
): Promise<CancelPaymentResult> {
  const reservation = await prisma.reservation.findUnique({
    where: { id: reservationId },
    select: { paymentRef: true, site: { select: { userId: true } } },
  })

  const paymentRef = reservation?.paymentRef ?? null

  // Early viva branch — the name stays Mollie-specific (every app imports it)
  // but a viva_ ref delegates to the Viva abort path instead.
  if (paymentRef && isVivaPaymentRef(paymentRef)) {
    return cancelReservationVivaPayment(reservationId, cashRegisterId)
  }

  // No ref or demo ref — nothing to cancel with a provider.
  if (!paymentRef || isDemoPaymentRef(paymentRef)) {
    return { status: 'canceled' }
  }

  // Resolve the partner's Mollie token via the site owner (PartnerAccount.userId
  // === Site.userId), exactly as createReservationMolliePayment does for the
  // token acquisition step.
  const partnerAccount = await prisma.partnerAccount.findUnique({
    where: { userId: reservation!.site.userId },
    select: { userId: true, mollieAccessToken: true },
  })

  if (!partnerAccount?.mollieAccessToken) {
    return {
      status: 'error',
      error: 'Partner has not connected their Mollie account',
    }
  }

  let token: string
  try {
    token = await getValidMollieToken(partnerAccount.userId)
  } catch (err) {
    console.error('[reservation-payment] cancel: token refresh failed:', err)
    return {
      status: 'error',
      error:
        'Partner Mollie session has expired. Please ask the merchant to reconnect their Mollie account.',
    }
  }

  const testmode = isTestMode()
  const qs = testmode ? '?testmode=true' : ''

  const delRes = await fetch(
    `${MOLLIE_API_BASE}/payments/${encodeURIComponent(paymentRef)}${qs}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    },
  )

  if (delRes.ok) {
    return { status: 'canceled' }
  }

  if (delRes.status === 422) {
    // Mollie returns 422 when the payment is no longer cancelable — it
    // transitioned to `authorized` or `paid` while the DELETE was in flight.
    // Signal the caller to finalize the reservation as complete.
    return { status: 'paid' }
  }

  const detail = await delRes.text().catch(() => '')
  console.error('[reservation-payment] cancel: Mollie DELETE failed', delRes.status, detail)
  return {
    status: 'error',
    error: `Failed to cancel payment (${delRes.status})`,
  }
}

/**
 * Cancel an in-flight Viva Cloud Terminal sale session (the card-present
 * counterpart to `cancelReservationMolliePayment`, which delegates here for
 * a `viva_` ref). ONLY talks to Viva — the caller (`reservation-machine-apply.ts`
 * `runCollectAbandon`) owns all local state changes based on the returned status.
 *
 * `cashRegisterId` is required by Viva's abort endpoint (only the register that
 * opened the session may abort it — `VivaTerminal.cashRegisterId` in the
 * schema doc comment) and is NOT recoverable from the session id alone. The
 * caller (the machine executor) resolves it from the terminal the collect
 * started on and passes it in; this standalone helper falls back to the
 * site's terminals when the caller doesn't have it — unambiguous only when
 * the site has exactly one.
 *
 * Status semantics for the caller (mirrors `cancelReservationMolliePayment`):
 * - `canceled` → the session resolved aborted/declined; caller reverts to cash.
 * - `paid`     → the card was already read and the session resolved `approved`
 *               while the abort raced it; caller should finalize as complete.
 * - `error`    → abort did not resolve synchronously (still `pending` — Viva's
 *               abort only works before the card is read) or failed outright.
 *               The caller must poll `getSession` rather than revert — a card
 *               may be mid-authorisation.
 */
export async function cancelReservationVivaPayment(
  reservationId: string,
  cashRegisterId?: string,
): Promise<CancelPaymentResult> {
  const reservation = await prisma.reservation.findUnique({
    where: { id: reservationId },
    select: { paymentRef: true, siteId: true },
  })
  const paymentRef = reservation?.paymentRef ?? null
  if (!paymentRef || !isVivaPaymentRef(paymentRef)) {
    return { status: 'canceled' }
  }

  let register = cashRegisterId
  if (!register) {
    const terminals = await prisma.vivaTerminal.findMany({
      where: { siteId: reservation!.siteId },
      select: { cashRegisterId: true },
    })
    if (terminals.length === 1) register = terminals[0]!.cashRegisterId
  }
  if (!register) {
    return {
      status: 'error',
      error: 'Cannot resolve the Viva cash register to abort with — pass cashRegisterId explicitly',
    }
  }

  try {
    const session = await getVivaClient().abortSession(sessionFromVivaRef(paymentRef), register)
    if (session.state === 'aborted' || session.state === 'declined') return { status: 'canceled' }
    if (session.state === 'approved') return { status: 'paid' }
    // pending (abort raced the card read — Viva's 200/409 both mean "go
    // re-fetch") or unknown → the caller polls, never reverts blind.
    return { status: 'error', error: `Viva abort did not resolve (session state: ${session.state})` }
  } catch (err) {
    return { status: 'error', error: err instanceof Error ? err.message : 'Viva abort failed' }
  }
}

/**
 * Refund a completed Viva card-present sale. Minimal, idempotent via the
 * reservation's `refundedAt` stamp (same precedent as the Mollie/demo path in
 * `refund.ts` — the caller guards on `Reservation.refundedAt` before calling).
 * `isvDetails` on a refund carries ONLY `terminalMerchantId` — Viva reverses
 * the original ISV fee itself (`VivaRefundRequest` doc comment in `types.ts`).
 *
 * Not wired into `refund.ts`'s `issueReservationRefund` (that function takes a
 * `partnerAccountId` and dispatches on `tr_`/`pi_demo_` prefixes only) —
 * exported here for the apps to call directly on a `viva_` ref, same shape
 * (`RefundOutcome`-compatible) so a future dispatcher extension is a one-line add.
 */
export async function refundReservationVivaPayment(
  reservationId: string,
): Promise<{ status: 'ok' } | { status: 'error'; error: string }> {
  const reservation = await prisma.reservation.findUnique({
    where: { id: reservationId },
    select: { paymentRef: true, paymentAmount: true, refundedAt: true, siteId: true },
  })
  const paymentRef = reservation?.paymentRef ?? null
  if (!paymentRef || !isVivaPaymentRef(paymentRef)) {
    return { status: 'error', error: 'No Viva payment to refund' }
  }
  if (reservation!.refundedAt) {
    return { status: 'ok' } // idempotent — already refunded
  }

  const { partnerAccount } = await loadFeeContext(reservation!.siteId, SERVICE_CODE)
  if (!partnerAccount?.vivaMerchantId) {
    return { status: 'error', error: 'Venue has not connected Viva' }
  }

  const terminals = await prisma.vivaTerminal.findMany({
    where: { siteId: reservation!.siteId },
    select: { terminalId: true, cashRegisterId: true },
  })
  const terminal = terminals[0]
  if (!terminal) {
    return { status: 'error', error: 'No Viva terminal registered for this site' }
  }

  const amount = reservation!.paymentAmount ?? 0
  try {
    await getVivaClient().refund({
      sessionId: `${sessionFromVivaRef(paymentRef)}-refund`,
      parentSessionId: sessionFromVivaRef(paymentRef),
      terminalId: terminal.terminalId,
      cashRegisterId: terminal.cashRegisterId,
      amount: toCents(amount),
      merchantReference: reservationId,
      isvDetails: { terminalMerchantId: partnerAccount.vivaMerchantId },
    })
  } catch (err) {
    return { status: 'error', error: err instanceof Error ? err.message : 'Viva refund failed' }
  }
  return { status: 'ok' }
}
