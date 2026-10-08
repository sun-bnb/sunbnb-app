import { vi } from 'vitest'

/** Unit-test mock for @repo/data/payment-providers/selection (touches prisma). */
export const syncEffectiveProvider = vi
  .fn()
  .mockResolvedValue({ selected: 'mollie', effective: 'mollie', changed: 0 })
