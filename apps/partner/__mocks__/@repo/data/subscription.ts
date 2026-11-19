import { vi } from 'vitest'

export const syncStripeSubscription = vi.fn().mockResolvedValue(undefined)
export const handleSubscriptionCanceled = vi.fn().mockResolvedValue(undefined)
export const getPartnerSubscription = vi.fn().mockResolvedValue(null)
export const canCreateSite = vi.fn().mockResolvedValue({ allowed: true, currentCount: 0, maxSites: 1, tier: 'GRATIS', overridden: false })
export const resolveEffectiveSubscription = vi.fn().mockImplementation(
  (plan: { tier: string; name: string; monthlyPrice: number; maxSites: number } | null,
   custom: { maxSites: number | null } | null) => ({
    tier: plan?.tier ?? 'GRATIS',
    name: plan?.name ?? 'Starter',
    monthlyPrice: plan?.monthlyPrice ?? 0,
    maxSites: custom?.maxSites ?? plan?.maxSites ?? 1,
    isCustom: custom != null && custom.maxSites != null,
    features: { OFF_PLATFORM_BILLING: false },
  })
)
export const getEffectiveSubscriptionForUser = vi.fn().mockResolvedValue({
  tier: 'GRATIS',
  name: 'Starter',
  monthlyPrice: 0,
  maxSites: 1,
  isCustom: false,
  features: { OFF_PLATFORM_BILLING: false, ONLINE_PAYMENTS: true, FOOD_AND_BEVERAGE: true },
})
export const setPartnerPlan = vi.fn().mockResolvedValue({ status: 'ok', tier: 'TEMPORADA', changed: true })
export const planFitIssues = vi.fn().mockReturnValue(null)
export const resolveEffectiveFeatures = vi.fn().mockReturnValue({ OFF_PLATFORM_BILLING: false })

// Constants mirrored from the real module (read by the assistant `inspect` features aspect).
export const SUBSCRIPTION_FEATURES = {
  OFF_PLATFORM_BILLING: {
    key: 'OFF_PLATFORM_BILLING',
    label: 'Off-platform billing',
    description: 'Allow availability-only (unpaid) sites',
  },
  ONLINE_PAYMENTS: {
    key: 'ONLINE_PAYMENTS',
    label: 'Online card payments',
    description: 'Guests can pay sunbed bookings and rentals online by card',
  },
  FOOD_AND_BEVERAGE: {
    key: 'FOOD_AND_BEVERAGE',
    label: 'Food and drink ordering',
    description: 'Menu, orders, tabs and table deposits',
  },
} as const
export const TIER_FEATURE_DEFAULTS = {
  GRATIS: { OFF_PLATFORM_BILLING: true, ONLINE_PAYMENTS: false, FOOD_AND_BEVERAGE: false },
  TEMPORADA: { OFF_PLATFORM_BILLING: true, ONLINE_PAYMENTS: true, FOOD_AND_BEVERAGE: true },
  GRUPO: { OFF_PLATFORM_BILLING: true, ONLINE_PAYMENTS: true, FOOD_AND_BEVERAGE: true },
} as const
