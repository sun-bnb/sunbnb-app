import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/auth', () => ({
  auth: vi.fn().mockResolvedValue(null),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

vi.mock('@/service/availabilityService', () => ({
  getAvailability: vi.fn().mockResolvedValue([]),
}))

import {
  saveReservationForMultipleItems,
  saveRentalBooking,
  findAnonReservation,
  findUserReservation,
} from './actions'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import { getAvailability } from '@/service/availabilityService'

const mockAuth = vi.mocked(auth)
const mockGetAvailability = vi.mocked(getAvailability)

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue(null)
})

// ─── saveReservationForMultipleItems ───────────────────────────────────────

describe('saveReservationForMultipleItems', () => {
  it('returns error when not authenticated and no anonId', async () => {
    const res = await saveReservationForMultipleItems({
      siteId: 'site-1',
      type: 'days',
      from: '2025-07-01',
      to: '2025-07-02',
    })
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Authentication required')
  })

  it('returns error when site not found (anonymous path)', async () => {
    vi.mocked(prisma.site.findUnique).mockResolvedValueOnce(null)

    const res = await saveReservationForMultipleItems({
      anonId: 'anon-1',
      siteId: 'site-1',
      type: 'days',
      from: '2025-07-01',
      to: '2025-07-02',
    })
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toContain('Site not found')
  })

  it('returns error when site not found (authenticated path)', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    vi.mocked(prisma.site.findUnique).mockResolvedValue(null)

    const res = await saveReservationForMultipleItems({
      siteId: 'site-1',
      type: 'days',
      from: '2025-07-01',
      to: '2025-07-02',
    })
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toContain('Site not found')
  })

  it('returns error when paid site has no price', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    vi.mocked(prisma.site.findUnique).mockResolvedValue({
      id: 'site-1',
      type: 'paid',
      price: null,
    } as any)

    const res = await saveReservationForMultipleItems({
      siteId: 'site-1',
      type: 'days',
      from: '2025-07-01',
      to: '2025-07-02',
    })
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toContain('price not set')
  })

  it('returns error when requested items are unavailable', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    vi.mocked(prisma.site.findUnique).mockResolvedValue({
      id: 'site-1',
      type: 'paid',
      price: 10,
    } as any)
    mockGetAvailability.mockResolvedValue([
      { itemId: 'item-1', available: false },
    ] as any)

    const res = await saveReservationForMultipleItems({
      siteId: 'site-1',
      items: [{ id: 'item-1' } as any],
      type: 'days',
      from: '2025-07-01',
      to: '2025-07-02',
    })
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toContain('not available')
  })

  it('creates reservation with correct payment amount using DB item prices', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    vi.mocked(prisma.site.findUnique).mockResolvedValue({
      id: 'site-1',
      type: 'paid',
      price: 10,
    } as any)
    mockGetAvailability.mockResolvedValue([
      { itemId: 'item-1', available: true },
      { itemId: 'item-2', available: true },
    ] as any)
    // DB prices — item-1 has its own price, item-2 has no price (falls back to site price)
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([
      { id: 'item-1', price: 15 },
      { id: 'item-2', price: null },
    ] as any)
    vi.mocked(prisma.reservation.create).mockResolvedValue({ id: 'res-1' } as any)

    const res = await saveReservationForMultipleItems({
      siteId: 'site-1',
      // Client-supplied prices are irrelevant — source must ignore them
      items: [{ id: 'item-1', price: 1 } as any, { id: 'item-2', price: 1 } as any],
      type: 'days',
      from: '2025-07-01',
      to: '2025-07-03', // 2 days
    })

    expect(res.status).toBe('ok')
    expect(res.id).toBe('res-1')

    // item-1 DB price 15, item-2 falls back to site price 10 → 25 per day × 2 days = 50
    expect(prisma.reservation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          paymentAmount: 50,
          status: 'pending',
        }),
      })
    )
  })

  it('creates reservation with zero amount for unpaid site', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    vi.mocked(prisma.site.findUnique).mockResolvedValue({
      id: 'site-1',
      type: 'unpaid',
      price: null,
    } as any)
    vi.mocked(prisma.reservation.create).mockResolvedValue({ id: 'res-1' } as any)

    const res = await saveReservationForMultipleItems({
      siteId: 'site-1',
      items: [{ id: 'item-1' } as any],
      type: 'days',
      from: '2025-07-01',
      to: '2025-07-02',
    })

    expect(res.status).toBe('ok')
    expect(prisma.reservation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          paymentAmount: 0,
          status: 'complete',
        }),
      })
    )
  })

  it('uses site owner userId for anonymous reservations', async () => {
    // No session
    vi.mocked(prisma.site.findUnique)
      .mockResolvedValueOnce({ userId: 'owner-1' } as any) // anonymous FK lookup
      .mockResolvedValueOnce({ id: 'site-1', type: 'unpaid', price: null } as any)
    vi.mocked(prisma.reservation.create).mockResolvedValue({ id: 'res-1' } as any)

    const res = await saveReservationForMultipleItems({
      anonId: 'anon-1',
      siteId: 'site-1',
      type: 'days',
      from: '2025-07-01',
      to: '2025-07-02',
    })

    expect(res.status).toBe('ok')
    expect(prisma.reservation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          anonId: 'anon-1',
          user: { connect: { id: 'owner-1' } },
        }),
      })
    )
  })

  // ── BUG-REVEALING TESTS ──────────────────────────────────────────────────

  // BUG: Client-supplied userId is trusted without session verification.
  // Line 32: `let reservationUserId = session?.user?.id ?? reservation.userId`
  // An unauthenticated attacker can pass `userId: 'victim-id'` and create
  // reservations under another user's account.
  it('rejects client-supplied userId when no session (prevents impersonation)', async () => {
    // No session, but passing someone else's userId
    vi.mocked(prisma.site.findUnique).mockResolvedValue({
      id: 'site-1',
      type: 'unpaid',
      price: null,
    } as any)
    vi.mocked(prisma.reservation.create).mockResolvedValue({ id: 'res-1' } as any)

    const res = await saveReservationForMultipleItems({
      userId: 'victim-user-id', // client-supplied — should NOT be trusted
      siteId: 'site-1',
      type: 'days',
      from: '2025-07-01',
      to: '2025-07-02',
    })

    // Should require auth or anonId — not accept bare userId from client
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Authentication required')
  })

  // BUG: No date validation — from >= to produces zero or negative paymentAmount
  it('rejects reservation where from >= to', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    vi.mocked(prisma.site.findUnique).mockResolvedValue({
      id: 'site-1',
      type: 'paid',
      price: 10,
    } as any)

    const res = await saveReservationForMultipleItems({
      siteId: 'site-1',
      items: [{ id: 'item-1' } as any],
      type: 'days',
      from: '2025-07-03',
      to: '2025-07-01', // before from
    })
    expect(res.status).toBe('error')
  })

  // BUG: Empty items on a paid site creates reservation with paymentAmount: 0
  // This effectively bypasses payment for a paid site
  it('rejects reservation with no items on a paid site', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    vi.mocked(prisma.site.findUnique).mockResolvedValue({
      id: 'site-1',
      type: 'paid',
      price: 10,
    } as any)
    vi.mocked(prisma.reservation.create).mockResolvedValue({ id: 'res-1' } as any)

    const res = await saveReservationForMultipleItems({
      siteId: 'site-1',
      // No items — totalPrice will be 0 on a paid site
      type: 'days',
      from: '2025-07-01',
      to: '2025-07-02',
    })

    // A paid site should not allow zero-amount reservations
    expect(res.status).toBe('error')
  })
})

