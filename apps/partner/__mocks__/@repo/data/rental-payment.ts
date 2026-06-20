import { vi } from 'vitest'

/**
 * Unit-test mock for @repo/data/rental-payment.
 *
 * The real module creates a Mollie payment over the network (OAuth token
 * refresh + Mollie API fetch) and writes paymentRef/status on all bookings in
 * the group, so unit tests must use this stub. Defaults: create succeeds with a
 * fake checkout URL; reverify reports the payment complete. Override per-test
 * with mockResolvedValueOnce.
 */
export const createRentalBookingMolliePayment = vi.fn().mockResolvedValue({
  status: 'ok' as const,
  checkoutUrl: 'https://checkout.mollie.test/pay/tr_rental_test',
  paymentId: 'tr_rental_test',
})

export const getRentalBookingPaymentStatus = vi.fn().mockResolvedValue({
  status: 'ok' as const,
  providerStatus: 'paid',
  succeeded: true,
  failed: false,
})

export const reverifyAndFinalizeRentalBooking = vi.fn().mockResolvedValue({
  settled: 'complete' as const,
  providerStatus: 'paid',
})
