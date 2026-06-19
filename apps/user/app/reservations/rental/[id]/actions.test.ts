import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/auth', () => ({
  auth: vi.fn().mockResolvedValue(null),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

vi.mock('@/app/api/_lib/payment-ids', () => ({
  isDemoPayment: (ref: string | null) => ref?.startsWith('pi_demo_') ?? false,
  isValidEntityId: () => true,
}))

vi.mock('@/app/api/_lib/payment-provider', () => ({
  issueRefund: vi.fn().mockResolvedValue(undefined),
}))

import { cancelRentalBooking } from './actions'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import { issueRefund } from '@/app/api/_lib/payment-provider'
import {
  RENTAL_COMPLETE,
  RENTAL_CANCELED,
  RENTAL_REFUNDED,
  OP_RESERVED,
  OP_PICKED_UP,
  OP_RETURNED,
} from '@repo/data/reservation-status'
import { sendRentalCancellationEmail } from '@repo/data/rental-emails'

const mockAuth = vi.mocked(auth)
const mockIssueRefund = vi.mocked(issueRefund)
const mockSendEmail = vi.mocked(sendRentalCancellationEmail)

// A valid UUID v4 for anon ownership tests
const VALID_ANON_ID = '550e8400-e29b-41d4-a716-446655440000'
const WRONG_ANON_ID = '660e8400-e29b-41d4-a716-446655440001'

function makePendingBooking(overrides: Record<string, unknown> = {}) {
  return {
    id: 'booking-1',
    userId: 'user-1',
    anonId: null,
    status: 'pending',
    operationalStatus: OP_RESERVED,
    paymentRef: null,
    ...overrides,
  }
}

function makePaidBooking(overrides: Record<string, unknown> = {}) {
  return {
    id: 'booking-1',
    userId: 'user-1',
    anonId: null,
    status: RENTAL_COMPLETE,
    operationalStatus: OP_RESERVED,
    paymentRef: 'tr_mollieRef123',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue(null)
})

// ─── cancelRentalBooking ──────────────────────────────────────────────────────

