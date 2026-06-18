import { vi } from 'vitest'

/**
 * Unit-test mock for @repo/data/reservation-payment.
 *
 * The real module creates a Mollie payment over the network (and refreshes
 * OAuth tokens) and writes the reservation's paymentRef/status, so unit tests
 * must use this stub. Defaults: createReservationMolliePayment succeeds with a
 * fake checkout URL; getReservationPaymentStatus reports a paid Mollie payment.
 * Override per-test with mockResolvedValueOnce.
 */
export const createReservationMolliePayment = vi.fn().mockResolvedValue({
  status: 'ok' as const,
  checkoutUrl: 'https://checkout.mollie.test/pay/tr_test',
  paymentId: 'tr_test',
})

export const getReservationPaymentStatus = vi.fn().mockResolvedValue({
  status: 'ok' as const,
  providerStatus: 'paid',
  succeeded: true,
  failed: false,
})

export const reverifyAndFinalizeReservation = vi.fn().mockResolvedValue({
  settled: 'complete' as const,
  providerStatus: 'paid',
})
