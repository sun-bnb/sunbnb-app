import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/app/auth', () => ({ auth: vi.fn() }))
vi.mock('@/app/flags', () => ({ isFlagEnabled: vi.fn().mockResolvedValue(true) }))
vi.mock('@repo/data/payment', () => ({ processChargedTableDeposit: vi.fn() }))
vi.mock('@/app/api/_lib/mollie', () => ({ refundDepositPayment: vi.fn() }))
vi.mock('@repo/data/email', () => ({ sendEmail: vi.fn() }))
vi.mock('../queries', () => ({ getRestaurantWaitlist: vi.fn() }))
// Partial-mock core: keep the real operational fns (markSeated / markNoShow /
// cancelReservationAsStaff …) but stub the waitlist helpers the new actions use.
vi.mock('@repo/table-reservations-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@repo/table-reservations-core')>()
  return {
    ...actual,
    findWaitlistCandidateForFreedReservation: vi.fn(),
    markWaitlistNotified: vi.fn(),
    removeWaitlistEntryAsStaff: vi.fn(),
  }
})

import prisma from '@repo/data/PrismaCient'
import { auth } from '@/app/auth'
import { processChargedTableDeposit } from '@repo/data/payment'
import { sendEmail } from '@repo/data/email'
import { getRestaurantWaitlist } from '../queries'
import {
  findWaitlistCandidateForFreedReservation,
  markWaitlistNotified,
  removeWaitlistEntryAsStaff,
} from '@repo/table-reservations-core'
import {
  getRestaurantReservationsForDay,
  markRestaurantReservationSeated,
  markRestaurantReservationDeparted,
  markRestaurantReservationNoShow,
  cancelRestaurantReservation,
  setRestaurantReservationNotes,
  chargeRestaurantReservationDeposit,
  getRestaurantWaitlistForDay,
  removeRestaurantWaitlistEntry,
} from './actions'

const mockAuth = vi.mocked(auth)
const RESTAURANT_ID = 'restaurant-1'
const OWNER_ID = 'user-1'
const RESERVATION_ID = 'res-1'

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue(null as any)
})

// ─────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────

function authorizeOwner() {
  mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ sudo: false } as any)
  // requireRestaurantOwnerWithFlag → requireRestaurantOwner → ownership check
  vi.mocked(prisma.restaurant.findUnique).mockResolvedValueOnce({
    partnerAccountId: OWNER_ID,
  } as any)
}

/**
 * The core helpers (markSeated / markDeparted / markNoShow /
 * cancelReservationAsStaff / updateReservationInternalNotes) verify that the
 * reservation belongs to a restaurant owned by the caller.
 */
function reservationOwnedByPartner() {
  vi.mocked(prisma.tableReservation.findUnique).mockResolvedValueOnce({
    restaurant: { partnerAccountId: OWNER_ID },
  } as any)
}

// ─────────────────────────────────────────────────────
// getRestaurantReservationsForDay
// ─────────────────────────────────────────────────────

describe('getRestaurantReservationsForDay', () => {
  it('rejects unauthenticated', async () => {
    const res = await getRestaurantReservationsForDay(RESTAURANT_ID, '2026-05-01')
    expect(res.status).toBe('error')
    if (res.status === 'error') expect(res.errors).toContain('Not authenticated')
  })

  it('rejects an invalid date format', async () => {
    authorizeOwner()
    const res = await getRestaurantReservationsForDay(RESTAURANT_ID, 'bad-date')
    expect(res.status).toBe('error')
    if (res.status === 'error') expect(res.errors).toContain('Invalid date')
  })

  it('returns the day list on a valid date', async () => {
    authorizeOwner()
    vi.mocked(prisma.tableReservation.findMany).mockResolvedValue([
      { id: RESERVATION_ID, guestName: 'Alice' } as any,
    ])
    const res = await getRestaurantReservationsForDay(RESTAURANT_ID, '2026-05-01')
    expect(res.status).toBe('ok')
    if (res.status === 'ok') {
      expect(res.reservations).toHaveLength(1)
    }
  })
})

// ─────────────────────────────────────────────────────
// markRestaurantReservationSeated
// ─────────────────────────────────────────────────────

describe('markRestaurantReservationSeated', () => {
  it('rejects when restaurant is not owned', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ sudo: false } as any)
    vi.mocked(prisma.restaurant.findUnique).mockResolvedValueOnce({
      partnerAccountId: 'someone-else',
    } as any)

    const res = await markRestaurantReservationSeated(RESTAURANT_ID, RESERVATION_ID)
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authorized')
  })

  it('rejects when the reservation is not found', async () => {
    authorizeOwner()
    vi.mocked(prisma.tableReservation.findUnique).mockResolvedValueOnce(null as any)

    const res = await markRestaurantReservationSeated(RESTAURANT_ID, RESERVATION_ID)
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not found')
  })

  it('sets operationalStatus to seated and records seatedAt', async () => {
    authorizeOwner()
    reservationOwnedByPartner()
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({ sudo: false } as any)
    vi.mocked(prisma.tableReservation.updateMany).mockResolvedValue({ count: 1 } as any)

    const res = await markRestaurantReservationSeated(RESTAURANT_ID, RESERVATION_ID)
    expect(res.status).toBe('ok')
    expect(prisma.tableReservation.updateMany).toHaveBeenCalledWith({
      where: { id: RESERVATION_ID },
      data: expect.objectContaining({
        operationalStatus: 'seated',
        seatedAt: expect.any(Date),
      }),
    })
  })
})