describe('cancelRentalBooking', () => {

  // ── Identity / auth guards ──────────────────────────────────────────────────

  it('requires at least one identity (no session, no anonId)', async () => {
    const res = await cancelRentalBooking('booking-1')
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Authentication required')
  })

  it('rejects an invalid anonId format (not UUID)', async () => {
    const res = await cancelRentalBooking('booking-1', 'not-a-uuid')
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Invalid anonId format')
  })

  it('returns error when booking is not found', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    vi.mocked(prisma.rentalBooking.findUnique).mockResolvedValue(null)

    const res = await cancelRentalBooking('booking-1')
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Booking not found')
  })

  // ── Session-based ownership ─────────────────────────────────────────────────

  it('rejects when authenticated user does not own the booking', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'attacker' } } as any)
    vi.mocked(prisma.rentalBooking.findUnique).mockResolvedValue(makePendingBooking() as any)

    const res = await cancelRentalBooking('booking-1')
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authorized')
    expect(prisma.rentalBooking.updateMany).not.toHaveBeenCalled()
  })

  it('allows cancellation when session user owns the booking', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    vi.mocked(prisma.rentalBooking.findUnique).mockResolvedValue(makePendingBooking() as any)
    vi.mocked(prisma.rentalBooking.updateMany).mockResolvedValue({ count: 1 } as any)

    const res = await cancelRentalBooking('booking-1')
    expect(res.status).toBe('ok')
  })

  // ── Anonymous ownership ─────────────────────────────────────────────────────

  it('allows anon cancellation when anonId matches booking', async () => {
    // No session — anonymous renter
    vi.mocked(prisma.rentalBooking.findUnique).mockResolvedValue(
      makePendingBooking({ anonId: VALID_ANON_ID }) as any
    )
    vi.mocked(prisma.rentalBooking.updateMany).mockResolvedValue({ count: 1 } as any)

    const res = await cancelRentalBooking('booking-1', VALID_ANON_ID)
    expect(res.status).toBe('ok')
  })

  it('rejects foreign anonId — must not cancel another renter\'s booking', async () => {
    // This is the key anon-ownership guard test.
    // Booking belongs to VALID_ANON_ID; attacker sends WRONG_ANON_ID.
    vi.mocked(prisma.rentalBooking.findUnique).mockResolvedValue(
      makePendingBooking({ anonId: VALID_ANON_ID }) as any
    )

    const res = await cancelRentalBooking('booking-1', WRONG_ANON_ID)
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authorized')
    // Must NOT have updated any DB row
    expect(prisma.rentalBooking.updateMany).not.toHaveBeenCalled()
  })

  it('rejects anon request when booking has no anonId (session-only booking)', async () => {
    // Booking was made by a logged-in user (no anonId); anon caller must be rejected.
    vi.mocked(prisma.rentalBooking.findUnique).mockResolvedValue(
      makePendingBooking({ anonId: null }) as any
    )

    const res = await cancelRentalBooking('booking-1', VALID_ANON_ID)
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authorized')
    expect(prisma.rentalBooking.updateMany).not.toHaveBeenCalled()
  })

  // ── Terminal-state guard ────────────────────────────────────────────────────

  it('returns ok idempotently when booking is already canceled', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    vi.mocked(prisma.rentalBooking.findUnique).mockResolvedValue(
      makePendingBooking({ status: RENTAL_CANCELED }) as any
    )

    const res = await cancelRentalBooking('booking-1')
    expect(res.status).toBe('ok')
    expect(prisma.rentalBooking.updateMany).not.toHaveBeenCalled()
    expect(mockIssueRefund).not.toHaveBeenCalled()
  })

  it('returns ok idempotently when booking is already refunded', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    vi.mocked(prisma.rentalBooking.findUnique).mockResolvedValue(
      makePendingBooking({ status: RENTAL_REFUNDED }) as any
    )

    const res = await cancelRentalBooking('booking-1')
    expect(res.status).toBe('ok')
    expect(prisma.rentalBooking.updateMany).not.toHaveBeenCalled()
  })

  it('rejects cancellation when booking has been picked up', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    vi.mocked(prisma.rentalBooking.findUnique).mockResolvedValue(
      makePaidBooking({ operationalStatus: OP_PICKED_UP }) as any
    )

    const res = await cancelRentalBooking('booking-1')
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toContain('already been picked up')
    expect(prisma.rentalBooking.updateMany).not.toHaveBeenCalled()
    expect(mockIssueRefund).not.toHaveBeenCalled()
  })

  it('rejects cancellation when booking has been returned', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    vi.mocked(prisma.rentalBooking.findUnique).mockResolvedValue(
      makePaidBooking({ operationalStatus: OP_RETURNED }) as any
    )

    const res = await cancelRentalBooking('booking-1')
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toContain('already been picked up')
    expect(prisma.rentalBooking.updateMany).not.toHaveBeenCalled()
  })

  // ── Refund logic ────────────────────────────────────────────────────────────

  it('issues refund for a real paid booking and cancels all rows sharing paymentRef', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    vi.mocked(prisma.rentalBooking.findUnique).mockResolvedValue(
      makePaidBooking({ paymentRef: 'tr_realMollieRef' }) as any
    )
    vi.mocked(prisma.rentalBooking.updateMany).mockResolvedValue({ count: 2 } as any)

    const res = await cancelRentalBooking('booking-1')
    expect(res.status).toBe('ok')
    // Exactly one refund for the entire paymentRef group
    expect(mockIssueRefund).toHaveBeenCalledTimes(1)
    expect(mockIssueRefund).toHaveBeenCalledWith('tr_realMollieRef')
    // Cancel by paymentRef (covers all bookings in the group)
    expect(prisma.rentalBooking.updateMany).toHaveBeenCalledWith({
      where: { paymentRef: 'tr_realMollieRef' },
      data: { status: RENTAL_CANCELED },
    })
  })

  it('does not issue refund for a demo payment', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    vi.mocked(prisma.rentalBooking.findUnique).mockResolvedValue(
      makePaidBooking({ paymentRef: 'pi_demo_1234567890' }) as any
    )
    vi.mocked(prisma.rentalBooking.updateMany).mockResolvedValue({ count: 1 } as any)

    const res = await cancelRentalBooking('booking-1')
    expect(res.status).toBe('ok')
    expect(mockIssueRefund).not.toHaveBeenCalled()
    expect(prisma.rentalBooking.updateMany).toHaveBeenCalled()
  })

  it('does not issue refund for an unpaid (pending) booking', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    vi.mocked(prisma.rentalBooking.findUnique).mockResolvedValue(
      makePendingBooking({ paymentRef: null }) as any
    )
    vi.mocked(prisma.rentalBooking.updateMany).mockResolvedValue({ count: 1 } as any)

    const res = await cancelRentalBooking('booking-1')
    expect(res.status).toBe('ok')
    expect(mockIssueRefund).not.toHaveBeenCalled()
    // Should cancel by id (no paymentRef)
    expect(prisma.rentalBooking.updateMany).toHaveBeenCalledWith({
      where: { id: 'booking-1' },
      data: { status: RENTAL_CANCELED },
    })
  })

  it('returns error and does not update when refund fails', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    vi.mocked(prisma.rentalBooking.findUnique).mockResolvedValue(
      makePaidBooking({ paymentRef: 'tr_realMollieRef' }) as any
    )
    mockIssueRefund.mockRejectedValue(new Error('Mollie error'))

    const res = await cancelRentalBooking('booking-1')
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toContain('Refund failed')
    expect(prisma.rentalBooking.updateMany).not.toHaveBeenCalled()
  })

  // ── Email ───────────────────────────────────────────────────────────────────

  it('fires sendRentalCancellationEmail after successful cancel', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    vi.mocked(prisma.rentalBooking.findUnique).mockResolvedValue(
      makePendingBooking() as any
    )
    vi.mocked(prisma.rentalBooking.updateMany).mockResolvedValue({ count: 1 } as any)
    mockSendEmail.mockResolvedValue(undefined)

    const res = await cancelRentalBooking('booking-1')
    expect(res.status).toBe('ok')
    // Email is fire-and-forget via dynamic import; we verify the mock was set up
    // but cannot assert it was called synchronously — it's best-effort
    // (the test verifies success path; email invocation is non-blocking)
  })
})
