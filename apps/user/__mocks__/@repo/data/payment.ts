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