// ─────────────────────────────────────────────────────
// markRestaurantReservationDeparted
// ─────────────────────────────────────────────────────

describe('markRestaurantReservationDeparted', () => {
  it('sets operationalStatus to departed and records departedAt', async () => {
    authorizeOwner()
    reservationOwnedByPartner()
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({ sudo: false } as any)
    vi.mocked(prisma.tableReservation.updateMany).mockResolvedValue({ count: 1 } as any)

    const res = await markRestaurantReservationDeparted(RESTAURANT_ID, RESERVATION_ID)
    expect(res.status).toBe('ok')
    expect(prisma.tableReservation.updateMany).toHaveBeenCalledWith({
      where: { id: RESERVATION_ID },
      data: expect.objectContaining({
        operationalStatus: 'departed',
        departedAt: expect.any(Date),
      }),
    })
  })
})

// ─────────────────────────────────────────────────────
// markRestaurantReservationNoShow
// ─────────────────────────────────────────────────────

describe('markRestaurantReservationNoShow', () => {
  it('sets operationalStatus to no_show', async () => {
    authorizeOwner()
    reservationOwnedByPartner()
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({ sudo: false } as any)
    vi.mocked(prisma.tableReservation.updateMany).mockResolvedValue({ count: 1 } as any)

    const res = await markRestaurantReservationNoShow(RESTAURANT_ID, RESERVATION_ID)
    expect(res.status).toBe('ok')
    expect(prisma.tableReservation.updateMany).toHaveBeenCalledWith({
      where: { id: RESERVATION_ID },
      data: { operationalStatus: 'no_show' },
    })
  })
})

// ─────────────────────────────────────────────────────
// cancelRestaurantReservation
// ─────────────────────────────────────────────────────

describe('cancelRestaurantReservation', () => {
  it('cancels a confirmed reservation', async () => {
    authorizeOwner()
    reservationOwnedByPartner()
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({ sudo: false } as any)
    vi.mocked(prisma.tableReservation.findUnique)
      .mockResolvedValueOnce({ status: 'confirmed' } as any)
      .mockResolvedValueOnce({ bookingGroupId: null } as any) // targetGroupWhere lookup
      .mockResolvedValueOnce({
        id: RESERVATION_ID,
        restaurantId: RESTAURANT_ID,
        tableId: null,
        userId: null,
        anonId: null,
        from: new Date(),
        to: new Date(),
        partySize: 2,
        status: 'canceled',
        operationalStatus: 'expected',
        guestName: 'Alice',
        guestEmail: 'alice@example.com',
        guestPhone: null,
        specialRequests: null,
        internalNotes: null,
        seatedAt: null,
        departedAt: null,
        createdAt: new Date(),
      } as any)
    vi.mocked(prisma.tableReservation.updateMany).mockResolvedValue({ count: 1 } as any)

    const res = await cancelRestaurantReservation(RESTAURANT_ID, RESERVATION_ID)
    expect(res.status).toBe('ok')
    expect(prisma.tableReservation.updateMany).toHaveBeenCalledWith({
      where: { id: RESERVATION_ID },
      data: { status: 'canceled' },
    })
  })
})

// ─────────────────────────────────────────────────────
// setRestaurantReservationNotes
// ─────────────────────────────────────────────────────

describe('setRestaurantReservationNotes', () => {
  it('saves internal notes', async () => {
    authorizeOwner()
    reservationOwnedByPartner()
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({ sudo: false } as any)
    vi.mocked(prisma.tableReservation.update).mockResolvedValue({} as any)

    const res = await setRestaurantReservationNotes(RESTAURANT_ID, RESERVATION_ID, 'VIP guest')
    expect(res.status).toBe('ok')
    expect(prisma.tableReservation.update).toHaveBeenCalledWith({
      where: { id: RESERVATION_ID },
      data: { internalNotes: 'VIP guest' },
    })
  })

  it('rejects notes over 2000 chars', async () => {
    authorizeOwner()

    const res = await setRestaurantReservationNotes(
      RESTAURANT_ID,
      RESERVATION_ID,
      'x'.repeat(2001),
    )
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toMatch(/too long/)
  })
})

// ─────────────────────────────────────────────────────
// chargeRestaurantReservationDeposit (no-show → invoice cascade)
// ─────────────────────────────────────────────────────

