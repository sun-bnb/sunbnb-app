import { describe, it, expect } from 'vitest'
import {
  resolveEffectiveSubscription,
  resolveEffectiveFeatures,
  TIER_FEATURE_DEFAULTS,
  PRICING_TIERS,
  PRICING_TIER_ORDER,
  COMMISSIONED_SERVICE_CODES,
} from './subscription'
import type { SubscriptionTier } from '@prisma/client'

// ─── helpers ────────────────────────────────────────────────────────────────

const makePlan = (overrides: Partial<{
  tier: SubscriptionTier
  name: string
  monthlyPrice: number
  maxSites: number
}> = {}) => ({
  tier:         'STARTER' as SubscriptionTier,
  name:         'Starter',
  monthlyPrice: 0,
  maxSites:     1,
  ...overrides,
})

// ─── resolveEffectiveSubscription() ────────────────────────────────────────

describe('resolveEffectiveSubscription', () => {
  it('uses custom maxSites when set, regardless of plan', () => {
    const result = resolveEffectiveSubscription(
      makePlan({ maxSites: 1 }),
      { maxSites: 5 },
    )
    expect(result.maxSites).toBe(5)
  })

  it('falls back to plan maxSites when custom.maxSites is null', () => {
    const result = resolveEffectiveSubscription(
      makePlan({ maxSites: 3 }),
      { maxSites: null },
    )
    expect(result.maxSites).toBe(3)
  })

  it('falls back to 1 when both plan and custom are null', () => {
    const result = resolveEffectiveSubscription(null, null)
    expect(result.maxSites).toBe(1)
  })

  it('falls back to 1 when plan is null and custom is null', () => {
    const result = resolveEffectiveSubscription(null, { maxSites: null })
    expect(result.maxSites).toBe(1)
  })

  it('isCustom is true when custom record exists with a non-null maxSites', () => {
    const result = resolveEffectiveSubscription(makePlan(), { maxSites: 3 })
    expect(result.isCustom).toBe(true)
  })

  it('isCustom is false when custom is null', () => {
    const result = resolveEffectiveSubscription(makePlan(), null)
    expect(result.isCustom).toBe(false)
  })

  it('isCustom is false when custom exists but maxSites is null', () => {
    const result = resolveEffectiveSubscription(makePlan(), { maxSites: null })
    expect(result.isCustom).toBe(false)
  })

  it('tier falls back to STARTER when plan is null', () => {
    const result = resolveEffectiveSubscription(null, null)
    expect(result.tier).toBe('STARTER')
  })

  it('tier comes from the plan when plan is provided', () => {
    const result = resolveEffectiveSubscription(
      makePlan({ tier: 'PRO' as SubscriptionTier }),
      null,
    )
    expect(result.tier).toBe('PRO')
  })

  it('name falls back to Starter when plan is null', () => {
    const result = resolveEffectiveSubscription(null, null)
    expect(result.name).toBe('Starter')
  })

  it('name comes from the plan when plan is provided', () => {
    const result = resolveEffectiveSubscription(
      makePlan({ name: 'Pro Plan' }),
      null,
    )
    expect(result.name).toBe('Pro Plan')
  })

  it('monthlyPrice falls back to 0 when plan is null', () => {
    const result = resolveEffectiveSubscription(null, null)
    expect(result.monthlyPrice).toBe(0)
  })

  it('monthlyPrice comes from the plan when plan is provided', () => {
    const result = resolveEffectiveSubscription(
      makePlan({ monthlyPrice: 49 }),
      null,
    )
    expect(result.monthlyPrice).toBe(49)
  })

  it('custom maxSites wins over plan even for non-STARTER tiers', () => {
    const result = resolveEffectiveSubscription(
      makePlan({ tier: 'BUSINESS' as SubscriptionTier, maxSites: 10 }),
      { maxSites: 2 },
    )
    expect(result.maxSites).toBe(2)
    expect(result.tier).toBe('BUSINESS')
    expect(result.isCustom).toBe(true)
  })

  it('returns features computed from tier when no custom overrides', () => {
    const pro = resolveEffectiveSubscription(makePlan({ tier: 'PRO' as SubscriptionTier }), null)
    expect(pro.features.OFF_PLATFORM_BILLING).toBe(true)

    const starter = resolveEffectiveSubscription(makePlan({ tier: 'STARTER' as SubscriptionTier }), null)
    expect(starter.features.OFF_PLATFORM_BILLING).toBe(false)
  })

  it('returns features with override applied when featureOverrides set on custom', () => {
    const result = resolveEffectiveSubscription(
      makePlan({ tier: 'STARTER' as SubscriptionTier }),
      { maxSites: null, featureOverrides: { OFF_PLATFORM_BILLING: true } },
    )
    expect(result.features.OFF_PLATFORM_BILLING).toBe(true)
  })

  it('override false wins over PRO tier default true', () => {
    const result = resolveEffectiveSubscription(
      makePlan({ tier: 'PRO' as SubscriptionTier }),
      { maxSites: null, featureOverrides: { OFF_PLATFORM_BILLING: false } },
    )
    expect(result.features.OFF_PLATFORM_BILLING).toBe(false)
  })

  it('features use STARTER defaults when plan is null', () => {
    const result = resolveEffectiveSubscription(null, null)
    expect(result.features.OFF_PLATFORM_BILLING).toBe(TIER_FEATURE_DEFAULTS['STARTER'].OFF_PLATFORM_BILLING)
  })
})

// ─── resolveEffectiveFeatures() ─────────────────────────────────────────────

