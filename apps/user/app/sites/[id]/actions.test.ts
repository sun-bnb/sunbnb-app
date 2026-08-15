import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/auth', () => ({
  auth: vi.fn().mockResolvedValue(null),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

vi.mock('@/service/availabilityService', () => ({
  getAvailability: vi.fn().mockResolvedValue([]),
  getAvailabilityForItems: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/app/api/_lib/payment-ids', () => ({
  isValidEntityId: vi.fn().mockReturnValue(true),
  isDemoPayment: vi.fn().mockReturnValue(false),
}))

import {
  saveReservationForMultipleItems,
  saveRentalBooking,
  findAnonReservation,
  findUserReservation,
  findAnonRentalBooking,
} from './actions'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import { getAvailabilityForItems } from '@/service/availabilityService'
import { isValidEntityId } from '@/app/api/_lib/payment-ids'
import { reserveWithConflictGuard, createRentalBookingsWithGuard } from '@repo/data/reservations'

const mockAuth = vi.mocked(auth)
const mockGetAvailability = vi.mocked(getAvailabilityForItems)
const mockIsValidEntityId = vi.mocked(isValidEntityId)
const mockReserveWithConflictGuard = vi.mocked(reserveWithConflictGuard)
const mockCreateRentalBookingsWithGuard = vi.mocked(createRentalBookingsWithGuard)

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue(null)
  mockIsValidEntityId.mockReturnValue(true)
  // Default: guards return created — override per test for conflict/unavailable scenarios
  mockReserveWithConflictGuard.mockResolvedValue({ outcome: 'created', reservationId: 'r1' })
  mockCreateRentalBookingsWithGuard.mockResolvedValue({ outcome: 'created', bookingIds: ['rb1'] })
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

  it('returns error when requested items are unavailable (present but not available)', async () => {
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

  // Guard: item ID absent from the availability set entirely (non-active seat,
  // pool overflow, cross-site ID, or bogus ID) must be rejected even though it
  // is not in the unavailable list — the old filter missed this case.
  it('returns error when a requested item ID is absent from the availability set', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    vi.mocked(prisma.site.findUnique).mockResolvedValue({
      id: 'site-1',
      type: 'paid',
      price: 10,
    } as any)
    // availability set only contains item-1; item-ghost is not a reservable seat
    mockGetAvailability.mockResolvedValue([
      { itemId: 'item-1', available: true },
    ] as any)

    const res = await saveReservationForMultipleItems({
      siteId: 'site-1',
      items: [{ id: 'item-1' } as any, { id: 'item-ghost' } as any],
      type: 'days',
      from: '2025-07-01',
      to: '2025-07-02',
    })
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toContain('not available')
  })

  // Confirm the legitimate path is unaffected: all requested IDs present AND available.
  it('allows reservation when all requested items are in the availability set and available', async () => {
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
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([
      { id: 'item-1', price: 10 },
      { id: 'item-2', price: 10 },
    ] as any)
    // Guard default: { outcome: 'created', reservationId: 'r1' } — set in beforeEach
    mockReserveWithConflictGuard.mockResolvedValueOnce({ outcome: 'created', reservationId: 'res-ok' })

    const res = await saveReservationForMultipleItems({
      siteId: 'site-1',
      items: [{ id: 'item-1' } as any, { id: 'item-2' } as any],
      type: 'days',
      from: '2025-07-01',
      to: '2025-07-02',
    })
    expect(res.status).toBe('ok')
    expect(res.id).toBe('res-ok')
  })

  // Confirm the present-but-unavailable case still rejects (no regression).
  it('rejects when one item is present in availability set but unavailable', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    vi.mocked(prisma.site.findUnique).mockResolvedValue({
      id: 'site-1',
      type: 'paid',
      price: 10,
    } as any)
    mockGetAvailability.mockResolvedValue([
      { itemId: 'item-1', available: true },
      { itemId: 'item-2', available: false }, // booked by someone else
    ] as any)

    const res = await saveReservationForMultipleItems({
      siteId: 'site-1',
      items: [{ id: 'item-1' } as any, { id: 'item-2' } as any],
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
    mockReserveWithConflictGuard.mockResolvedValueOnce({ outcome: 'created', reservationId: 'res-1' })

    const res = await saveReservationForMultipleItems({
      siteId: 'site-1',
      // Client-supplied prices are irrelevant — source must ignore them
      items: [{ id: 'item-1', price: 1 } as any, { id: 'item-2', price: 1 } as any],
      type: 'days',
      from: '2025-07-01',
      to: '2025-07-02', // inclusive last day → 2 days (Jul 1, 2)
    })

    expect(res.status).toBe('ok')
    expect(res.id).toBe('res-1')

    // item-1 DB price 15, item-2 falls back to site price 10 → 25 per day × 2 days = 50
    expect(mockReserveWithConflictGuard).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentAmount: 50,
        status: 'pending',
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
    mockReserveWithConflictGuard.mockResolvedValueOnce({ outcome: 'created', reservationId: 'res-1' })

    const res = await saveReservationForMultipleItems({
      siteId: 'site-1',
      items: [{ id: 'item-1' } as any],
      type: 'days',
      from: '2025-07-01',
      to: '2025-07-02',
    })

    expect(res.status).toBe('ok')
    expect(mockReserveWithConflictGuard).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentAmount: 0,
        status: 'complete',
      })
    )
  })

  it('uses site owner userId for anonymous reservations', async () => {
    // No session
    vi.mocked(prisma.site.findUnique)
      .mockResolvedValueOnce({ userId: 'owner-1' } as any) // anonymous FK lookup
      .mockResolvedValueOnce({ id: 'site-1', type: 'unpaid', price: null } as any)
    mockReserveWithConflictGuard.mockResolvedValueOnce({ outcome: 'created', reservationId: 'res-1' })

    const res = await saveReservationForMultipleItems({
      anonId: 'anon-1',
      siteId: 'site-1',
      type: 'days',
      from: '2025-07-01',
      to: '2025-07-02',
    })

    expect(res.status).toBe('ok')
    // Guard receives the site owner's userId (FK placeholder) and the anonId
    expect(mockReserveWithConflictGuard).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'owner-1',
        anonId: 'anon-1',
      })
    )
  })

  // ── Input validation tests ────────────────────────────────────────────────

  it('returns error when siteId has invalid format', async () => {
    mockIsValidEntityId.mockReturnValueOnce(false)

    const res = await saveReservationForMultipleItems({
      siteId: '../etc/passwd',
      type: 'days',
      from: '2025-07-01',
      to: '2025-07-02',
    })
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toContain('Invalid site ID')
  })

  it('returns error when items array exceeds 20', async () => {
    const items = Array.from({ length: 21 }, (_, i) => ({ id: `item-${i}` }) as any)

    const res = await saveReservationForMultipleItems({
      siteId: 'site-1',
      items,
      type: 'days',
      from: '2025-07-01',
      to: '2025-07-02',
    })
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toBe('Too many items')
  })

  it('returns error when an item ID has invalid format', async () => {
    mockIsValidEntityId
      .mockReturnValueOnce(true)  // siteId passes
      .mockReturnValueOnce(false) // first item fails

    const res = await saveReservationForMultipleItems({
      siteId: 'site-1',
      items: [{ id: '<script>' } as any],
      type: 'days',
      from: '2025-07-01',
      to: '2025-07-02',
    })
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toContain('Invalid item ID')
  })

  it('returns error when reservation type is invalid', async () => {
    const res = await saveReservationForMultipleItems({
      siteId: 'site-1',
      type: 'weekly',
      from: '2025-07-01',
      to: '2025-07-02',
    })
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toContain('Invalid reservation type')
  })

  it('returns error when anonId exceeds 36 characters', async () => {
    const res = await saveReservationForMultipleItems({
      anonId: 'a'.repeat(37),
      siteId: 'site-1',
      type: 'days',
      from: '2025-07-01',
      to: '2025-07-02',
    })
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toContain('Invalid anonymous ID')
  })

  it('returns error when date range exceeds 90 days', async () => {
    const res = await saveReservationForMultipleItems({
      siteId: 'site-1',
      type: 'days',
      from: '2025-07-01',
      to: '2025-10-05', // 96 days
    })
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toContain('90 days')
  })

  it('returns error when dates are invalid strings', async () => {
    const res = await saveReservationForMultipleItems({
      siteId: 'site-1',
      type: 'days',
      from: 'not-a-date',
      to: '2025-07-02',
    })
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toContain('Invalid date format')
  })

  // ── BUG-REVEALING TESTS ──────────────────────────────────────────────────

  // BUG: Client-supplied userId is trusted without session verification.
  // Line 32: `let reservationUserId = session?.user?.id ?? reservation.userId`
  // An unauthenticated attacker can pass `userId: 'victim-id'` and create
  // reservations under another user's account.
  it('rejects client-supplied userId when no session (prevents impersonation)', async () => {
    // No session, but passing someone else's userId
    // Action returns error before reaching the guard — no site lookup or guard call needed

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

  // Guard conflict path: guard returns conflict → action returns error with the
  // same "not available" message (matches the pre-guard availability-check message).
  it('returns error when the conflict guard reports a double-booking', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    vi.mocked(prisma.site.findUnique).mockResolvedValue({
      id: 'site-1',
      type: 'paid',
      price: 10,
    } as any)
    mockGetAvailability.mockResolvedValue([
      { itemId: 'item-1', available: true },
    ] as any)
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([
      { id: 'item-1', price: 10 },
    ] as any)
    // Guard re-checks inside the transaction and finds a conflict
    mockReserveWithConflictGuard.mockResolvedValueOnce({
      outcome: 'conflict',
      conflictingReservationId: 'existing-res',
    })

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

  // BUG: Empty items on a paid site creates reservation with paymentAmount: 0
  // This effectively bypasses payment for a paid site
  it('rejects reservation with no items on a paid site', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    vi.mocked(prisma.site.findUnique).mockResolvedValue({
      id: 'site-1',
      type: 'paid',
      price: 10,
    } as any)

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
  it('returns error when not authenticated and no anonId', async () => {
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

  it('returns error when site not found (authenticated path)', async () => {
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
    vi.mocked(prisma.site.findUnique).mockResolvedValue({ id: 'site-1', type: 'paid', rentalPaymentType: null } as any)
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

  it('creates booking with daily pricing (auth path)', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    vi.mocked(prisma.site.findUnique).mockResolvedValue({
      id: 'site-1',
      type: 'paid',
      rentalPaymentType: null,
    } as any)
    vi.mocked(prisma.rentalItem.findMany).mockResolvedValue([
      { id: 'ri-1', totalQuantity: 10, pricePerDay: 20, pricePerHour: 5 } as any,
    ])
    // Guard default returns created — set per-test to assert call args
    mockCreateRentalBookingsWithGuard.mockResolvedValueOnce({ outcome: 'created', bookingIds: ['rb-1'] })

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
    expect(mockCreateRentalBookingsWithGuard).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          totalPrice: 80,
          paymentAmount: 80,
          status: 'pending',
          userId: 'user-1',
        }),
      ])
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
    mockCreateRentalBookingsWithGuard.mockResolvedValueOnce({ outcome: 'created', bookingIds: ['rb-1'] })

    const res = await saveRentalBooking({
      siteId: 'site-1',
      items: [{ rentalItemId: 'ri-1', quantity: 1 }],
      durationType: 'hours',
      from: '2025-07-01T10:00:00Z',
      to: '2025-07-01T13:00:00Z', // 3 hours
    })

    expect(res.status).toBe('ok')
    // 5 per hour × 3 hours × 1 qty = 15
    expect(mockCreateRentalBookingsWithGuard).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ totalPrice: 15 }),
      ])
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
    mockCreateRentalBookingsWithGuard.mockResolvedValueOnce({ outcome: 'created', bookingIds: ['rb-1'] })

    await saveRentalBooking({
      siteId: 'site-1',
      items: [{ rentalItemId: 'ri-1', quantity: 1 }],
      durationType: 'days',
      from: '2025-07-01T10:00:00Z',
      to: '2025-07-02T10:00:00Z',
    })

    expect(mockCreateRentalBookingsWithGuard).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ status: 'complete' }),
      ])
    )
  })

  // ── Anonymous path ────────────────────────────────────────────────────────

  // Uses site owner's userId as FK, stores anonId + guestEmail on the booking.
  // Mirrors saveReservationForMultipleItems anonymous path exactly.
  it('anon path: uses site owner userId, stores anonId and guestEmail', async () => {
    // No session
    vi.mocked(prisma.site.findUnique)
      .mockResolvedValueOnce({ userId: 'owner-1' } as any) // anon FK lookup
      .mockResolvedValueOnce({ id: 'site-1', type: 'paid', rentalPaymentType: null } as any)
    vi.mocked(prisma.rentalItem.findMany).mockResolvedValue([
      { id: 'ri-1', totalQuantity: 10, pricePerDay: 15 } as any,
    ])
    mockCreateRentalBookingsWithGuard.mockResolvedValueOnce({ outcome: 'created', bookingIds: ['rb-anon-1'] })

    const res = await saveRentalBooking({
      siteId: 'site-1',
      items: [{ rentalItemId: 'ri-1', quantity: 1 }],
      durationType: 'days',
      from: '2025-07-01T10:00:00Z',
      to: '2025-07-02T10:00:00Z',
      anonId: 'anon-uuid-1234',
      guestEmail: 'guest@example.com',
    })

    expect(res.status).toBe('ok')
    expect(res.bookingIds).toEqual(['rb-anon-1'])
    // Guard receives owner FK + anonId + guestEmail
    expect(mockCreateRentalBookingsWithGuard).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          userId: 'owner-1',
          anonId: 'anon-uuid-1234',
          guestEmail: 'guest@example.com',
        }),
      ])
    )
  })

  it('anon path: also passes guestContact when provided', async () => {
    vi.mocked(prisma.site.findUnique)
      .mockResolvedValueOnce({ userId: 'owner-1' } as any)
      .mockResolvedValueOnce({ id: 'site-1', type: 'paid', rentalPaymentType: null } as any)
    vi.mocked(prisma.rentalItem.findMany).mockResolvedValue([
      { id: 'ri-1', totalQuantity: 5, pricePerDay: 10 } as any,
    ])
    mockCreateRentalBookingsWithGuard.mockResolvedValueOnce({ outcome: 'created', bookingIds: ['rb-1'] })

    await saveRentalBooking({
      siteId: 'site-1',
      items: [{ rentalItemId: 'ri-1', quantity: 1 }],
      durationType: 'days',
      from: '2025-07-01T10:00:00Z',
      to: '2025-07-02T10:00:00Z',
      anonId: 'anon-uuid-1234',
      guestContact: '+358401234567',
    })

    expect(mockCreateRentalBookingsWithGuard).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ guestContact: '+358401234567' }),
      ])
    )
  })

  it('anon path: returns error when site not found (anon FK lookup)', async () => {
    vi.mocked(prisma.site.findUnique).mockResolvedValueOnce(null) // anon FK lookup returns nothing

    const res = await saveRentalBooking({
      siteId: 'site-1',
      items: [{ rentalItemId: 'ri-1', quantity: 1 }],
      durationType: 'days',
      from: '2025-07-01T10:00:00Z',
      to: '2025-07-02T10:00:00Z',
      anonId: 'anon-uuid-1234',
    })
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toContain('Site not found')
  })

  // Guard unavailable path — mirrors the conflict guard path in sunbed action.
  it('returns error when the rental guard reports unavailability', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    vi.mocked(prisma.site.findUnique).mockResolvedValue({
      id: 'site-1',
      type: 'paid',
      rentalPaymentType: null,
    } as any)
    vi.mocked(prisma.rentalItem.findMany).mockResolvedValue([
      { id: 'ri-1', name: 'Kayak', totalQuantity: 2, pricePerDay: 30 } as any,
    ])
    // Guard finds quantity exceeded inside the transaction
    mockCreateRentalBookingsWithGuard.mockResolvedValueOnce({
      outcome: 'unavailable',
      rentalItemId: 'ri-1',
    })

    const res = await saveRentalBooking({
      siteId: 'site-1',
      items: [{ rentalItemId: 'ri-1', quantity: 3 }],
      durationType: 'days',
      from: '2025-07-01T10:00:00Z',
      to: '2025-07-02T10:00:00Z',
    })

    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toContain('Kayak')
  })

  // ── Input validation tests ────────────────────────────────────────────────

  it('returns error when rental siteId has invalid format', async () => {
    mockIsValidEntityId.mockReturnValueOnce(false)

    const res = await saveRentalBooking({
      siteId: '../etc/passwd',
      items: [{ rentalItemId: 'ri-1', quantity: 1 }],
      durationType: 'days',
      from: '2025-07-01T10:00:00Z',
      to: '2025-07-02T10:00:00Z',
    })
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toContain('Invalid site ID')
  })

  it('returns error when rental items array exceeds 20', async () => {
    const items = Array.from({ length: 21 }, (_, i) => ({ rentalItemId: `ri-${i}`, quantity: 1 }))

    const res = await saveRentalBooking({
      siteId: 'site-1',
      items,
      durationType: 'days',
      from: '2025-07-01T10:00:00Z',
      to: '2025-07-02T10:00:00Z',
    })
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toBe('Too many items')
  })

  it('returns error when durationType is invalid', async () => {
    const res = await saveRentalBooking({
      siteId: 'site-1',
      items: [{ rentalItemId: 'ri-1', quantity: 1 }],
      durationType: 'weeks',
      from: '2025-07-01T10:00:00Z',
      to: '2025-07-02T10:00:00Z',
    })
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toContain('Invalid duration type')
  })

  it('returns error when a rental item ID has invalid format', async () => {
    mockIsValidEntityId
      .mockReturnValueOnce(true)  // siteId passes
      .mockReturnValueOnce(false) // rentalItemId fails

    const res = await saveRentalBooking({
      siteId: 'site-1',
      items: [{ rentalItemId: '<script>', quantity: 1 }],
      durationType: 'days',
      from: '2025-07-01T10:00:00Z',
      to: '2025-07-02T10:00:00Z',
    })
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toContain('Invalid rental item ID')
  })

  it('returns error when quantity is zero', async () => {
    const res = await saveRentalBooking({
      siteId: 'site-1',
      items: [{ rentalItemId: 'ri-1', quantity: 0 }],
      durationType: 'days',
      from: '2025-07-01T10:00:00Z',
      to: '2025-07-02T10:00:00Z',
    })
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toContain('Invalid quantity')
  })

  it('returns error when quantity is a non-integer', async () => {
    const res = await saveRentalBooking({
      siteId: 'site-1',
      items: [{ rentalItemId: 'ri-1', quantity: 1.5 }],
      durationType: 'days',
      from: '2025-07-01T10:00:00Z',
      to: '2025-07-02T10:00:00Z',
    })
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toContain('Invalid quantity')
  })

  it('returns error when anonId exceeds 36 characters', async () => {
    const res = await saveRentalBooking({
      siteId: 'site-1',
      items: [{ rentalItemId: 'ri-1', quantity: 1 }],
      durationType: 'days',
      from: '2025-07-01T10:00:00Z',
      to: '2025-07-02T10:00:00Z',
      anonId: 'a'.repeat(37),
    })
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toContain('Invalid anonymous ID')
  })

  it('returns error when guestEmail is malformed', async () => {
    const res = await saveRentalBooking({
      siteId: 'site-1',
      items: [{ rentalItemId: 'ri-1', quantity: 1 }],
      durationType: 'days',
      from: '2025-07-01T10:00:00Z',
      to: '2025-07-02T10:00:00Z',
      anonId: 'anon-uuid-1234',
      guestEmail: 'not-an-email',
    })
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toContain('Invalid email address')
  })

  // ── Anon equipment booking — Phase 5a coverage ────────────────────────────
  // These tests verify the full anon equipment path that the UI now enables
  // (previously blocked by the !session?.user?.id guard in EquipmentBookingSection).

  // BUG this test reveals: if saveRentalBooking re-introduced a session-only guard
  // (e.g. `if (!session?.user?.id) return error`), this test would fail —
  // proving anon equipment bookings require the action to accept anonId.
  it('anon equipment path: succeeds for paid site with anonId + guestEmail (mirrors UI handleConfirmBooking output)', async () => {
    // No session — mirrors logged-out user clicking "Reserve as guest" in EquipmentBookingSection
    vi.mocked(prisma.site.findUnique)
      .mockResolvedValueOnce({ userId: 'venue-owner-1' } as any) // anon FK lookup
      .mockResolvedValueOnce({ id: 'site-1', type: 'paid', rentalPaymentType: null } as any)
    vi.mocked(prisma.rentalItem.findMany).mockResolvedValue([
      { id: 'kayak-1', totalQuantity: 3, pricePerDay: 25, pricePerHour: null } as any,
    ])
    mockCreateRentalBookingsWithGuard.mockResolvedValueOnce({ outcome: 'created', bookingIds: ['rb-anon-equipment-1'] })

    const res = await saveRentalBooking({
      siteId: 'site-1',
      items: [{ rentalItemId: 'kayak-1', quantity: 1 }],
      durationType: 'days',
      from: '2025-08-01T10:00:00Z',
      to: '2025-08-02T10:00:00Z',
      anonId: '550e8400-e29b-41d4-a716-446655440000', // valid UUID v4 from localStorage
      guestEmail: 'guest@beach.com',
    })

    expect(res.status).toBe('ok')
    expect(res.bookingIds).toEqual(['rb-anon-equipment-1'])
    expect(mockCreateRentalBookingsWithGuard).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          userId: 'venue-owner-1',           // site-owner FK placeholder
          anonId: '550e8400-e29b-41d4-a716-446655440000',
          guestEmail: 'guest@beach.com',
          totalPrice: 25,                    // 25/day × 1 day × 1 qty, from DB
          status: 'pending',                 // paid site → enters payment flow
        }),
      ])
    )
  })

  // BUG this test reveals: if the action required a session for hourly rentals,
  // an anon user booking surfboards by the hour would be incorrectly blocked.
  it('anon equipment path: succeeds for hourly rental with anonId', async () => {
    vi.mocked(prisma.site.findUnique)
      .mockResolvedValueOnce({ userId: 'venue-owner-1' } as any)
      .mockResolvedValueOnce({ id: 'site-1', type: 'paid', rentalPaymentType: null } as any)
    vi.mocked(prisma.rentalItem.findMany).mockResolvedValue([
      { id: 'surf-1', totalQuantity: 5, pricePerDay: null, pricePerHour: 8 } as any,
    ])
    mockCreateRentalBookingsWithGuard.mockResolvedValueOnce({ outcome: 'created', bookingIds: ['rb-anon-hourly-1'] })

    const res = await saveRentalBooking({
      siteId: 'site-1',
      items: [{ rentalItemId: 'surf-1', quantity: 2 }],
      durationType: 'hours',
      from: '2025-08-01T10:00:00Z',
      to: '2025-08-01T13:00:00Z', // 3 hours
      anonId: '550e8400-e29b-41d4-a716-446655440000',
      guestEmail: 'surfer@beach.com',
    })

    expect(res.status).toBe('ok')
    // 8/hour × 3 hours × 2 qty = 48
    expect(mockCreateRentalBookingsWithGuard).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          totalPrice: 48,
          anonId: '550e8400-e29b-41d4-a716-446655440000',
        }),
      ])
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

