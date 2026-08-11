/**
 * Unit tests for app/frontdesk/actions.ts
 *
 * Covers: searchAllReservations (session-scoped search), and the reservation +
 * rental operational actions (checkInReservation, markDeparted, markNoShow,
 * cancelReservation, updateNotes, markRentalPickedUp, markRentalReturned,
 * cancelRentalBooking).
 *
 * Critical dimension: ownership. Every mutable action goes through
 * verifyReservationOwnership() or verifyRentalOwnership() — each checks
 * site.userId === session.user.id.  These tests are the regression guard the
 * allowlist entry relies on.
 *
 * Note on searchAllReservations cross-partner scoping: the siteId: { in: siteIds }
 * WHERE clause can only be proven with a real DB query — that proof lives in
 * actions.integration.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/auth', () => ({
  auth: vi.fn().mockResolvedValue(null),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

// Dynamic import '@repo/data/reservation-emails' inside cancelReservation is
// intercepted by the vitest alias → mock file.

import {
  searchAllReservations,
  checkInReservation,
  markDeparted,
  markNoShow,
  cancelReservation,
  updateNotes,
  markRentalPickedUp,
  markRentalReturned,
  cancelRentalBooking,
} from './actions'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import { applyTransition } from '@repo/data/reservation-machine-apply'
import { sendCancellationEmail } from '@repo/data/reservation-emails'
import {
  OP_EXPECTED,
  OP_CHECKED_IN,
  OP_WALKED_IN,
  OP_DEPARTED,
  OP_NO_SHOW,
  OP_RESERVED,
  OP_PICKED_UP,
  OP_RETURNED,
  RESERVATION_CANCELED,
  RENTAL_CANCELED,
} from '@repo/data/reservation-status'

const mockAuth = vi.mocked(auth)
const mockApply = vi.mocked(applyTransition)

const OWNER_ID = 'owner-1'
const OTHER_ID = 'other-1'
const SITE_ID = 'site-1'
const RES_ID = 'res-1'
const BOOKING_ID = 'booking-1'

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue(null)
  mockApply.mockResolvedValue({
    outcome: 'applied',
    transition: {} as any,
    state: { kind: 'online', pay: 'complete', occ: 'present', released: false },
  } as any)
})


// ─── State-machine mock helpers (track 018 P4 slice 2) ──────────────────────

const rejected = (event: string, state: Record<string, unknown> = { kind: 'online', pay: 'complete', occ: 'present' }) =>
  ({ outcome: 'rejected', state: { released: false, ...state }, event, reason: 'no matching transition (must-reject cell)' }) as any

// ─── Setup helpers ──────────────────────────────────────────────────────────

/**
 * Mock authenticated session as OWNER, with prisma.reservation.findUnique set
 * up to return a reservation owned by OWNER.
 *
 * verifyReservationOwnership fetches { siteId, operationalStatus, site: { userId } }
 * — note: no status field in the helper's select.
 */
function authenticateAsReservationOwner(operationalStatus: string = OP_EXPECTED) {
  mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
  vi.mocked(prisma.reservation.findUnique).mockResolvedValue({
    siteId: SITE_ID,
    operationalStatus,
    site: { userId: OWNER_ID },
  } as any)
}

function authenticateAsReservationNonOwner() {
  mockAuth.mockResolvedValue({ user: { id: OTHER_ID } } as any)
  vi.mocked(prisma.reservation.findUnique).mockResolvedValue({
    siteId: SITE_ID,
    operationalStatus: OP_EXPECTED,
    site: { userId: OWNER_ID }, // different from session user
  } as any)
}

/**
 * Mock authenticated session as OWNER for rental operations.
 * verifyRentalOwnership fetches { siteId, operationalStatus, site: { userId } }.
 */
function authenticateAsRentalOwner(operationalStatus: string = OP_RESERVED) {
  mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
  vi.mocked(prisma.rentalBooking.findUnique).mockResolvedValue({
    siteId: SITE_ID,
    operationalStatus,
    site: { userId: OWNER_ID },
  } as any)
}

