/**
 * Mock for `@repo/data/device-claim`.
 *
 * The real module imports the Prisma client. The claim rules (register /
 * match / record a mismatch) are covered where they live
 * (`packages/data/src/device-claim.integration.test.ts`); what the HW route
 * tests assert is WHEN the claim runs — on the tracking throttle — not what it
 * decides.
 */
import { vi } from 'vitest'

export const applyDeviceClaim = vi.fn(async () => 'no-claim' as const)
