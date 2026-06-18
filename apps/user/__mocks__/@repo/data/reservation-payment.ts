import { vi } from 'vitest'

/**
 * Unit-test mock for @repo/data/reservation-payment.
 *
 * The real module creates a Mollie payment over the network and writes the
 * reservation's paymentRef/status, so route/unit tests must use this stub.
 * Default: succeeds with a fake checkout URL. Override per-test with
 * mockResolvedValueOnce (e.g. an error reason) to exercise failure mapping.
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