function authenticateAsRentalNonOwner() {
  mockAuth.mockResolvedValue({ user: { id: OTHER_ID } } as any)
  vi.mocked(prisma.rentalBooking.findUnique).mockResolvedValue({
    siteId: SITE_ID,
    operationalStatus: OP_RESERVED,
    site: { userId: OWNER_ID }, // different from session user
  } as any)
}

// ─── searchAllReservations ──────────────────────────────────────────────────

describe('searchAllReservations', () => {
  it('returns empty results when not authenticated', async () => {
    // auth returns null by default (beforeEach)
    const res = await searchAllReservations('john')
    expect(res.sunbedReservations).toHaveLength(0)
    expect(res.rentalBookings).toHaveLength(0)
    // site.findMany must not be called — short-circuit on unauthenticated
    expect(vi.mocked(prisma.site.findMany)).not.toHaveBeenCalled()
  })

  it('returns empty results when query is blank (whitespace-only)', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    vi.mocked(prisma.site.findMany).mockResolvedValue([{ id: SITE_ID }] as any)

    const res = await searchAllReservations('   ')
    expect(res.sunbedReservations).toHaveLength(0)
    expect(res.rentalBookings).toHaveLength(0)
    // reservation.findMany must not be called — short-circuit on blank query
    expect(vi.mocked(prisma.reservation.findMany)).not.toHaveBeenCalled()
    expect(vi.mocked(prisma.rentalBooking.findMany)).not.toHaveBeenCalled()
  })

  it('returns empty results when partner has no sites', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    vi.mocked(prisma.site.findMany).mockResolvedValue([]) // no sites

    const res = await searchAllReservations('john')
    expect(res.sunbedReservations).toHaveLength(0)
    expect(res.rentalBookings).toHaveLength(0)
    expect(vi.mocked(prisma.reservation.findMany)).not.toHaveBeenCalled()
  })

  it('returns shaped sunbedReservation results', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    vi.mocked(prisma.site.findMany).mockResolvedValue([{ id: SITE_ID }] as any)

    const now = new Date()
    const checkedIn = new Date(now.getTime() - 60 * 60 * 1000)
    vi.mocked(prisma.reservation.findMany).mockResolvedValue([{
      id: RES_ID,
      from: now,
      to: now,
      type: 'days',
      status: 'complete',
      operationalStatus: OP_CHECKED_IN,
      guestName: 'John Doe',
      guestContact: '+358401234567',
      internalNotes: 'VIP',
      checkedInAt: checkedIn,
      departedAt: null,
      site: { id: SITE_ID, name: 'Beach Club' },
      user: { email: 'john@example.com' },
      _count: { items: 2 },
    }] as any)
    vi.mocked(prisma.rentalBooking.findMany).mockResolvedValue([])

    const res = await searchAllReservations('john')

    expect(res.sunbedReservations).toHaveLength(1)
    const s = res.sunbedReservations[0]
    expect(s.id).toBe(RES_ID)
    expect(s.type).toBe('sunbed')
    expect(s.guestName).toBe('John Doe')
    expect(s.guestEmail).toBe('john@example.com')
    expect(s.guestContact).toBe('+358401234567')
    expect(s.internalNotes).toBe('VIP')
    expect(s.siteName).toBe('Beach Club')
    expect(s.siteId).toBe(SITE_ID)
    expect(s.itemCount).toBe(2)
    expect(s.checkedInAt).toBe(checkedIn.toISOString())
    expect(s.departedAt).toBeNull()
    expect(res.rentalBookings).toHaveLength(0)
  })

  it('returns shaped rentalBooking results', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    vi.mocked(prisma.site.findMany).mockResolvedValue([{ id: SITE_ID }] as any)
    vi.mocked(prisma.reservation.findMany).mockResolvedValue([])

    const now = new Date()
    vi.mocked(prisma.rentalBooking.findMany).mockResolvedValue([{
      id: BOOKING_ID,
      from: now,
      to: now,
      quantity: 2,
      durationType: 'hours',
      totalPrice: 30.0,
      status: 'complete',
      operationalStatus: OP_PICKED_UP,
      guestName: 'Jane Smith',
      pickedUpAt: now,
      returnedAt: null,
      rentalItem: { id: 'ri-1', name: 'Surfboard', category: 'surfboard' },
      site: { id: SITE_ID, name: 'Beach Club' },
      user: { email: 'jane@example.com' },
    }] as any)

    const res = await searchAllReservations('jane')

    expect(res.rentalBookings).toHaveLength(1)
    const r = res.rentalBookings[0]
    expect(r.id).toBe(BOOKING_ID)
    expect(r.type).toBe('rental')
    expect(r.guestName).toBe('Jane Smith')
    expect(r.guestEmail).toBe('jane@example.com')
    expect(r.rentalItemName).toBe('Surfboard')
    expect(r.quantity).toBe(2)
    expect(r.totalPrice).toBe(30.0)
    expect(r.pickedUpAt).toBe(now.toISOString())
    expect(r.returnedAt).toBeNull()
    expect(res.sunbedReservations).toHaveLength(0)
  })

  it('scopes reservation + rental queries to owner siteIds', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    vi.mocked(prisma.site.findMany).mockResolvedValue([
      { id: 'site-a' },
      { id: 'site-b' },
    ] as any)
    vi.mocked(prisma.reservation.findMany).mockResolvedValue([])
    vi.mocked(prisma.rentalBooking.findMany).mockResolvedValue([])

    await searchAllReservations('test-guest')

    // The reservation query must include the owner's siteIds in its WHERE clause.
    // A unit-mock can only verify the WHERE shape; the real cross-partner isolation
    // proof lives in actions.integration.test.ts.
    const resWhere = vi.mocked(prisma.reservation.findMany).mock.calls[0][0]?.where as any
    expect(resWhere.siteId.in).toContain('site-a')
    expect(resWhere.siteId.in).toContain('site-b')

    const rentalWhere = vi.mocked(prisma.rentalBooking.findMany).mock.calls[0][0]?.where as any
    expect(rentalWhere.siteId.in).toContain('site-a')
    expect(rentalWhere.siteId.in).toContain('site-b')
  })

  it('filters out canceled reservations in the query', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    vi.mocked(prisma.site.findMany).mockResolvedValue([{ id: SITE_ID }] as any)
    vi.mocked(prisma.reservation.findMany).mockResolvedValue([])
    vi.mocked(prisma.rentalBooking.findMany).mockResolvedValue([])

    await searchAllReservations('test')

    const resWhere = vi.mocked(prisma.reservation.findMany).mock.calls[0][0]?.where as any
    expect(resWhere.status).toMatchObject({ not: RESERVATION_CANCELED })
  })
})

