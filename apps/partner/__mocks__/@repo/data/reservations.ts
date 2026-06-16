import { vi } from 'vitest'

/**
 * Unit-test mock for @repo/data/reservations.
 *
 * Default: returns { outcome: 'created', reservationId: 'r1' } — success path.
 * Tests that want the conflict path override per-test:
 *   vi.mocked(reserveWithConflictGuard).mockResolvedValueOnce({
 *     outcome: 'conflict', conflictingReservationId: 'existing-res-id',
 *   })
 *
 * The real implementation wraps check+create in a $transaction with a
 * SELECT ... FOR UPDATE lock — the PrismaCient mock cannot model that, so
 * all sunbed-reservation call sites must use this mock in unit tests.
 */
export const reserveWithConflictGuard = vi.fn().mockResolvedValue({
  outcome: 'created' as const,
  reservationId: 'r1',
})
