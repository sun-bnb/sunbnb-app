import { vi } from 'vitest'

// DB-backed seat-label helpers are no-ops in unit tests (Prisma is mocked).
export const recomputeSeatLabels = vi.fn(async () => 0)
export const backfillAllSeatLabels = vi.fn(async () => 0)
