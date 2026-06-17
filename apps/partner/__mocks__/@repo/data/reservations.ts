import { vi } from 'vitest'

/**
 * Unit-test mock for @repo/data/reservations.
 *
 * Default outcomes (override per-test with mockResolvedValueOnce):
 *
 * reserveWithConflictGuard      → { outcome: 'created', reservationId: 'r1' }
 * moveReservationWithConflictGuard → { outcome: 'moved' }
 * createRentalBookingsWithGuard → { outcome: 'created', bookingIds: ['rb1'] }
 *
 * The real implementations wrap their operations in a $transaction with
 * SELECT … FOR UPDATE — the PrismaCient mock cannot model that, so all
 * call sites must use this mock in unit tests.
 */
export const reserveWithConflictGuard = vi.fn().mockResolvedValue({
  outcome: 'created' as const,
  reservationId: 'r1',
})

export const moveReservationWithConflictGuard = vi.fn().mockResolvedValue({
  outcome: 'moved' as const,
})

export const createRentalBookingsWithGuard = vi.fn().mockResolvedValue({
  outcome: 'created' as const,
  bookingIds: ['rb1'],
})