// ─── Reservation ops: ownership guard ──────────────────────────────────────

describe('frontdesk reservation actions — ownership guard', () => {
  it('checkInReservation: rejects unauthenticated caller', async () => {
    const res = await checkInReservation(RES_ID)
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authenticated')
    expect(vi.mocked(prisma.reservation.update)).not.toHaveBeenCalled()
  })

  it('checkInReservation: rejects non-owner', async () => {
    authenticateAsReservationNonOwner()
    const res = await checkInReservation(RES_ID)
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authorized')
    expect(vi.mocked(prisma.reservation.update)).not.toHaveBeenCalled()
  })

  it('checkInReservation: rejects when reservation not found (null → unauthorized)', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue(null)
    const res = await checkInReservation(RES_ID)
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authorized')
    expect(vi.mocked(prisma.reservation.update)).not.toHaveBeenCalled()
  })

  it('markDeparted: rejects unauthenticated caller', async () => {
    const res = await markDeparted(RES_ID)
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authenticated')
  })

  it('markDeparted: rejects non-owner', async () => {
    authenticateAsReservationNonOwner()
    const res = await markDeparted(RES_ID)
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authorized')
  })

  it('markNoShow: rejects unauthenticated caller', async () => {
    const res = await markNoShow(RES_ID)
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authenticated')
  })

  it('markNoShow: rejects non-owner', async () => {
    authenticateAsReservationNonOwner()
    const res = await markNoShow(RES_ID)
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authorized')
  })

  it('cancelReservation: rejects unauthenticated caller', async () => {
    const res = await cancelReservation(RES_ID)
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authenticated')
  })

  it('cancelReservation: rejects non-owner', async () => {
    authenticateAsReservationNonOwner()
    const res = await cancelReservation(RES_ID)
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authorized')
  })

  it('updateNotes: rejects unauthenticated caller', async () => {
    const res = await updateNotes(RES_ID, 'notes')
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authenticated')
  })

  it('updateNotes: rejects non-owner', async () => {
    authenticateAsReservationNonOwner()
    const res = await updateNotes(RES_ID, 'notes')
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authorized')
  })
})

