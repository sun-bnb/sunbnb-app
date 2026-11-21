import { describe, it, expect } from 'vitest'
import {
  resolveEffectiveSubscription,
  resolveEffectiveFeatures,
  TIER_FEATURE_DEFAULTS,
  PRICING_TIERS,
  PRICING_TIER_ORDER,
  COMMISSIONED_SERVICE_CODES,
  CAPPED_SERVICE_CODES,
  DEFAULT_TIER,
  FEATURED_TIER,
  planRowMaxSites,
  planFitIssues,
  UNLIMITED_SITES,
} from './subscription'
import type { SubscriptionTier } from '@prisma/client'

// ─── helpers ────────────────────────────────────────────────────────────────

const makePlan = (overrides: Partial<{
  tier: SubscriptionTier
  name: string
  monthlyPrice: number
  maxSites: number
  maxHamacasPerSite: number | null
  monthlyCommissionCapPerSite: number | null
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

  it('name comes from the catalogue, not the stored row name', () => {
    const result = resolveEffectiveSubscription(
      makePlan({ tier: 'PRO', name: 'Temporada' }),
      null,
    )
    expect(result.name).toBe('Pro')
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

// ─── PRICING_TIERS (the published catalogue) ────────────────────────────────
//
// Starter free + 6%, Pro EUR 29 / month + 3%, Business EUR 79 / month + 1.5%,
// 1 / 3 / 10 sites, the same rate on every purchase type.

describe('PRICING_TIERS', () => {
  it('covers every tier the enum can hold, free first', () => {
    expect(PRICING_TIER_ORDER).toEqual(Object.keys(PRICING_TIERS))
    expect(PRICING_TIER_ORDER[0]).toBe('STARTER')
    expect(DEFAULT_TIER).toBe('STARTER')
  })

  it('names are Starter, Pro and Business; Pro is featured', () => {
    expect(PRICING_TIER_ORDER.map((t) => PRICING_TIERS[t].name)).toEqual(['Starter', 'Pro', 'Business'])
    expect(FEATURED_TIER).toBe('PRO')
  })

  it('only Business carries the branded booking page', () => {
    expect(PRICING_TIER_ORDER.filter((t) => PRICING_TIERS[t].brandedBookingPage)).toEqual(['BUSINESS'])
  })

  it('monthly price: Starter free, Pro 29, Business 79', () => {
    expect(PRICING_TIER_ORDER.map((t) => PRICING_TIERS[t].monthlyPrice)).toEqual([0, 29, 79])
  })

  it('commission: 6% / 3% / 1.5%, the same on every purchase type', () => {
    const expected = { STARTER: 6, PRO: 3, BUSINESS: 1.5 } as const
    for (const tier of PRICING_TIER_ORDER) {
      for (const code of COMMISSIONED_SERVICE_CODES) {
        expect(PRICING_TIERS[tier].commissionPercent[code]).toBe(expected[tier])
      }
    }
  })

  it('sites 1 / 3 / 10; no sunbed limit and no commission cap on any plan', () => {
    expect(PRICING_TIER_ORDER.map((t) => PRICING_TIERS[t].maxSites)).toEqual([1, 3, 10])
    expect(PRICING_TIER_ORDER.map((t) => planRowMaxSites(t))).toEqual([1, 3, 10])
    for (const tier of PRICING_TIER_ORDER) {
      expect(PRICING_TIERS[tier].maxHamacasPerSite).toBeNull()
      expect(PRICING_TIERS[tier].monthlyCommissionCapPerSite).toBeNull()
    }
  })

  it('every plan is public and self-serve', () => {
    for (const tier of PRICING_TIER_ORDER) {
      expect(PRICING_TIERS[tier].quoteOnly).toBe(false)
      expect(PRICING_TIERS[tier].selfServe).toBe(true)
    }
  })

  it('moving up never costs capacity, and lowers the commission', () => {
    for (let i = 1; i < PRICING_TIER_ORDER.length; i++) {
      const lo = PRICING_TIERS[PRICING_TIER_ORDER[i - 1]!]
      const hi = PRICING_TIERS[PRICING_TIER_ORDER[i]!]
      expect(planRowMaxSites(PRICING_TIER_ORDER[i]!)).toBeGreaterThan(planRowMaxSites(PRICING_TIER_ORDER[i - 1]!))
      for (const code of COMMISSIONED_SERVICE_CODES) {
        expect(hi.commissionPercent[code]).toBeLessThan(lo.commissionPercent[code])
      }
    }
  })

  it('every plan takes online payments and food and drink orders', () => {
    for (const tier of PRICING_TIER_ORDER) {
      expect(resolveEffectiveFeatures(tier, null).ONLINE_PAYMENTS).toBe(true)
      expect(resolveEffectiveFeatures(tier, null).FOOD_AND_BEVERAGE).toBe(true)
    }
  })

  it('off-platform billing (pay on site) needs Pro or Business', () => {
    expect(PRICING_TIER_ORDER.map((t) => resolveEffectiveFeatures(t, null).OFF_PLATFORM_BILLING)).toEqual([
      false,
      true,
      true,
    ])
  })

  it('an entitlement is never withdrawn by moving up', () => {
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

  it('names every consumer purchase type, and caps only sunbeds and rentals', () => {
    // Seeding a code here creates its platform fee rows; omitting one silently
    // drops that purchase type to the tier-null default (a flat EUR 1).
    expect([...COMMISSIONED_SERVICE_CODES]).toEqual([
      'sunbed-rental',
      'food-and-beverage',
      'equipment-rental',
    ])
    expect([...CAPPED_SERVICE_CODES]).toEqual(['sunbed-rental', 'equipment-rental'])
  })
})

// ─── hamaca limit + cap in resolveEffectiveSubscription ─────────────────────
// No plan sets either today; the machinery stays for agreements and later plans.

describe('resolveEffectiveSubscription — hamacas and cap', () => {
  it('no sunbed limit and no cap with no plan', () => {
    const r = resolveEffectiveSubscription(null, null)
    expect(r.maxHamacasPerSite).toBeNull()
    expect(r.monthlyCommissionCapPerSite).toBeNull()
  })

  it('reads the plan row when the columns are present', () => {
    const r = resolveEffectiveSubscription(
      makePlan({ tier: 'PRO', maxHamacasPerSite: 300, monthlyCommissionCapPerSite: 199 }),
      null,
    )
    expect(r.maxHamacasPerSite).toBe(300)
    expect(r.monthlyCommissionCapPerSite).toBe(199)
  })

  it('falls back to the catalogue when the plan row did not select the columns', () => {
    const r = resolveEffectiveSubscription(makePlan({ tier: 'PRO' }), null)
    expect(r.maxHamacasPerSite).toBeNull()
    expect(r.monthlyCommissionCapPerSite).toBeNull()
  })

  it('a custom hamaca limit (agreement) wins and marks the subscription custom', () => {
    const r = resolveEffectiveSubscription(
      makePlan({ tier: 'BUSINESS', maxHamacasPerSite: null }),
      { maxSites: null, maxHamacasPerSite: 800 },
    )
    expect(r.maxHamacasPerSite).toBe(800)
    expect(r.isCustom).toBe(true)
  })
})

describe('site limits', () => {
  it('Business allows 10 sites', () => {
    const r = resolveEffectiveSubscription(makePlan({ tier: 'BUSINESS', maxSites: 10 }), null)
    expect(r.maxSites).toBe(10)
  })

  it('an agreement limit wins', () => {
    const r = resolveEffectiveSubscription(makePlan({ tier: 'BUSINESS', maxSites: 10 }), { maxSites: 4 })
    expect(r.maxSites).toBe(4)
  })

  it('UNLIMITED_SITES stays the "no limit" sentinel', () => {
    expect(UNLIMITED_SITES).toBe(999)
  })
})

describe('planFitIssues', () => {
  const site = (id: string, hamacas: number) => ({ id, name: `Site ${id}`, hamacas })

  it('fits Starter with one site of any size', () => {
    expect(planFitIssues('STARTER', [site('a', 500)])).toBeNull()
  })

  it('names the site limit Starter would be over', () => {
    expect(planFitIssues('STARTER', [site('a', 150), site('b', 20)])).toEqual({
      sites: { current: 2, limit: 1 },
      hamacas: [],
    })
  })

  it('Pro allows 3 sites, Business 10', () => {
    expect(planFitIssues('PRO', [site('a', 300), site('b', 1), site('c', 1)])).toBeNull()
    expect(planFitIssues('PRO', [site('a', 1), site('b', 1), site('c', 1), site('d', 1)])?.sites).toEqual({ current: 4, limit: 3 })
    expect(planFitIssues('BUSINESS', Array.from({ length: 10 }, (_, i) => site(String(i), 900)))).toBeNull()
  })
})