// ─── saveRentalBooking ─────────────────────────────────────────────────────

describe('saveRentalBooking', () => {
  it('returns error when not authenticated', async () => {
    const res = await saveRentalBooking({
      siteId: 'site-1',
      items: [{ rentalItemId: 'ri-1', quantity: 1 }],
      durationType: 'days',
      from: '2025-07-01T10:00:00Z',
      to: '2025-07-02T10:00:00Z',
    })
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Authentication required')
  })

  it('returns error when site not found', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    vi.mocked(prisma.site.findUnique).mockResolvedValue(null)

    const res = await saveRentalBooking({
      siteId: 'site-1',
      items: [{ rentalItemId: 'ri-1', quantity: 1 }],
      durationType: 'days',
      from: '2025-07-01T10:00:00Z',
      to: '2025-07-02T10:00:00Z',
    })
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toContain('Site not found')
  })

  it('returns error when rental items not found', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    vi.mocked(prisma.site.findUnique).mockResolvedValue({ id: 'site-1' } as any)
    vi.mocked(prisma.rentalItem.findMany).mockResolvedValue([]) // none found

    const res = await saveRentalBooking({
      siteId: 'site-1',
      items: [{ rentalItemId: 'ri-1', quantity: 1 }],
      durationType: 'days',
      from: '2025-07-01T10:00:00Z',
      to: '2025-07-02T10:00:00Z',
    })
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toContain('not available')
  })

  it('returns error when quantity exceeds availability', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    vi.mocked(prisma.site.findUnique).mockResolvedValue({ id: 'site-1' } as any)
    vi.mocked(prisma.rentalItem.findMany).mockResolvedValue([
      { id: 'ri-1', totalQuantity: 5, pricePerDay: 10 } as any,
    ])
    vi.mocked(prisma.rentalBooking.aggregate).mockResolvedValue({
      _sum: { quantity: 4 },
    } as any)

    const res = await saveRentalBooking({
      siteId: 'site-1',
      items: [{ rentalItemId: 'ri-1', quantity: 3 }], // only 1 available
      durationType: 'days',
      from: '2025-07-01T10:00:00Z',
      to: '2025-07-02T10:00:00Z',
    })
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toContain('Only 1')
  })

  it('creates booking with daily pricing', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    vi.mocked(prisma.site.findUnique).mockResolvedValue({
      id: 'site-1',
      type: 'paid',
      rentalPaymentType: null,
    } as any)
    vi.mocked(prisma.rentalItem.findMany).mockResolvedValue([
      { id: 'ri-1', totalQuantity: 10, pricePerDay: 20, pricePerHour: 5 } as any,
    ])
    vi.mocked(prisma.rentalBooking.aggregate).mockResolvedValue({
      _sum: { quantity: 0 },
    } as any)
    vi.mocked(prisma.rentalBooking.create).mockResolvedValue({ id: 'rb-1' } as any)

    const res = await saveRentalBooking({
      siteId: 'site-1',
      items: [{ rentalItemId: 'ri-1', quantity: 2 }],
      durationType: 'days',
      from: '2025-07-01T10:00:00Z',
      to: '2025-07-03T10:00:00Z', // 2 days
    })

    expect(res.status).toBe('ok')
    expect(res.bookingIds).toEqual(['rb-1'])
    // 20 per day × 2 days × 2 qty = 80
    expect(prisma.rentalBooking.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          totalPrice: 80,
          status: 'pending',
        }),
      })
    )
  })

  it('creates booking with hourly pricing', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    vi.mocked(prisma.site.findUnique).mockResolvedValue({
      id: 'site-1',
      type: 'paid',
      rentalPaymentType: null,
    } as any)
    vi.mocked(prisma.rentalItem.findMany).mockResolvedValue([
      { id: 'ri-1', totalQuantity: 10, pricePerDay: null, pricePerHour: 5 } as any,
    ])
    vi.mocked(prisma.rentalBooking.aggregate).mockResolvedValue({
      _sum: { quantity: 0 },
    } as any)
    vi.mocked(prisma.rentalBooking.create).mockResolvedValue({ id: 'rb-1' } as any)

    const res = await saveRentalBooking({
      siteId: 'site-1',
      items: [{ rentalItemId: 'ri-1', quantity: 1 }],
      durationType: 'hours',
      from: '2025-07-01T10:00:00Z',
      to: '2025-07-01T13:00:00Z', // 3 hours
    })

    expect(res.status).toBe('ok')
    // 5 per hour × 3 hours × 1 qty = 15
    expect(prisma.rentalBooking.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          totalPrice: 15,
        }),
      })
    )
  })

  it('marks booking as complete for unpaid site', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    vi.mocked(prisma.site.findUnique).mockResolvedValue({
      id: 'site-1',
      type: 'unpaid',
      rentalPaymentType: null,
    } as any)
    vi.mocked(prisma.rentalItem.findMany).mockResolvedValue([
      { id: 'ri-1', totalQuantity: 10, pricePerDay: 10 } as any,
    ])
    vi.mocked(prisma.rentalBooking.aggregate).mockResolvedValue({
      _sum: { quantity: 0 },
    } as any)
    vi.mocked(prisma.rentalBooking.create).mockResolvedValue({ id: 'rb-1' } as any)

    await saveRentalBooking({
      siteId: 'site-1',
      items: [{ rentalItemId: 'ri-1', quantity: 1 }],
      durationType: 'days',
      from: '2025-07-01T10:00:00Z',
      to: '2025-07-02T10:00:00Z',
    })

    expect(prisma.rentalBooking.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'complete',
        }),
      })
    )
  })

  // ── BUG-REVEALING TESTS ──────────────────────────────────────────────────

  // BUG: No date validation — from >= to should be rejected
  it('rejects rental booking where from >= to', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    vi.mocked(prisma.site.findUnique).mockResolvedValue({
      id: 'site-1',
      type: 'paid',
      rentalPaymentType: null,
    } as any)
    vi.mocked(prisma.rentalItem.findMany).mockResolvedValue([
      { id: 'ri-1', totalQuantity: 10, pricePerDay: 20 } as any,
    ])
    vi.mocked(prisma.rentalBooking.aggregate).mockResolvedValue({
      _sum: { quantity: 0 },
    } as any)

    const res = await saveRentalBooking({
      siteId: 'site-1',
      items: [{ rentalItemId: 'ri-1', quantity: 1 }],
      durationType: 'days',
      from: '2025-07-03T10:00:00Z',
      to: '2025-07-01T10:00:00Z', // before from
    })
    expect(res.status).toBe('error')
  })
})

