/**
 * Viva payment-ref convention (track 024, W8, packet A1).
 *
 * PURE and client-safe — no fetch, no env — same discipline as `site-code.ts` /
 * `device-code.ts`: minting (the collect flow, when it creates the sale
 * session) and lookup (status polling, refund) must share ONE definition of
 * what the ref looks like.
 *
 * Convention: `viva_<sessionId>` where `sessionId` is the UUID we minted for
 * the Cloud Terminal sale session. Mirrors the existing provider-ref prefixes
 * this codebase already branches on — `tr_` for Mollie (`refund.ts`
 * `isMolliePaymentRef`), `pi_demo_` for demo mode — so `Reservation.paymentRef`
 * stays a single discriminated-by-prefix string across all three providers.
 */

const VIVA_REF_PREFIX = 'viva_'

/** Is this a Viva payment ref? Narrows `string | null | undefined` to `string`. */
export function isVivaPaymentRef(ref: string | null | undefined): ref is string {
  return typeof ref === 'string' && ref.startsWith(VIVA_REF_PREFIX) && ref.length > VIVA_REF_PREFIX.length
}

/** Build the stored payment ref from a minted Cloud Terminal session id. */
export function vivaRefFromSession(sessionId: string): string {
  if (!sessionId) {
    throw new Error('vivaRefFromSession requires a non-empty sessionId')
  }
  return `${VIVA_REF_PREFIX}${sessionId}`
}

/** Recover the session id from a stored Viva payment ref. Throws on a non-Viva ref. */
export function sessionFromVivaRef(ref: string): string {
  if (!isVivaPaymentRef(ref)) {
    throw new Error(`Not a Viva payment ref: ${ref}`)
  }
  return ref.slice(VIVA_REF_PREFIX.length)
}
