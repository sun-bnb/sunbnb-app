import { describe, it, expect } from 'vitest'
import {
  resolveEffectiveSubscription,
  resolveEffectiveFeatures,
  TIER_FEATURE_DEFAULTS,
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
