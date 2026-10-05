import { describe, expect, it } from 'vitest'
import {
  activeLaunchPromotion,
  isCommissionWaived,
  isEligibleForLaunchPromotion,
  LAUNCH_PROMOTION,
  planTrialEnd,
  promotionEndsAt,
  startsPromotionClock,
  type PromotionState,
} from './promotion'

const day = 24 * 60 * 60 * 1000
const start = new Date('2026-06-10T10:00:00Z')
const running: PromotionState = { code: LAUNCH_PROMOTION.code, startedAt: start, endsAt: promotionEndsAt(start), revokedAt: null }
const notStarted: PromotionState = { code: LAUNCH_PROMOTION.code, startedAt: null, endsAt: null, revokedAt: null }

describe('eligibility — accounts created up to 31 May 2027 (Madrid), never test accounts', () => {
  it.each([
    ['2026-10-05T10:00:00Z', true],
    ['2027-05-31T21:59:59Z', true], // 23:59:59 CEST on 31 May
    ['2027-05-31T22:00:00Z', false], // 00:00 CEST on 1 June
  ])('created %s → %s', (iso, ok) => {
    expect(isEligibleForLaunchPromotion({ createdAt: new Date(iso) })).toBe(ok)
  })

  it('test accounts never qualify', () => {
    expect(isEligibleForLaunchPromotion({ createdAt: new Date('2026-10-05'), isTestAccount: true })).toBe(false)
  })
})

describe('isCommissionWaived — decided by the BOOKING time', () => {
  it('waives everything before the clock starts (only the first live paid booking can start it)', () => {
    expect(isCommissionWaived(notStarted, new Date('2027-03-01'))).toBe(true)
  })

  it('waives bookings created inside the 30 days, charges from the end instant on', () => {
    expect(isCommissionWaived(running, start)).toBe(true)
    expect(isCommissionWaived(running, new Date(start.getTime() + 30 * day - 1))).toBe(true)
    expect(isCommissionWaived(running, new Date(start.getTime() + 30 * day))).toBe(false)
  })

  it('a booking created inside the window stays waived even if it is CONFIRMED after it', () => {
    // Same input at payment creation and at confirmation → same answer, by construction.
    const createdAt = new Date(start.getTime() + 29 * day)
    expect(isCommissionWaived(running, createdAt)).toBe(true)
  })

  it('no promotion, or a revoked one, waives nothing', () => {
    expect(isCommissionWaived(null, start)).toBe(false)
    expect(isCommissionWaived({ ...notStarted, revokedAt: new Date() }, start)).toBe(false)
  })
})

describe('startsPromotionClock — only a LIVE paid booking', () => {
  it.each([
    ['tr_WDqYK6vllg', true, true],
    ['viva_6f1c2a8e-1b2c-4d5e-8f90-123456789abc', true, true],
    ['tr_WDqYK6vllg', false, false], // test mode: Mollie refs look the same — never starts it
    ['pi_demo_1730000000', true, false],
    ['offplatform_ord123', true, false],
    [null, true, false], // cash / walk-in
  ] as const)('%s (live=%s) → %s', (ref, live, starts) => {
    expect(startsPromotionClock(ref, live)).toBe(starts)
  })
})

describe('activeLaunchPromotion', () => {
  it('ignores revoked and unrelated promotions', () => {
    expect(activeLaunchPromotion([{ ...notStarted, revokedAt: new Date() }])).toBeNull()
    expect(activeLaunchPromotion([{ ...notStarted, code: 'other' }])).toBeNull()
    expect(activeLaunchPromotion([notStarted])).toEqual(notStarted)
  })
})

describe('planTrialEnd — Stripe trial for a plan bought during the promotion', () => {
  it('runs to the promotion end once the clock runs', () => {
    expect(planTrialEnd(running, new Date(start.getTime() + 5 * day))).toEqual(running.endsAt)
  })

  it('is provisional 30 days from now before the clock starts', () => {
    const now = new Date('2027-01-10T00:00:00Z')
    expect(planTrialEnd(notStarted, now)).toEqual(promotionEndsAt(now))
  })

  it('is null with under 48 h left, no promotion, or a revoked one', () => {
    expect(planTrialEnd(running, new Date(running.endsAt!.getTime() - 47 * 60 * 60 * 1000))).toBeNull()
    expect(planTrialEnd(null, start)).toBeNull()
    expect(planTrialEnd({ ...running, revokedAt: start }, start)).toBeNull()
  })
})
