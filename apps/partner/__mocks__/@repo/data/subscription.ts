import { vi } from 'vitest'

export const syncStripeSubscription = vi.fn().mockResolvedValue(undefined)
export const handleSubscriptionCanceled = vi.fn().mockResolvedValue(undefined)
