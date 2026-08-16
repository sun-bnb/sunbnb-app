import { vi } from 'vitest'

// Track 021 P2: unit maintenance is DB-backed; a no-op in unit tests (Prisma is
// mocked). Integration tests exercise the real implementation.
export const ensurePlacedSeatsHaveUnits = vi.fn(async () => ({ created: 0 }))
export const findUnitlessPlacedSeats = vi.fn(async () => [])
