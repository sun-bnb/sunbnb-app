import { vi } from 'vitest'

// Default: reservation created successfully.
// Individual tests override this with mockResolvedValueOnce to simulate conflict.
export const reserveWithConflictGuard = vi.fn().mockResolvedValue({
  outcome: 'created',
  reservationId: 'r1',
})

// Default: rental bookings created successfully.
// Individual tests override this with mockResolvedValueOnce to simulate unavailability.
export const createRentalBookingsWithGuard = vi.fn().mockResolvedValue({
  outcome: 'created',
  bookingIds: ['rb1'],
})
