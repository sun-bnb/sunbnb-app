import { vi } from 'vitest'

export const promotionClockRuns = vi.fn().mockReturnValue(false)
export const grantLaunchPromotionIfEligible = vi.fn().mockResolvedValue(true)
export const getLaunchPromotion = vi.fn().mockResolvedValue(null)
export const stampPromotionClock = vi.fn().mockResolvedValue(false)
export const grantLaunchPromotion = vi.fn().mockResolvedValue(undefined)
export const revokeLaunchPromotion = vi.fn().mockResolvedValue(undefined)
export const listPromotionsForPlanSync = vi.fn().mockResolvedValue([])