describe('chargeRestaurantReservationDeposit', () => {
  it('runs the @repo/data invoice cascade once the deposit is charged', async () => {
    authorizeOwner()
    vi.mocked(prisma.tableReservation.findUnique)
      .mockResolvedValueOnce({ restaurant: { partnerAccountId: OWNER_ID } } as any) // requireStaffOwner
      .mockResolvedValueOnce({ depositStatus: 'held' } as any) // chargeNoShowDeposit status check
      .mockResolvedValueOnce({ depositStatus: 'charged', depositAmount: 20 } as any) // action cascade gate
    vi.mocked(prisma.tableReservation.update).mockResolvedValue({} as any)

    const res = await chargeRestaurantReservationDeposit(RESTAURANT_ID, RESERVATION_ID)
    expect(res.status).toBe('ok')
    expect(processChargedTableDeposit).toHaveBeenCalledWith(RESERVATION_ID)
  })

  it('does not run the cascade when the booking has no held deposit', async () => {
    authorizeOwner()
    vi.mocked(prisma.tableReservation.findUnique)
      .mockResolvedValueOnce({ restaurant: { partnerAccountId: OWNER_ID } } as any) // requireStaffOwner
      .mockResolvedValueOnce({ depositStatus: 'none' } as any) // chargeNoShowDeposit no-op
      .mockResolvedValueOnce({ depositStatus: 'none', depositAmount: null } as any) // action gate
    vi.mocked(prisma.tableReservation.update).mockResolvedValue({} as any)

    const res = await chargeRestaurantReservationDeposit(RESTAURANT_ID, RESERVATION_ID)
    expect(res.status).toBe('ok')
    expect(processChargedTableDeposit).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────
// Waitlist actions
// ─────────────────────────────────────────────────────

describe('getRestaurantWaitlistForDay', () => {
  it('rejects unauthenticated', async () => {
    const res = await getRestaurantWaitlistForDay(RESTAURANT_ID, '2026-05-25')
    expect(res.status).toBe('error')
  })

  it('rejects an invalid date format', async () => {
    authorizeOwner()
    const res = await getRestaurantWaitlistForDay(RESTAURANT_ID, 'bad-date')
    expect(res.status).toBe('error')
    if (res.status === 'error') expect(res.errors).toContain('Invalid date')
  })

  it('returns the day waitlist on a valid date', async () => {
    authorizeOwner()
    vi.mocked(getRestaurantWaitlist).mockResolvedValue([
      { id: 'w1', guestName: 'Alice', partySize: 2 } as any,
    ])
    const res = await getRestaurantWaitlistForDay(RESTAURANT_ID, '2026-05-25')
    expect(res.status).toBe('ok')
    if (res.status === 'ok') expect(res.entries).toHaveLength(1)
  })
})

describe('removeRestaurantWaitlistEntry', () => {
  it('rejects unauthenticated', async () => {
    const res = await removeRestaurantWaitlistEntry(RESTAURANT_ID, 'w1')
    expect(res.status).toBe('error')
  })

  it('removes the entry via the core staff action', async () => {
    authorizeOwner()
    vi.mocked(removeWaitlistEntryAsStaff).mockResolvedValue({ status: 'ok' } as any)
    const res = await removeRestaurantWaitlistEntry(RESTAURANT_ID, 'w1')
    expect(res.status).toBe('ok')
    expect(removeWaitlistEntryAsStaff).toHaveBeenCalledWith('w1', OWNER_ID)
  })
})

describe('staff cancel/no-show auto-notifies the waitlist', () => {
  it('no-show emails the earliest matching waitlist guest + marks notified', async () => {
    authorizeOwner()
    reservationOwnedByPartner()
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({ sudo: false } as any)
    vi.mocked(prisma.tableReservation.updateMany).mockResolvedValue({ count: 1 } as any)
    vi.mocked(findWaitlistCandidateForFreedReservation).mockResolvedValue({
      id: 'w1',
      guestName: 'Alice',
      guestEmail: 'alice@example.com',
      dateISO: '2026-05-25',
      partySize: 2,
    } as any)
    // notifyWaitlistOnFreed loads the restaurant (name/slug/tagline) for the email.
    vi.mocked(prisma.restaurant.findUnique).mockResolvedValueOnce({
      name: 'Malaga Vento',
      slug: 'malaga-vento',
      tagline: null,
    } as any)

    const res = await markRestaurantReservationNoShow(RESTAURANT_ID, RESERVATION_ID)
    expect(res.status).toBe('ok')
    expect(sendEmail).toHaveBeenCalledTimes(1)
    expect(markWaitlistNotified).toHaveBeenCalledWith('w1')
  })

  it('does not notify when no waitlist candidate matches', async () => {
    authorizeOwner()
    reservationOwnedByPartner()
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({ sudo: false } as any)
    vi.mocked(prisma.tableReservation.updateMany).mockResolvedValue({ count: 1 } as any)
    vi.mocked(findWaitlistCandidateForFreedReservation).mockResolvedValue(null as any)

    const res = await markRestaurantReservationNoShow(RESTAURANT_ID, RESERVATION_ID)
    expect(res.status).toBe('ok')
    expect(sendEmail).not.toHaveBeenCalled()
  })
})
