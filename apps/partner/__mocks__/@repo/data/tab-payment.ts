import { vi } from 'vitest'

/**
 * Unit-test mock for @repo/data/tab-payment.
 *
 * The real module reads from the DB and creates invoices, so unit tests must
 * use this stub. Default: processConfirmedTabPayment resolves (no-op);
 * calculateTabTotal returns a zero total. Override per-test with
 * mockResolvedValueOnce.
 */
export const processConfirmedTabPayment = vi.fn().mockResolvedValue(undefined)

export const calculateTabTotal = vi.fn().mockResolvedValue({
  ordersTotal: 0,
  serviceFee: 0,
  payableTotal: 0,
  orderIds: [],
})

// Dine-in v2: fee-context loaders (site-agnostic tab shape)
export const loadTabFeeContext = vi.fn().mockResolvedValue({
  siteFees: [],
  partnerAccount: null,
  settings: { serviceFees: [] },
  tier: null,
})
export const loadRestaurantFeeContext = vi.fn().mockResolvedValue({
  siteFees: [],
  partnerAccount: null,
  settings: { serviceFees: [] },
  tier: null,
})
