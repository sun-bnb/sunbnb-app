import { vi } from 'vitest'

export const processConfirmedReservation = vi.fn().mockResolvedValue(undefined)
export const processConfirmedOrder = vi.fn().mockResolvedValue(undefined)
export const processConfirmedRentalBooking = vi.fn().mockResolvedValue(undefined)
export const processConfirmedTabPayment = vi.fn().mockResolvedValue(undefined)
export const calculateTabTotal = vi.fn().mockResolvedValue({
  ordersTotal: 0,
  serviceFee: 0,
  payableTotal: 0,
  orderIds: [],
})

export const loadFeeContext = vi.fn().mockResolvedValue({
  site: { id: 'site-1', serviceFees: [] },
  partnerAccount: {
    userId: 'partner-1',
    mollieAccessToken: null,
    mollieProfileId: null,
    subscription: null,
    serviceFees: [],
  },
  settings: { serviceFees: [] },
})

// Dine-in v2: site-agnostic tab fee context (siteFees [] = standalone shape)
export const loadTabFeeContext = vi.fn().mockResolvedValue({
  siteFees: [],
  partnerAccount: {
    userId: 'partner-1',
    mollieAccessToken: null,
    mollieProfileId: null,
    subscription: null,
    serviceFees: [],
  },
  settings: { serviceFees: [] },
  tier: null,
})
export const loadRestaurantFeeContext = vi.fn().mockResolvedValue({
  siteFees: [],
  partnerAccount: null,
  settings: { serviceFees: [] },
  tier: null,
})

export const resolveServiceFee = vi.fn().mockReturnValue(null)
export const calculateServiceFeeAmount = vi.fn().mockReturnValue(0)
export const round = vi.fn((n: number) => Math.round(n * 100) / 100)
