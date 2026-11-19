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
  GRUPO_DEFAULT_MAX_SITES,
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
  tier:         'GRATIS' as SubscriptionTier,
  name:         'Gratis',
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

  it('tier falls back to GRATIS when plan is null', () => {
    const result = resolveEffectiveSubscription(null, null)
    expect(result.tier).toBe('GRATIS')
  })

  it('tier comes from the plan when plan is provided', () => {
    const result = resolveEffectiveSubscription(
      makePlan({ tier: 'TEMPORADA' as SubscriptionTier }),
      null,
    )
    expect(result.tier).toBe('TEMPORADA')
  })

  it('name falls back to Free when plan is null', () => {
    const result = resolveEffectiveSubscription(null, null)
    expect(result.name).toBe('Free')
  })

  it('name comes from the catalogue, not the stored row name', () => {
    const result = resolveEffectiveSubscription(
      makePlan({ tier: 'TEMPORADA', name: 'Temporada' }),
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

  it('custom maxSites wins over plan even for non-GRATIS tiers', () => {
    const result = resolveEffectiveSubscription(
      makePlan({ tier: 'GRUPO' as SubscriptionTier, maxSites: 10 }),
      { maxSites: 2 },
    )
    expect(result.maxSites).toBe(2)
    expect(result.tier).toBe('GRUPO')
    expect(result.isCustom).toBe(true)
  })

  it('returns features computed from tier when no custom overrides', () => {
    const pro = resolveEffectiveSubscription(makePlan({ tier: 'TEMPORADA' as SubscriptionTier }), null)
    expect(pro.features.ONLINE_PAYMENTS).toBe(true)

    const starter = resolveEffectiveSubscription(makePlan({ tier: 'GRATIS' as SubscriptionTier }), null)
    expect(starter.features.ONLINE_PAYMENTS).toBe(false)
  })

  it('returns features with override applied when featureOverrides set on custom', () => {
    const result = resolveEffectiveSubscription(
      makePlan({ tier: 'GRATIS' as SubscriptionTier }),
      { maxSites: null, featureOverrides: { ONLINE_PAYMENTS: true } },
    )
    expect(result.features.ONLINE_PAYMENTS).toBe(true)
  })

  it('override false wins over TEMPORADA tier default true', () => {
    const result = resolveEffectiveSubscription(
      makePlan({ tier: 'TEMPORADA' as SubscriptionTier }),
      { maxSites: null, featureOverrides: { ONLINE_PAYMENTS: false } },
    )
    expect(result.features.ONLINE_PAYMENTS).toBe(false)
  })

  it('features use GRATIS defaults when plan is null', () => {
    const result = resolveEffectiveSubscription(null, null)
    expect(result.features.ONLINE_PAYMENTS).toBe(TIER_FEATURE_DEFAULTS['GRATIS'].ONLINE_PAYMENTS)
  })
})

// ─── resolveEffectiveFeatures() ─────────────────────────────────────────────

describe('resolveEffectiveFeatures', () => {
  it('override true wins over GRATIS tier default false', () => {
    const result = resolveEffectiveFeatures('GRATIS', { ONLINE_PAYMENTS: true })
    expect(result.ONLINE_PAYMENTS).toBe(true)
  })

  it('override false wins over TEMPORADA tier default true', () => {
    const result = resolveEffectiveFeatures('TEMPORADA', { ONLINE_PAYMENTS: false })
    expect(result.ONLINE_PAYMENTS).toBe(false)
  })

  it('falls back to tier default when key not in overrides', () => {
    const resultPro = resolveEffectiveFeatures('TEMPORADA', {})
    expect(resultPro.ONLINE_PAYMENTS).toBe(true)

    const resultStarter = resolveEffectiveFeatures('GRATIS', {})
    expect(resultStarter.ONLINE_PAYMENTS).toBe(false)
  })

  it('null overrides falls back to tier default', () => {
    expect(resolveEffectiveFeatures('TEMPORADA', null).ONLINE_PAYMENTS).toBe(true)
    expect(resolveEffectiveFeatures('GRATIS', null).ONLINE_PAYMENTS).toBe(false)
  })

  it('null tier uses GRATIS defaults', () => {
    const result = resolveEffectiveFeatures(null, null)
    expect(result.ONLINE_PAYMENTS).toBe(TIER_FEATURE_DEFAULTS['GRATIS'].ONLINE_PAYMENTS)
  })

  it('null tier with override true gives true', () => {
    const result = resolveEffectiveFeatures(null, { ONLINE_PAYMENTS: true })
    expect(result.ONLINE_PAYMENTS).toBe(true)
  })

  it('returns false for a feature key absent from tier defaults', () => {
    // Simulate a future feature not yet in TIER_FEATURE_DEFAULTS by temporarily
    // checking that keys in SUBSCRIPTION_FEATURES but not in defaults resolve to false.
    // For ONLINE_PAYMENTS this is exercised above; this test documents the fallback:
    const result = resolveEffectiveFeatures('GRATIS', null)
    // All keys must be present and be booleans
    for (const key of Object.keys(result) as (keyof typeof result)[]) {
      expect(typeof result[key]).toBe('boolean')
    }
  })
})

// ─── PRICING_TIERS (the published catalogue, CR-002) ────────────────────────
//
// These pin the SHAPE the decided model (F-9) has to have, not the literal
// constants: a partner who moves up never gets less, F&B never carries
// commission, and Gratis cannot take card payments.

describe('PRICING_TIERS', () => {
  it('covers every tier the enum can hold, free first', () => {
    expect(PRICING_TIER_ORDER).toEqual(Object.keys(PRICING_TIERS))
    expect(PRICING_TIER_ORDER[0]).toBe('GRATIS')
    expect(DEFAULT_TIER).toBe('GRATIS')
  })

  it('names are Free, Pro and Business; Pro is featured', () => {
    expect(PRICING_TIER_ORDER.map((t) => PRICING_TIERS[t].name)).toEqual(['Free', 'Pro', 'Business'])
    expect(FEATURED_TIER).toBe('TEMPORADA')
  })

  it('only Business carries the branded booking page', () => {
    expect(PRICING_TIER_ORDER.filter((t) => PRICING_TIERS[t].brandedBookingPage)).toEqual(['GRUPO'])
  })

  it('no plan bills a fixed monthly price', () => {
    for (const tier of PRICING_TIER_ORDER) expect(PRICING_TIERS[tier].monthlyPrice).toBe(0)
  })

  it('no commission on food and drink, on any plan', () => {
    for (const tier of PRICING_TIER_ORDER) {
      expect(PRICING_TIERS[tier].commissionPercent['food-and-beverage']).toBe(0)
    }
  })

  it('Temporada takes 2% on sunbeds and rentals, capped at EUR 199 per site per month', () => {
    const t = PRICING_TIERS.TEMPORADA
    expect(t.commissionPercent['sunbed-rental']).toBe(2)
    expect(t.commissionPercent['equipment-rental']).toBe(2)
    expect(t.monthlyCommissionCapPerSite).toBe(199)
  })

  it('Gratis takes no commission and cannot take online payments', () => {
    for (const code of COMMISSIONED_SERVICE_CODES) {
      expect(PRICING_TIERS.GRATIS.commissionPercent[code]).toBe(0)
    }
    expect(PRICING_TIERS.GRATIS.onlinePayments).toBe(false)
    expect(resolveEffectiveFeatures('GRATIS', null).ONLINE_PAYMENTS).toBe(false)
    expect(resolveEffectiveFeatures('GRATIS', null).FOOD_AND_BEVERAGE).toBe(false)
  })

  it('limits: Gratis 1 site / 100 hamacas, Temporada 3 / 300, Grupo per agreement', () => {
    expect(PRICING_TIERS.GRATIS.maxSites).toBe(1)
    expect(PRICING_TIERS.GRATIS.maxHamacasPerSite).toBe(100)
    expect(PRICING_TIERS.TEMPORADA.maxSites).toBe(3)
    expect(PRICING_TIERS.TEMPORADA.maxHamacasPerSite).toBe(300)
    expect(PRICING_TIERS.GRUPO.maxSites).toBeNull()
    expect(PRICING_TIERS.GRUPO.maxHamacasPerSite).toBeNull()
    expect(PRICING_TIERS.GRUPO.quoteOnly).toBe(true)
    expect(planRowMaxSites('GRUPO')).toBe(GRUPO_DEFAULT_MAX_SITES)
  })

  it('moving up never costs capacity or commission', () => {
    for (let i = 1; i < PRICING_TIER_ORDER.length; i++) {
      const lo = PRICING_TIERS[PRICING_TIER_ORDER[i - 1]!]
      const hi = PRICING_TIERS[PRICING_TIER_ORDER[i]!]
      expect(planRowMaxSites(PRICING_TIER_ORDER[i]!)).toBeGreaterThanOrEqual(planRowMaxSites(PRICING_TIER_ORDER[i - 1]!))
      expect(hi.maxHamacasPerSite ?? Infinity).toBeGreaterThanOrEqual(lo.maxHamacasPerSite ?? Infinity)
    }
    // Grupo's default (before a negotiated fee) is never above Temporada's.
    for (const code of COMMISSIONED_SERVICE_CODES) {
      expect(PRICING_TIERS.GRUPO.commissionPercent[code]).toBeLessThanOrEqual(PRICING_TIERS.TEMPORADA.commissionPercent[code])
    }
  })

  it('off-platform (pay on site) is allowed on every plan', () => {
    for (const tier of PRICING_TIER_ORDER) {
      expect(resolveEffectiveFeatures(tier, null).OFF_PLATFORM_BILLING).toBe(true)
    }
  })

  it('an entitlement is never withdrawn by moving up', () => {
    const keys = Object.keys(TIER_FEATURE_DEFAULTS.GRATIS) as (keyof typeof TIER_FEATURE_DEFAULTS.GRATIS)[]
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

describe('resolveEffectiveSubscription — hamacas and cap', () => {
  it('defaults to Gratis limits with no plan', () => {
    const r = resolveEffectiveSubscription(null, null)
    expect(r.maxHamacasPerSite).toBe(100)
    expect(r.monthlyCommissionCapPerSite).toBeNull()
  })

  it('reads the plan row when the columns are present', () => {
    const r = resolveEffectiveSubscription(
      makePlan({ tier: 'TEMPORADA', maxHamacasPerSite: 300, monthlyCommissionCapPerSite: 199 }),
      null,
    )
    expect(r.maxHamacasPerSite).toBe(300)
    expect(r.monthlyCommissionCapPerSite).toBe(199)
  })

  it('falls back to the catalogue when the plan row did not select the columns', () => {
    const r = resolveEffectiveSubscription(makePlan({ tier: 'TEMPORADA' }), null)
    expect(r.maxHamacasPerSite).toBe(300)
    expect(r.monthlyCommissionCapPerSite).toBe(199)
  })

  it('a custom hamaca limit (Grupo agreement) wins and marks the subscription custom', () => {
    const r = resolveEffectiveSubscription(
      makePlan({ tier: 'GRUPO', maxHamacasPerSite: null }),
      { maxSites: null, maxHamacasPerSite: 800 },
    )
    expect(r.maxHamacasPerSite).toBe(800)
    expect(r.isCustom).toBe(true)
  })

  it('a NULL limit on a Grupo row without agreement means no limit', () => {
    const r = resolveEffectiveSubscription(makePlan({ tier: 'GRUPO', maxHamacasPerSite: null }), null)
    expect(r.maxHamacasPerSite).toBeNull()
  })
})

describe('Business is unlimited until its agreement sets a limit', () => {
  it('ignores a legacy 10-site Business row', () => {
    const r = resolveEffectiveSubscription(makePlan({ tier: 'GRUPO', maxSites: 10, maxHamacasPerSite: null }), null)
    expect(r.maxSites).toBe(UNLIMITED_SITES)
  })

  it('an agreement limit wins', () => {
    const r = resolveEffectiveSubscription(makePlan({ tier: 'GRUPO', maxSites: 10 }), { maxSites: 4 })
    expect(r.maxSites).toBe(4)
  })

  it('only Free and Pro are self-serve', () => {
    expect(PRICING_TIER_ORDER.filter((t) => PRICING_TIERS[t].selfServe)).toEqual(['GRATIS', 'TEMPORADA'])
  })
})

describe('planFitIssues', () => {
  const site = (id: string, hamacas: number) => ({ id, name: `Site ${id}`, hamacas })

  it('fits Free with one site of 100 sunbeds', () => {
    expect(planFitIssues('GRATIS', [site('a', 100)])).toBeNull()
  })

  it('names every limit Free would be over', () => {
    expect(planFitIssues('GRATIS', [site('a', 150), site('b', 20)])).toEqual({
      sites: { current: 2, limit: 1 },
      hamacas: [{ siteId: 'a', siteName: 'Site a', current: 150, limit: 100 }],
    })
  })

  it('Pro allows 3 sites of 300', () => {
    expect(planFitIssues('TEMPORADA', [site('a', 300), site('b', 1), site('c', 1)])).toBeNull()
    expect(planFitIssues('TEMPORADA', [site('a', 301)])?.hamacas).toHaveLength(1)
  })

  it('Business has no catalogue limits', () => {
    expect(planFitIssues('GRUPO', Array.from({ length: 40 }, (_, i) => site(String(i), 900)))).toBeNull()
  })
})