// ─── checkInReservation (frontdesk) ────────────────────────────────────────

describe('frontdesk checkInReservation (machine-delegating)', () => {
  it('delegates to staff.checkIn on an owned reservation', async () => {
    authenticateAsReservationOwner()
    const res = await checkInReservation(RES_ID)
    expect(res.status).toBe('ok')
    expect(mockApply).toHaveBeenCalledWith(RES_ID, 'staff.checkIn')
  })

  it('maps a machine rejection to a Cannot-check-in error', async () => {
    authenticateAsReservationOwner()
    mockApply.mockResolvedValueOnce(rejected('staff.checkIn'))
    const res = await checkInReservation(RES_ID)
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toContain('Cannot check in')
  })

  it('rejects non-owner without invoking the machine', async () => {
    authenticateAsReservationNonOwner()
    const res = await checkInReservation(RES_ID)
    expect(res.status).toBe('error')
    expect(mockApply).not.toHaveBeenCalled()
  })
})

describe('frontdesk markDeparted (machine-delegating)', () => {
  it('delegates to staff.depart — the D14 fossil (terminal-only depart) is gone: multiday branching is machine-owned', async () => {
    authenticateAsReservationOwner(OP_CHECKED_IN)
    const res = await markDeparted(RES_ID)
    expect(res.status).toBe('ok')
    expect(mockApply).toHaveBeenCalledWith(RES_ID, 'staff.depart')
  })

  it('maps a machine rejection to a Cannot-mark-departed error', async () => {
    authenticateAsReservationOwner()
    mockApply.mockResolvedValueOnce(rejected('staff.depart'))
    const res = await markDeparted(RES_ID)
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toContain('Cannot mark departed')
  })
})

describe('frontdesk markNoShow (machine-delegating)', () => {
  it('delegates to staff.noShow', async () => {
    authenticateAsReservationOwner()
    const res = await markNoShow(RES_ID)
    expect(res.status).toBe('ok')
    expect(mockApply).toHaveBeenCalledWith(RES_ID, 'staff.noShow')
  })

  it('maps a machine rejection to a Cannot-mark-no-show error', async () => {
    authenticateAsReservationOwner()
    mockApply.mockResolvedValueOnce(rejected('staff.noShow'))
    const res = await markNoShow(RES_ID)
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toContain('Cannot mark no-show')
  })
})

describe('frontdesk cancelReservation (machine-delegating)', () => {
  it('delegates to partner.cancel and sends the cancellation email on success', async () => {
    authenticateAsReservationOwner()
    const res = await cancelReservation(RES_ID)
    expect(res.status).toBe('ok')
    expect(mockApply).toHaveBeenCalledWith(RES_ID, 'partner.cancel')
    // Email is action-owned (non-blocking) — fired only after the machine applied.
    await vi.waitFor(() => expect(vi.mocked(sendCancellationEmail)).toHaveBeenCalledWith(RES_ID))
  })

  it('machine rejection (e.g. a cash walk-in — released via Unreserve, not cancel) sends NO email', async () => {
    authenticateAsReservationOwner()
    mockApply.mockResolvedValueOnce(rejected('partner.cancel', { kind: 'walkin', pay: 'settled', occ: 'present' }))
    const res = await cancelReservation(RES_ID)
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toContain('Cannot cancel')
    expect(vi.mocked(sendCancellationEmail)).not.toHaveBeenCalled()
  })

  it('rejects non-owner without invoking the machine', async () => {
    authenticateAsReservationNonOwner()
    const res = await cancelReservation(RES_ID)
    expect(res.status).toBe('error')
    expect(mockApply).not.toHaveBeenCalled()
  })
})