// ─── findAnonRentalBooking ─────────────────────────────────────────────────

describe('findAnonRentalBooking', () => {
  it('returns active booking matching anonId and siteId', async () => {
    const booking = { id: 'rb-1', anonId: 'anon-1', siteId: 'site-1', rentalItem: {}, site: {} }
    vi.mocked(prisma.rentalBooking.findFirst).mockResolvedValue(booking as any)

    const result = await findAnonRentalBooking('anon-1', 'site-1')
    expect(result).toEqual(booking)
    expect(prisma.rentalBooking.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          anonId: 'anon-1',
          siteId: 'site-1',
          status: 'complete',
        }),
      })
    )
  })

  it('returns null when no matching booking exists', async () => {
    vi.mocked(prisma.rentalBooking.findFirst).mockResolvedValue(null)
    const result = await findAnonRentalBooking('anon-1', 'site-1')
    expect(result).toBeNull()
  })

  // BUG-REVEALING: ensure the query scopes by both anonId and siteId.
  // If siteId were omitted, a booking on a different site would be returned.
  it('scopes query by both anonId and siteId (not just anonId)', async () => {
    vi.mocked(prisma.rentalBooking.findFirst).mockResolvedValue(null)

    await findAnonRentalBooking('anon-1', 'site-A')

    expect(prisma.rentalBooking.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          anonId: 'anon-1',
          siteId: 'site-A',
        }),
      })
    )
    // Verify siteId is actually in the where clause (not just anonId)
    const callArg = vi.mocked(prisma.rentalBooking.findFirst).mock.calls[0][0]
    expect((callArg as any).where.siteId).toBe('site-A')
  })

  it('only returns complete bookings (not pending or processing)', async () => {
    vi.mocked(prisma.rentalBooking.findFirst).mockResolvedValue(null)

    await findAnonRentalBooking('anon-1', 'site-1')

    const callArg = vi.mocked(prisma.rentalBooking.findFirst).mock.calls[0][0]
    expect((callArg as any).where.status).toBe('complete')
  })

  it('includes rentalItem and site in the result', async () => {
    const booking = { id: 'rb-1', anonId: 'anon-1', siteId: 'site-1', rentalItem: { id: 'ri-1' }, site: { id: 'site-1' } }
    vi.mocked(prisma.rentalBooking.findFirst).mockResolvedValue(booking as any)

    await findAnonRentalBooking('anon-1', 'site-1')

    expect(prisma.rentalBooking.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          rentalItem: true,
          site: true,
        }),
      })
    )
  })
})
