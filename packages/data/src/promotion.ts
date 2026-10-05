/**
 * Partner promotions — PURE rules (track 027 D9). DB access lives in `promotion-db.ts`.
 *
 * The launch offer: **no commission and no plan fees for 30 days, counted from the partner's
 * first LIVE paid booking, for partner accounts created up to 31 May 2027.**
 *
 * Two invariants every charge point relies on:
 *  1. Whether a booking is waived is decided from the BOOKING's own createdAt
 *     (`isCommissionWaived`). Payment creation (the Mollie applicationFee) and confirmation (the
 *     PLATFORM invoice) both read that same timestamp, so they can never disagree — even when the
 *     30-day window ends between the two.
 *  2. Before the clock starts, every booking is waived: only the first live paid booking can
 *     start it, so anything earlier is by definition inside the offer.
 */
import { isVivaPaymentRef } from './viva/refs'

export const LAUNCH_PROMOTION = {
  code: 'launch-30d',
  days: 30,
  /** Accounts created BEFORE this instant qualify: 1 June 2027 00:00 Madrid (CEST) = 31 May inclusive. */
  joinCutoff: new Date('2027-05-31T22:00:00.000Z'),
} as const

export interface PromotionState {
  code: string
  startedAt: Date | null
  endsAt: Date | null
  revokedAt: Date | null
}

export function isEligibleForLaunchPromotion(account: { createdAt: Date; isTestAccount?: boolean | null }): boolean {
  return !account.isTestAccount && account.createdAt.getTime() < LAUNCH_PROMOTION.joinCutoff.getTime()
}

/** The launch promotion among a partner's promotions, if granted and not revoked. */
export function activeLaunchPromotion(promotions: PromotionState[] | null | undefined): PromotionState | null {
  return promotions?.find((p) => p.code === LAUNCH_PROMOTION.code && !p.revokedAt) ?? null
}

/** Is commission waived for a booking created at `bookingCreatedAt`? (See invariant 1 and 2.) */
export function isCommissionWaived(promo: PromotionState | null | undefined, bookingCreatedAt: Date): boolean {
  if (!promo || promo.revokedAt) return false
  if (!promo.startedAt || !promo.endsAt) return true
  return bookingCreatedAt.getTime() < promo.endsAt.getTime()
}

export function promotionEndsAt(startedAt: Date): Date {
  return new Date(startedAt.getTime() + LAUNCH_PROMOTION.days * 24 * 60 * 60 * 1000)
}

/**
 * Does this payment ref prove a LIVE paid booking, i.e. may it start the clock? Mollie (`tr_`) and
 * Viva (`viva_`) only — never demo (`pi_demo_`), off-platform (`offplatform_`) or cash (no ref) —
 * and only where payments are live (`liveEnvironment`), because Mollie test-mode refs look the
 * same as live ones (founder decision: test-mode payments must not burn a partner's free month).
 */
export function startsPromotionClock(paymentRef: string | null | undefined, liveEnvironment: boolean): boolean {
  if (!liveEnvironment || typeof paymentRef !== 'string') return false
  return /^tr_[A-Za-z0-9]+$/.test(paymentRef) || isVivaPaymentRef(paymentRef)
}

/**
 * Stripe trial end for a plan subscription bought during the promotion: the promotion's end once
 * the clock runs, else a provisional 30 days from now (extended when the clock starts). Null when
 * nothing is left to waive. Stripe needs a trial end at least 48 h ahead.
 */
export function planTrialEnd(promo: PromotionState | null | undefined, now: Date): Date | null {
  if (!promo || promo.revokedAt) return null
  const end = promo.endsAt ?? promotionEndsAt(now)
  return end.getTime() - now.getTime() >= 48 * 60 * 60 * 1000 ? end : null
}