// ─── updateNotes (frontdesk) ────────────────────────────────────────────────

describe('frontdesk updateNotes', () => {
  it('persists notes for the reservation owner', async () => {
    authenticateAsReservationOwner()
    vi.mocked(prisma.reservation.update).mockResolvedValue({} as any)

    const res = await updateNotes(RES_ID, 'Late arrival expected')
    expect(res.status).toBe('ok')

    const updateCall = vi.mocked(prisma.reservation.update).mock.calls[0][0]
    expect(updateCall.where.id).toBe(RES_ID)
    expect(updateCall.data.internalNotes).toBe('Late arrival expected')
  })

  it('truncates notes to 500 characters', async () => {
    authenticateAsReservationOwner()
    vi.mocked(prisma.reservation.update).mockResolvedValue({} as any)

    const res = await updateNotes(RES_ID, 'Y'.repeat(600))
    expect(res.status).toBe('ok')
    expect(vi.mocked(prisma.reservation.update).mock.calls[0][0].data.internalNotes).toHaveLength(500)
  })

  it('stores null when notes is an empty string', async () => {
    authenticateAsReservationOwner()
    vi.mocked(prisma.reservation.update).mockResolvedValue({} as any)

    const res = await updateNotes(RES_ID, '')
    expect(res.status).toBe('ok')
    expect(vi.mocked(prisma.reservation.update).mock.calls[0][0].data.internalNotes).toBeNull()
  })
})

// ─── Rental ops: ownership guard ───────────────────────────────────────────

describe('frontdesk rental actions — ownership guard', () => {
  it('markRentalPickedUp: rejects unauthenticated caller', async () => {
    const res = await markRentalPickedUp(BOOKING_ID)
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authenticated')
    expect(vi.mocked(prisma.rentalBooking.update)).not.toHaveBeenCalled()
  })

  it('markRentalPickedUp: rejects non-owner', async () => {
    authenticateAsRentalNonOwner()
    const res = await markRentalPickedUp(BOOKING_ID)
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authorized')
    expect(vi.mocked(prisma.rentalBooking.update)).not.toHaveBeenCalled()
  })

  it('markRentalPickedUp: rejects when booking not found (null → unauthorized)', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    vi.mocked(prisma.rentalBooking.findUnique).mockResolvedValue(null)
    const res = await markRentalPickedUp(BOOKING_ID)
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authorized')
    expect(vi.mocked(prisma.rentalBooking.update)).not.toHaveBeenCalled()
  })

  it('markRentalReturned: rejects unauthenticated caller', async () => {
    const res = await markRentalReturned(BOOKING_ID)
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authenticated')
  })

  it('markRentalReturned: rejects non-owner', async () => {
    authenticateAsRentalNonOwner()
    const res = await markRentalReturned(BOOKING_ID)
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authorized')
  })

  it('cancelRentalBooking: rejects unauthenticated caller', async () => {
    const res = await cancelRentalBooking(BOOKING_ID)
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authenticated')
  })

  it('cancelRentalBooking: rejects non-owner', async () => {
    authenticateAsRentalNonOwner()
    const res = await cancelRentalBooking(BOOKING_ID)
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authorized')
  })
})

// ─── markRentalPickedUp ─────────────────────────────────────────────────────

