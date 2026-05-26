import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/auth', () => ({ auth: vi.fn() }))
vi.mock('@/app/flags', () => ({ isFlagEnabled: vi.fn().mockResolvedValue(true) }))
vi.mock('@repo/data/email', () => ({ sendEmail: vi.fn() }))
vi.mock('@/app/api/_lib/payment-provider', () => ({ issueRefund: vi.fn() }))
// Partial-mock core: keep the real pure helpers (isPastCancellationDeadline,
// DEPOSIT_STATUS, status constants) and stub only the DB-coupled writes the
// actions call, so the timeliness branch runs against the real deadline math.
vi.mock('@repo/table-reservations-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@repo/table-reservations-core')>()
  return {
    ...actual,
    cancelTableReservation: vi.fn(),
    refundDeposit: vi.fn(),
    modifyTableReservation: vi.fn(),
    findWaitlistCandidateForFreedReservation: vi.fn(),
    markWaitlistNotified: vi.fn(),
  }
})

import prisma from '@repo/data/PrismaCient'
import { auth } from '@/app/auth'
import { issueRefund } from '@/app/api/_lib/payment-provider'
import {
  cancelTableReservation,
  refundDeposit,
  modifyTableReservation,
  findWaitlistCandidateForFreedReservation,
  DEPOSIT_STATUS,
} from '@repo/table-reservations-core'
import { cancelTableBooking, modifyTableBooking } from './actions'

const mockAuth = vi.mocked(auth)
const ANON_ID = 'anon-1'
const RESERVATION_ID = 'res-1'
const RESTAURANT_ID = 'rest-1'
const HOUR = 60 * 60 * 1000

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue(null as any)
  vi.mocked(findWaitlistCandidateForFreedReservation).mockResolvedValue(null as any)
})

function reservation(overrides: Record<string, unknown> = {}) {
  return {
    id: RESERVATION_ID,
    restaurantId: RESTAURANT_ID,
    guestEmail: 'guest@example.com',
    guestName: 'Guest',
    from: new Date(Date.now() + 100 * 24 * HOUR),
    to: new Date(Date.now() + 100 * 24 * HOUR + 2 * HOUR),
    partySize: 2,
    specialRequests: null,
    depositStatus: DEPOSIT_STATUS.HELD,
    paymentRef: 'pi_demo_123',
    ...overrides,
  }
}

function restaurant(cancellationDeadlineHours: number | null) {
  vi.mocked(prisma.restaurant.findUnique).mockResolvedValue({
    name: 'Vento',
    slug: 'vento',
    tagline: null,
    cancellationDeadlineHours,
  } as any)
}

describe('cancelTableBooking — deposit refund timeliness', () => {
  it('refunds a held deposit when canceled before the deadline', async () => {
    vi.mocked(cancelTableReservation).mockResolvedValue({
      status: 'ok',
      reservation: reservation({ from: new Date(Date.now() + 100 * 24 * HOUR) }),
    } as any)
    restaurant(24)

    const res = await cancelTableBooking(RESERVATION_ID, ANON_ID)

    expect(res.status).toBe('ok')
    expect(issueRefund).toHaveBeenCalledWith('pi_demo_123')
    expect(refundDeposit).toHaveBeenCalledWith(RESERVATION_ID)
  })

  it('forfeits the deposit (no refund) when canceled after the deadline', async () => {
    // 24h deadline, booking starts in 1h → past the cancellation deadline.
    vi.mocked(cancelTableReservation).mockResolvedValue({
      status: 'ok',
      reservation: reservation({ from: new Date(Date.now() + 1 * HOUR) }),
    } as any)
    restaurant(24)

    const res = await cancelTableBooking(RESERVATION_ID, ANON_ID)

    expect(res.status).toBe('ok')
    expect(issueRefund).not.toHaveBeenCalled()
    expect(refundDeposit).not.toHaveBeenCalled()
  })

  it('always refunds when no cancellation deadline is configured', async () => {
    vi.mocked(cancelTableReservation).mockResolvedValue({
      status: 'ok',
      reservation: reservation({ from: new Date(Date.now() + 1 * HOUR) }),
    } as any)
    restaurant(null)

    const res = await cancelTableBooking(RESERVATION_ID, ANON_ID)

    expect(res.status).toBe('ok')
    expect(issueRefund).toHaveBeenCalledWith('pi_demo_123')
    expect(refundDeposit).toHaveBeenCalledWith(RESERVATION_ID)
  })

  it('does not attempt a refund when no deposit is held', async () => {
    vi.mocked(cancelTableReservation).mockResolvedValue({
      status: 'ok',
      reservation: reservation({ depositStatus: 'none', paymentRef: null }),
    } as any)
    restaurant(24)

    const res = await cancelTableBooking(RESERVATION_ID, ANON_ID)

    expect(res.status).toBe('ok')
    expect(issueRefund).not.toHaveBeenCalled()
    expect(refundDeposit).not.toHaveBeenCalled()
  })

  it('surfaces the core error and never refunds when the cancel itself fails', async () => {
    vi.mocked(cancelTableReservation).mockResolvedValue({
      status: 'error',
      errors: ['Not authorized'],
    } as any)

    const res = await cancelTableBooking(RESERVATION_ID, ANON_ID)

    expect(res.status).toBe('error')
    expect(res.errors).toEqual(['Not authorized'])
    expect(issueRefund).not.toHaveBeenCalled()
  })
})

describe('modifyTableBooking', () => {
  it('rejects when the caller has no identity (no session, no anonId)', async () => {
    const res = await modifyTableBooking({ reservationId: RESERVATION_ID, partySize: 4 })

    expect(res.status).toBe('error')
    expect(res.errors).toEqual(['Not authorized'])
    expect(modifyTableReservation).not.toHaveBeenCalled()
  })

  it('forwards parsed dates + identity to core and surfaces a late-modify rejection', async () => {
    // The deadline gate lives in core.modifyTableReservation; the action must
    // pass the change through faithfully and relay the rejection.
    vi.mocked(modifyTableReservation).mockResolvedValue({
      status: 'error',
      errors: ['Too late to modify this booking online — please contact the restaurant.'],
    } as any)
    const from = '2026-06-01T18:00:00.000Z'
    const to = '2026-06-01T20:00:00.000Z'

    const res = await modifyTableBooking({
      reservationId: RESERVATION_ID,
      fromIso: from,
      toIso: to,
      partySize: 4,
      tableId: 'table-9',
      anonId: ANON_ID,
    })

    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toContain('Too late')
    expect(modifyTableReservation).toHaveBeenCalledWith(
      RESERVATION_ID,
      { from: new Date(from), to: new Date(to), partySize: 4, tableId: 'table-9' },
      { userId: null, anonId: ANON_ID },
    )
  })
})
