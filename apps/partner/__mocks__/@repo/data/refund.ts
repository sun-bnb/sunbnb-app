import { vi } from 'vitest'

/**
 * Unit-test mock for @repo/data/refund.
 *
 * issueReservationRefund hits Mollie over the network (and refreshes OAuth
 * tokens) in the real module, so unit tests must use this stub. Default:
 * succeeds as a Mollie refund. Override per-test with mockResolvedValueOnce —
 * e.g. `{ status: 'error', error: 'Mollie refund failed (422)' }`.
 */
export const issueReservationRefund = vi.fn().mockResolvedValue({
  status: 'ok' as const,
  provider: 'mollie' as const,
})
