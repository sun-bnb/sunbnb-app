import { vi } from 'vitest'

export const grantLaunchPromotion = vi.fn().mockResolvedValue(undefined)
export const revokeLaunchPromotion = vi.fn().mockResolvedValue(undefined)
export const grantLaunchPromotionIfEligible = vi.fn().mockResolvedValue(true)
export const getLaunchPromotion = vi.fn().mockResolvedValue(null)
export const listPromotionsForPlanSync = vi.fn().mockResolvedValue([])
