/**
 * Unit-test mock for @repo/data/reservation-machine-apply (the DB interpreter).
 *
 * The PURE model (@repo/data/reservation-machine — deriveState, TRANSITIONS,
 * resolveTransition) is aliased to the REAL source; only the DB-executing
 * interpreter is mocked. Default: every transition applies. Tests exercising
 * reject paths override per-call:
 *   vi.mocked(applyTransition).mockResolvedValueOnce({ outcome: 'rejected', ... })
 */
import { vi } from 'vitest'

export const applyTransition = vi.fn().mockResolvedValue({
  outcome: 'applied',
  transition: { event: 'mock', pre: 'create', post: {}, effects: [] },
  state: { kind: 'walkin', pay: 'settled', occ: 'present', released: false },
  newReservationId: 'new-res-id',
})