// ─── findAnonReservation / findUserReservation ─────────────────────────────

describe('findAnonReservation', () => {
  it('returns reservation matching anonId and itemId', async () => {
    const reservation = { id: 'res-1', anonId: 'anon-1', items: [], site: {} }
    vi.mocked(prisma.reservation.findFirst).mockResolvedValue(reservation as any)

    const result = await findAnonReservation('anon-1', 'item-1')
    expect(result).toEqual(reservation)
    expect(prisma.reservation.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          anonId: 'anon-1',
          status: 'complete',
        }),
      })
    )
  })

  it('returns null when no matching reservation', async () => {
    vi.mocked(prisma.reservation.findFirst).mockResolvedValue(null)
    const result = await findAnonReservation('anon-1', 'item-1')
    expect(result).toBeNull()
  })
})

describe('findUserReservation', () => {
  it('returns reservation matching userId and itemId', async () => {
    const reservation = { id: 'res-1', userId: 'user-1', items: [], site: {} }
    vi.mocked(prisma.reservation.findFirst).mockResolvedValue(reservation as any)

    const result = await findUserReservation('user-1', 'item-1')
    expect(result).toEqual(reservation)
    expect(prisma.reservation.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: 'user-1',
          status: 'complete',
        }),
      })
    )
  })
})