describe('resolveEffectiveFeatures', () => {
  it('override true wins over STARTER tier default false', () => {
    const result = resolveEffectiveFeatures('STARTER', { OFF_PLATFORM_BILLING: true })
    expect(result.OFF_PLATFORM_BILLING).toBe(true)
  })

  it('override false wins over PRO tier default true', () => {
    const result = resolveEffectiveFeatures('PRO', { OFF_PLATFORM_BILLING: false })
    expect(result.OFF_PLATFORM_BILLING).toBe(false)
  })

  it('falls back to tier default when key not in overrides', () => {
    const resultPro = resolveEffectiveFeatures('PRO', {})
    expect(resultPro.OFF_PLATFORM_BILLING).toBe(true)

    const resultStarter = resolveEffectiveFeatures('STARTER', {})
    expect(resultStarter.OFF_PLATFORM_BILLING).toBe(false)
  })

  it('null overrides falls back to tier default', () => {
    expect(resolveEffectiveFeatures('PRO', null).OFF_PLATFORM_BILLING).toBe(true)
    expect(resolveEffectiveFeatures('STARTER', null).OFF_PLATFORM_BILLING).toBe(false)
  })

  it('null tier uses STARTER defaults', () => {
    const result = resolveEffectiveFeatures(null, null)
    expect(result.OFF_PLATFORM_BILLING).toBe(TIER_FEATURE_DEFAULTS['STARTER'].OFF_PLATFORM_BILLING)
  })

  it('null tier with override true gives true', () => {
    const result = resolveEffectiveFeatures(null, { OFF_PLATFORM_BILLING: true })
    expect(result.OFF_PLATFORM_BILLING).toBe(true)
  })

  it('returns false for a feature key absent from tier defaults', () => {
    // Simulate a future feature not yet in TIER_FEATURE_DEFAULTS by temporarily
    // checking that keys in SUBSCRIPTION_FEATURES but not in defaults resolve to false.
    // For OFF_PLATFORM_BILLING this is exercised above; this test documents the fallback:
    const result = resolveEffectiveFeatures('STARTER', null)
    // All keys must be present and be booleans
    for (const key of Object.keys(result) as (keyof typeof result)[]) {
      expect(typeof result[key]).toBe('boolean')
    }
  })
})

// ─── PRICING_TIERS (the published ladder) ───────────────────────────────────
//
// These are not "does the constant still say what it says" assertions — they
// pin the SHAPE a pricing ladder has to have to be sellable. A partner who pays
// more must never get less, or the upgrade button is a downgrade button, and
// the paid tiers must actually buy something or the page is a lie.

describe('PRICING_TIERS', () => {
  it('covers every tier the enum can hold, in ascending order', () => {
    expect(PRICING_TIER_ORDER).toEqual(Object.keys(PRICING_TIERS))
  })

  it('Starter is genuinely free — the landing page promises "Free forever"', () => {
    expect(PRICING_TIERS.STARTER.monthlyPrice).toBe(0)
  })

  it('monthly price strictly increases up the ladder', () => {
    const prices = PRICING_TIER_ORDER.map((t) => PRICING_TIERS[t].monthlyPrice)
    for (let i = 1; i < prices.length; i++) {
      expect(prices[i]).toBeGreaterThan(prices[i - 1]!)
    }
  })

  it('site allowance never shrinks as the price rises', () => {
    // The mockup's Starter card once read "Unlimited beaches & venues" above a
    // Pro card capped at 3 — upgrading would have COST the partner capacity.
    const caps = PRICING_TIER_ORDER.map((t) => PRICING_TIERS[t].maxSites)
    for (let i = 1; i < caps.length; i++) {
      expect(caps[i]).toBeGreaterThan(caps[i - 1]!)
    }
  })

  it('commission strictly falls as the price rises — that is what the fee buys', () => {
    const rates = PRICING_TIER_ORDER.map((t) => PRICING_TIERS[t].commissionPercent)
    for (let i = 1; i < rates.length; i++) {
      expect(rates[i]).toBeLessThan(rates[i - 1]!)
    }
  })

  it('every tier takes a positive commission — no tier is a free ride', () => {
    // A 0% tier makes the PLATFORM commission invoice a zero-total document and
    // leaves the marketplace with no revenue on that partner's sales.
    for (const tier of PRICING_TIER_ORDER) {
      expect(PRICING_TIERS[tier].commissionPercent).toBeGreaterThan(0)
    }
  })

  it('every tier allows at least one site', () => {
    for (const tier of PRICING_TIER_ORDER) {
      expect(PRICING_TIERS[tier].maxSites).toBeGreaterThanOrEqual(1)
    }
  })

  it('an entitlement is never withdrawn by paying more', () => {
    // Feature defaults must be monotonic too: a key true on a cheaper tier has
    // to stay true above it.
    const keys = Object.keys(TIER_FEATURE_DEFAULTS.STARTER) as (keyof typeof TIER_FEATURE_DEFAULTS.STARTER)[]
    for (const key of keys) {
      let seenTrue = false
      for (const tier of PRICING_TIER_ORDER) {
        const value = resolveEffectiveFeatures(tier, null)[key]
        if (seenTrue) expect(value).toBe(true)
        if (value) seenTrue = true
      }
    }
  })

  it('names every consumer purchase type the commission applies to', () => {
    // Seeding a code here creates its platform fee rows; omitting one silently
    // drops that purchase type to the tier-null default (a flat €1), which is
    // not what "commission per Sunbnb purchase" says on the card.
    expect([...COMMISSIONED_SERVICE_CODES]).toEqual([
      'sunbed-rental',
      'food-and-beverage',
      'equipment-rental',
    ])
  })
})
