/**
 * Unit-test mock for @repo/data/reservation-machine-apply (the DB interpreter,
 * track 018). The pure model (@repo/data/reservation-machine) is aliased to the
 * REAL source. Default: every transition applies. Override per test:
 *   vi.mocked(applyTransition).mockResolvedValueOnce({ outcome: 'rejected', ... })
 */
import { vi } from 'vitest'

export const applyTransition = vi.fn().mockResolvedValue({
  outcome: 'applied',
  transition: { event: 'mock', pre: 'create', post: {}, effects: [] },
  state: { kind: 'online', pay: 'complete', occ: 'expected', released: false },
  data: { paymentRef: 'pi_demo_mock' },
})
