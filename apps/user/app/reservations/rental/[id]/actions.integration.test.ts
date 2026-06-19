import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'

vi.mock('@/app/auth', () => ({
  auth: vi.fn().mockResolvedValue(null),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

vi.mock('@/app/api/_lib/payment-provider', () => ({
  issueRefund: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@repo/data/rental-emails', () => ({
  sendRentalCancellationEmail: vi.fn().mockResolvedValue(undefined),
  sendRentalConfirmationEmail: vi.fn().mockResolvedValue(undefined),
  sendRentalDueReminders: vi.fn().mockResolvedValue(0),
}))

import { cancelRentalBooking } from './actions'
import { auth } from '@/app/auth'
import { issueRefund } from '@/app/api/_lib/payment-provider'
import { cleanDatabase, disconnectDatabase, prisma } from '@/app/test/setup'
import {
  createTestUser,
  createTestSite,
  createTestRentalItem,
  createTestRentalBooking,
} from '@/app/test/fixtures'
import { RENTAL_CANCELED, RENTAL_COMPLETE, OP_PICKED_UP, OP_RESERVED } from '@repo/data/reservation-status'

const mockAuth = vi.mocked(auth)
const mockIssueRefund = vi.mocked(issueRefund)

// Valid UUID v4 for anon identity tests
const VALID_ANON_ID = '550e8400-e29b-41d4-a716-446655440000'
const WRONG_ANON_ID = '660e8400-e29b-41d4-a716-446655440001'

beforeEach(async () => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue(null)
  await cleanDatabase()
})

afterAll(async () => {
  await disconnectDatabase()
})

// ─── cancelRentalBooking ──────────────────────────────────────────────────────

describe('cancelRentalBooking (integration)', () => {

  it('sets booking status to canceled in DB for session owner', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    const item = await createTestRentalItem(site.id)
    const booking = await createTestRentalBooking(site.id, item.id, user.id, {
      status: 'pending',
      paymentRef: null,
    })

    mockAuth.mockResolvedValue({ user: { id: user.id } } as any)

    const res = await cancelRentalBooking(booking.id)

    expect(res.status).toBe('ok')
    const updated = await prisma.rentalBooking.findUnique({ where: { id: booking.id } })
    expect(updated!.status).toBe(RENTAL_CANCELED)
  })

  it('issues refund and cancels for a paid booking with real paymentRef', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    const item = await createTestRentalItem(site.id)
    const booking = await createTestRentalBooking(site.id, item.id, user.id, {
      status: RENTAL_COMPLETE,
      paymentRef: 'tr_realMollieRef',
    })

    mockAuth.mockResolvedValue({ user: { id: user.id } } as any)

    const res = await cancelRentalBooking(booking.id)

    expect(res.status).toBe('ok')
    expect(mockIssueRefund).toHaveBeenCalledWith('tr_realMollieRef')
    const updated = await prisma.rentalBooking.findUnique({ where: { id: booking.id } })
    expect(updated!.status).toBe(RENTAL_CANCELED)
  })

  it('does not issue refund for demo payment', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    const item = await createTestRentalItem(site.id)
    const booking = await createTestRentalBooking(site.id, item.id, user.id, {
      status: RENTAL_COMPLETE,
      paymentRef: 'pi_demo_1234567890',
    })

    mockAuth.mockResolvedValue({ user: { id: user.id } } as any)

    const res = await cancelRentalBooking(booking.id)

    expect(res.status).toBe('ok')
    expect(mockIssueRefund).not.toHaveBeenCalled()
    const updated = await prisma.rentalBooking.findUnique({ where: { id: booking.id } })
    expect(updated!.status).toBe(RENTAL_CANCELED)
  })

  it('cancels all bookings sharing the same paymentRef (group cancel, one refund)', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    const item = await createTestRentalItem(site.id)

    // Two bookings from the same payment (same paymentRef)
    const bookingA = await createTestRentalBooking(site.id, item.id, user.id, {
      status: RENTAL_COMPLETE,
      paymentRef: 'tr_groupRef',
      from: new Date('2025-08-01T10:00:00Z'),
      to: new Date('2025-08-02T10:00:00Z'),
    })
    const bookingB = await createTestRentalBooking(site.id, item.id, user.id, {
      status: RENTAL_COMPLETE,
      paymentRef: 'tr_groupRef',
      from: new Date('2025-08-02T10:00:00Z'),
      to: new Date('2025-08-03T10:00:00Z'),
    })

    mockAuth.mockResolvedValue({ user: { id: user.id } } as any)

    // Cancel via the first booking id
    const res = await cancelRentalBooking(bookingA.id)

    expect(res.status).toBe('ok')
    // Exactly one refund for the group
    expect(mockIssueRefund).toHaveBeenCalledTimes(1)
    expect(mockIssueRefund).toHaveBeenCalledWith('tr_groupRef')
    // Both bookings must be canceled
    const updatedA = await prisma.rentalBooking.findUnique({ where: { id: bookingA.id } })
    const updatedB = await prisma.rentalBooking.findUnique({ where: { id: bookingB.id } })
    expect(updatedA!.status).toBe(RENTAL_CANCELED)
    expect(updatedB!.status).toBe(RENTAL_CANCELED)
  })

  it('rejects foreign anonId — must not cancel another renter\'s booking', async () => {
    const owner = await createTestUser()
    const site = await createTestSite(owner.id)
    const item = await createTestRentalItem(site.id)
    const booking = await createTestRentalBooking(site.id, item.id, owner.id, {
      status: 'pending',
      anonId: VALID_ANON_ID,
      paymentRef: null,
    })

    // No session — attacker sends wrong anonId
    const res = await cancelRentalBooking(booking.id, WRONG_ANON_ID)

    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authorized')
    // Booking must remain unchanged
    const unchanged = await prisma.rentalBooking.findUnique({ where: { id: booking.id } })
    expect(unchanged!.status).toBe('pending')
  })

  it('allows anon owner to cancel their booking via matching anonId', async () => {
    const owner = await createTestUser()
    const site = await createTestSite(owner.id)
    const item = await createTestRentalItem(site.id)
    const booking = await createTestRentalBooking(site.id, item.id, owner.id, {
      status: 'pending',
      anonId: VALID_ANON_ID,
      paymentRef: null,
    })

    // No session — anon user provides matching anonId
    const res = await cancelRentalBooking(booking.id, VALID_ANON_ID)

    expect(res.status).toBe('ok')
    const updated = await prisma.rentalBooking.findUnique({ where: { id: booking.id } })
    expect(updated!.status).toBe(RENTAL_CANCELED)
  })

  it('rejects cancellation when booking has been picked up', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    const item = await createTestRentalItem(site.id)
    const booking = await createTestRentalBooking(site.id, item.id, user.id, {
      status: RENTAL_COMPLETE,
      operationalStatus: OP_PICKED_UP,
      paymentRef: 'tr_realRef',
    })

    mockAuth.mockResolvedValue({ user: { id: user.id } } as any)

    const res = await cancelRentalBooking(booking.id)

    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toContain('already been picked up')
    expect(mockIssueRefund).not.toHaveBeenCalled()
    const unchanged = await prisma.rentalBooking.findUnique({ where: { id: booking.id } })
    expect(unchanged!.status).toBe(RENTAL_COMPLETE)
  })

  it('returns ok idempotently when booking is already canceled', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    const item = await createTestRentalItem(site.id)
    const booking = await createTestRentalBooking(site.id, item.id, user.id, {
      status: RENTAL_CANCELED,
      paymentRef: null,
    })

    mockAuth.mockResolvedValue({ user: { id: user.id } } as any)

    const res = await cancelRentalBooking(booking.id)

    expect(res.status).toBe('ok')
    expect(mockIssueRefund).not.toHaveBeenCalled()
    // Status unchanged — still canceled
    const unchanged = await prisma.rentalBooking.findUnique({ where: { id: booking.id } })
    expect(unchanged!.status).toBe(RENTAL_CANCELED)
  })
})
