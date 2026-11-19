import { vi } from 'vitest'

export const checkChargeAllowed = vi.fn().mockResolvedValue({ allowed: true })
export const checkFoodOrderingAllowed = vi.fn().mockResolvedValue({ allowed: true })
