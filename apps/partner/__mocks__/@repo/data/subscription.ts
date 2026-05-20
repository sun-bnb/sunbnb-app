import { vi } from 'vitest'

export const syncStripeSubscription = vi.fn().mockResolvedValue(undefined)
export const handleSubscriptionCanceled = vi.fn().mockResolvedValue(undefined)
export const getPartnerSubscription = vi.fn().mockResolvedValue(null)
export const canCreateSite = vi.fn().mockResolvedValue({ allowed: true, currentCount: 0, maxSites: 1, tier: 'STARTER', overridden: false })
export const resolveEffectiveSubscription = vi.fn().mockImplementation(
  (plan: { tier: string; name: string; monthlyPrice: number; maxSites: number } | null,
   custom: { maxSites: number | null } | null) => ({
    tier: plan?.tier ?? 'STARTER',
    name: plan?.name ?? 'Starter',
    monthlyPrice: plan?.monthlyPrice ?? 0,
    maxSites: custom?.maxSites ?? plan?.maxSites ?? 1,
    isCustom: custom != null && custom.maxSites != null,
    features: { OFF_PLATFORM_BILLING: false },
  })
)
export const getEffectiveSubscriptionForUser = vi.fn().mockResolvedValue({
  tier: 'STARTER',
  name: 'Starter',
  monthlyPrice: 0,
  maxSites: 1,
  isCustom: false,
  features: { OFF_PLATFORM_BILLING: false },
})