describe('markRentalPickedUp', () => {
  it('transitions reserved → picked-up and sets pickedUpAt', async () => {
    authenticateAsRentalOwner(OP_RESERVED)
    vi.mocked(prisma.rentalBooking.update).mockResolvedValue({} as any)

    const res = await markRentalPickedUp(BOOKING_ID)
    expect(res.status).toBe('ok')

    const updateCall = vi.mocked(prisma.rentalBooking.update).mock.calls[0][0]
    expect(updateCall.where.id).toBe(BOOKING_ID)
    expect(updateCall.data.operationalStatus).toBe(OP_PICKED_UP)
    expect(updateCall.data.pickedUpAt).toBeInstanceOf(Date)
  })

  it('rejects pickup from picked-up (already picked up)', async () => {
    authenticateAsRentalOwner(OP_PICKED_UP)
    const res = await markRentalPickedUp(BOOKING_ID)
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toContain('Cannot pick up from')
    expect(vi.mocked(prisma.rentalBooking.update)).not.toHaveBeenCalled()
  })

  it('rejects pickup from returned', async () => {
    authenticateAsRentalOwner(OP_RETURNED)
    const res = await markRentalPickedUp(BOOKING_ID)
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toContain('Cannot pick up from')
    expect(vi.mocked(prisma.rentalBooking.update)).not.toHaveBeenCalled()
  })
})

// ─── markRentalReturned ─────────────────────────────────────────────────────

describe('markRentalReturned', () => {
  it('transitions picked-up → returned and sets returnedAt', async () => {
    authenticateAsRentalOwner(OP_PICKED_UP)
    vi.mocked(prisma.rentalBooking.update).mockResolvedValue({} as any)

    const res = await markRentalReturned(BOOKING_ID)
    expect(res.status).toBe('ok')

    const updateCall = vi.mocked(prisma.rentalBooking.update).mock.calls[0][0]
    expect(updateCall.where.id).toBe(BOOKING_ID)
    expect(updateCall.data.operationalStatus).toBe(OP_RETURNED)
    expect(updateCall.data.returnedAt).toBeInstanceOf(Date)
  })

  it('rejects return from reserved (must be picked up first)', async () => {
    authenticateAsRentalOwner(OP_RESERVED)
    const res = await markRentalReturned(BOOKING_ID)
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toContain('Cannot return from')
    expect(vi.mocked(prisma.rentalBooking.update)).not.toHaveBeenCalled()
  })

  it('rejects return from already-returned', async () => {
    authenticateAsRentalOwner(OP_RETURNED)
    const res = await markRentalReturned(BOOKING_ID)
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toContain('Cannot return from')
    expect(vi.mocked(prisma.rentalBooking.update)).not.toHaveBeenCalled()
  })
})

// ─── cancelRentalBooking ────────────────────────────────────────────────────

describe('cancelRentalBooking', () => {
  it('cancels a reserved rental booking', async () => {
    authenticateAsRentalOwner(OP_RESERVED)
    vi.mocked(prisma.rentalBooking.update).mockResolvedValue({} as any)

    const res = await cancelRentalBooking(BOOKING_ID)
    expect(res.status).toBe('ok')

    const updateCall = vi.mocked(prisma.rentalBooking.update).mock.calls[0][0]
    expect(updateCall.where.id).toBe(BOOKING_ID)
    expect(updateCall.data.status).toBe(RENTAL_CANCELED)
  })

  it('cancels a picked-up rental booking (item can be returned and still canceled)', async () => {
    authenticateAsRentalOwner(OP_PICKED_UP)
    vi.mocked(prisma.rentalBooking.update).mockResolvedValue({} as any)

    const res = await cancelRentalBooking(BOOKING_ID)
    expect(res.status).toBe('ok')
  })

  it('rejects cancellation of an already-returned rental', async () => {
    authenticateAsRentalOwner(OP_RETURNED)
    const res = await cancelRentalBooking(BOOKING_ID)
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Cannot cancel a returned rental')
    expect(vi.mocked(prisma.rentalBooking.update)).not.toHaveBeenCalled()
  })
})
