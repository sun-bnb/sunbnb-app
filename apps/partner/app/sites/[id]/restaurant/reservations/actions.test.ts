import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/app/auth', () => ({ auth: vi.fn() }))
vi.mock('@/app/flags', () => ({ isFlagEnabled: vi.fn().mockResolvedValue(true) }))

import prisma from '@repo/data/PrismaCient'
import { auth } from '@/app/auth'
import {
  getReservationsForDay,
  markReservationSeated,
  markReservationDeparted,
  markReservationNoShow,
  cancelReservationForSite,
  setReservationInternalNotes,
} from './actions'

const mockAuth = vi.mocked(auth)
const SITE_ID = 'site-1'
const OWNER_ID = 'user-1'
const RESTAURANT_ID = 'restaurant-1'
const RESERVATION_ID = 'res-1'

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue(null as any)
})

function authorizeOwner() {
  mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ sudo: false } as any)
  vi.mocked(prisma.site.findUnique)
    .mockResolvedValueOnce({ userId: OWNER_ID } as any)
    .mockResolvedValueOnce({ restaurantId: RESTAURANT_ID } as any)
}

/** Mock reservation → restaurant ownership chain used by the core helpers. */
function reservationOwnedByPartner() {
  vi.mocked(prisma.tableReservation.findUnique).mockResolvedValueOnce({
    restaurant: { partnerAccountId: OWNER_ID },
  } as any)
}

describe('getReservationsForDay', () => {
  it('rejects an invalid date', async () => {
    authorizeOwner()
    const res = await getReservationsForDay(SITE_ID, 'bad')
    expect(res.status).toBe('error')
  })

  it('returns the day list on a valid date', async () => {
    authorizeOwner()
    vi.mocked(prisma.tableReservation.findMany).mockResolvedValue([
      { id: RESERVATION_ID, guestName: 'Alice' } as any,
    ])
    const res = await getReservationsForDay(SITE_ID, '2026-05-01')
    expect(res.status).toBe('ok')
    if (res.status === 'ok') {
      expect(res.reservations).toHaveLength(1)
    }
  })
})

describe('markReservationSeated', () => {
  it('updates operationalStatus and seatedAt', async () => {
    authorizeOwner()
    reservationOwnedByPartner()
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({ sudo: false } as any)
    vi.mocked(prisma.tableReservation.update).mockResolvedValue({} as any)

    const res = await markReservationSeated(SITE_ID, RESERVATION_ID)
    expect(res.status).toBe('ok')
    expect(prisma.tableReservation.update).toHaveBeenCalledWith({
      where: { id: RESERVATION_ID },
      data: expect.objectContaining({
        operationalStatus: 'seated',
        seatedAt: expect.any(Date),
      }),
    })
  })

  it('rejects when the reservation is not found', async () => {
    authorizeOwner()
    vi.mocked(prisma.tableReservation.findUnique).mockResolvedValueOnce(null as any)

    const res = await markReservationSeated(SITE_ID, RESERVATION_ID)
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not found')
  })
})

describe('markReservationDeparted', () => {
  it('updates operationalStatus and departedAt', async () => {
    authorizeOwner()
    reservationOwnedByPartner()
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({ sudo: false } as any)
    vi.mocked(prisma.tableReservation.update).mockResolvedValue({} as any)

    const res = await markReservationDeparted(SITE_ID, RESERVATION_ID)
    expect(res.status).toBe('ok')
    expect(prisma.tableReservation.update).toHaveBeenCalledWith({
      where: { id: RESERVATION_ID },
      data: expect.objectContaining({
        operationalStatus: 'departed',
        departedAt: expect.any(Date),
      }),
    })
  })
})

describe('markReservationNoShow', () => {
  it('updates operationalStatus to no_show', async () => {
    authorizeOwner()
    reservationOwnedByPartner()
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({ sudo: false } as any)
    vi.mocked(prisma.tableReservation.update).mockResolvedValue({} as any)

    const res = await markReservationNoShow(SITE_ID, RESERVATION_ID)
    expect(res.status).toBe('ok')
    expect(prisma.tableReservation.update).toHaveBeenCalledWith({
      where: { id: RESERVATION_ID },
      data: { operationalStatus: 'no_show' },
    })
  })
})

describe('cancelReservationForSite', () => {
  it('cancels a confirmed reservation', async () => {
    authorizeOwner()
    reservationOwnedByPartner()
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({ sudo: false } as any)
    vi.mocked(prisma.tableReservation.findUnique)
      // second call: status lookup before the update
      .mockResolvedValueOnce({ status: 'confirmed' } as any)
      // third call: getTableReservationById after update
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
    vi.mocked(prisma.tableReservation.update).mockResolvedValue({} as any)

    const res = await cancelReservationForSite(SITE_ID, RESERVATION_ID)
    expect(res.status).toBe('ok')
    expect(prisma.tableReservation.update).toHaveBeenCalledWith({
      where: { id: RESERVATION_ID },
      data: { status: 'canceled' },
    })
  })
})

describe('setReservationInternalNotes', () => {
  it('saves notes', async () => {
    authorizeOwner()
    reservationOwnedByPartner()
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({ sudo: false } as any)
    vi.mocked(prisma.tableReservation.update).mockResolvedValue({} as any)

    const res = await setReservationInternalNotes(SITE_ID, RESERVATION_ID, 'VIP guest')
    expect(res.status).toBe('ok')
    expect(prisma.tableReservation.update).toHaveBeenCalledWith({
      where: { id: RESERVATION_ID },
      data: { internalNotes: 'VIP guest' },
    })
  })

  it('rejects notes over 2000 chars', async () => {
    authorizeOwner()

    const res = await setReservationInternalNotes(SITE_ID, RESERVATION_ID, 'x'.repeat(2001))
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toMatch(/too long/)
  })
})
