import { vi } from 'vitest'

// DB-backed checks are mocked (allowed by default). The pure helper is mirrored
// verbatim from packages/data/src/plan-gate.ts (importing the real module would pull in prisma).
export function canAddHamacas(limit: number | null, current: number, adding: number): boolean {
  if (adding <= 0 || limit == null) return true
  return current + adding <= limit
}

export const checkHamacaLimit = vi.fn().mockResolvedValue({ allowed: true, current: 0, limit: 100, adding: 0, tier: 'GRATIS' })
export const checkNewSiteHamacas = vi.fn().mockResolvedValue({ allowed: true, current: 0, limit: 100, adding: 0, tier: 'GRATIS' })
export const countHamacas = vi.fn().mockResolvedValue(0)
export const hamacaLimitMessage = (r: { current: number; limit: number | null }) =>
  `Your plan allows ${r.limit} hamacas per site and this site has ${r.current}. Existing sunbeds stay; upgrade your plan to add more.`
export const effectiveSubscriptionForPartnerUser = vi.fn().mockResolvedValue({
  tier: 'GRATIS',
  maxHamacasPerSite: 100,
  features: { OFF_PLATFORM_BILLING: true, ONLINE_PAYMENTS: false, FOOD_AND_BEVERAGE: false },
})
export const checkChargeAllowed = vi.fn().mockResolvedValue({ allowed: true })
export const checkFoodOrderingAllowed = vi.fn().mockResolvedValue({ allowed: true })
export const gateFor = vi.fn().mockReturnValue({ allowed: true })
