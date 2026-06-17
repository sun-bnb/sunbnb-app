/**
 * Unit tests for app/reservations/[id]/actions.ts
 *
 * Covers the five exported actions: checkInReservation, markDeparted, markNoShow,
 * cancelReservation, updateNotes.  Every action goes through the private
 * verifyOwnership() helper which checks reservation.site.userId === session.user.id.
 * These tests are the regression guard the allowlist entry relies on.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/auth', () => ({
  auth: vi.fn().mockResolvedValue(null),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

// Dynamic import '@repo/data/reservation-emails' inside cancelReservation is
// intercepted by the vitest alias configured in vitest.config.ts → mock file.

import {
  checkInReservation,
  markDeparted,
  markNoShow,
  cancelReservation,
  updateNotes,
} from './actions'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import {
  OP_EXPECTED,
  OP_CHECKED_IN,
  OP_WALKED_IN,
  OP_DEPARTED,
  OP_NO_SHOW,
  RESERVATION_CANCELED,
} from '@repo/data/reservation-status'

const mockAuth = vi.mocked(auth)

const OWNER_ID = 'owner-1'
const OTHER_ID = 'other-1'
const RES_ID = 'res-1'

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue(null)
})

// ─── Setup helpers ──────────────────────────────────────────────────────────

/**
 * Mock an authenticated session as OWNER whose reservation exists in the DB.
 * The verifyOwnership() helper fetches reservation with site.userId via
 * prisma.reservation.findUnique, so we mock that here.
 */
function authenticateAsOwner(overrides: {
  status?: string
  operationalStatus?: string
} = {}) {
  mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
  vi.mocked(prisma.reservation.findUnique).mockResolvedValue({
    id: RES_ID,
    siteId: 'site-1',
    status: overrides.status ?? 'complete',
    operationalStatus: overrides.operationalStatus ?? OP_EXPECTED,
    site: { userId: OWNER_ID },
  } as any)
}

/**
 * Mock an authenticated session as OTHER — reservation still belongs to OWNER.
 * site.userId !== session.user.id → verifyOwnership returns 'Not authorized'.
 */
function authenticateAsNonOwner() {
  mockAuth.mockResolvedValue({ user: { id: OTHER_ID } } as any)
  vi.mocked(prisma.reservation.findUnique).mockResolvedValue({
    id: RES_ID,
    siteId: 'site-1',
    status: 'complete',
    operationalStatus: OP_EXPECTED,
    site: { userId: OWNER_ID }, // different from session user
  } as any)
}

// ─── Ownership / Auth guard ─────────────────────────────────────────────────

describe('reservations/[id]/actions — ownership guard', () => {
  it('checkInReservation: rejects unauthenticated caller', async () => {
    const res = await checkInReservation(RES_ID)
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authenticated')
    expect(vi.mocked(prisma.reservation.update)).not.toHaveBeenCalled()
  })

  it('checkInReservation: rejects non-owner', async () => {
    authenticateAsNonOwner()
    const res = await checkInReservation(RES_ID)
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authorized')
    expect(vi.mocked(prisma.reservation.update)).not.toHaveBeenCalled()
  })

  it('checkInReservation: rejects when reservation not found (null → treated as unauthorized)', async () => {
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
    authenticateAsNonOwner()
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
    authenticateAsNonOwner()
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
    authenticateAsNonOwner()
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
    authenticateAsNonOwner()
    const res = await updateNotes(RES_ID, 'notes')
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authorized')
  })
})

// ─── checkInReservation ─────────────────────────────────────────────────────

describe('checkInReservation', () => {
  it('transitions expected → checked-in and sets checkedInAt', async () => {
    authenticateAsOwner({ operationalStatus: OP_EXPECTED })
    vi.mocked(prisma.reservation.update).mockResolvedValue({} as any)

    const res = await checkInReservation(RES_ID)
    expect(res.status).toBe('ok')

    const updateCall = vi.mocked(prisma.reservation.update).mock.calls[0][0]
    expect(updateCall.where.id).toBe(RES_ID)
    expect(updateCall.data.operationalStatus).toBe(OP_CHECKED_IN)
    expect(updateCall.data.checkedInAt).toBeInstanceOf(Date)
  })

  it('rejects check-in from checked-in (already in)', async () => {
    authenticateAsOwner({ operationalStatus: OP_CHECKED_IN })
    const res = await checkInReservation(RES_ID)
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toContain('Cannot check in')
    expect(vi.mocked(prisma.reservation.update)).not.toHaveBeenCalled()
  })

  it('rejects check-in from walked-in (walk-in is not the check-in flow)', async () => {
    authenticateAsOwner({ operationalStatus: OP_WALKED_IN })
    const res = await checkInReservation(RES_ID)
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toContain('Cannot check in')
    expect(vi.mocked(prisma.reservation.update)).not.toHaveBeenCalled()
  })

  it('rejects check-in from departed', async () => {
    authenticateAsOwner({ operationalStatus: OP_DEPARTED })
    const res = await checkInReservation(RES_ID)
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toContain('Cannot check in')
  })

  it('rejects check-in from no-show', async () => {
    authenticateAsOwner({ operationalStatus: OP_NO_SHOW })
    const res = await checkInReservation(RES_ID)
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toContain('Cannot check in')
  })
})

// ─── markDeparted ───────────────────────────────────────────────────────────

describe('markDeparted', () => {
  it('transitions checked-in → departed and sets departedAt', async () => {
    authenticateAsOwner({ operationalStatus: OP_CHECKED_IN })
    vi.mocked(prisma.reservation.update).mockResolvedValue({} as any)

    const res = await markDeparted(RES_ID)
    expect(res.status).toBe('ok')

    const updateCall = vi.mocked(prisma.reservation.update).mock.calls[0][0]
    expect(updateCall.where.id).toBe(RES_ID)
    expect(updateCall.data.operationalStatus).toBe(OP_DEPARTED)
    expect(updateCall.data.departedAt).toBeInstanceOf(Date)
  })

  it('transitions walked-in → departed (walk-in guests can also depart)', async () => {
    authenticateAsOwner({ operationalStatus: OP_WALKED_IN })
    vi.mocked(prisma.reservation.update).mockResolvedValue({} as any)

    const res = await markDeparted(RES_ID)
    expect(res.status).toBe('ok')
    expect(vi.mocked(prisma.reservation.update).mock.calls[0][0].data.operationalStatus).toBe(OP_DEPARTED)
  })

  it('rejects departure from expected (must check in first)', async () => {
    authenticateAsOwner({ operationalStatus: OP_EXPECTED })
    const res = await markDeparted(RES_ID)
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toContain('Cannot mark departed')
    expect(vi.mocked(prisma.reservation.update)).not.toHaveBeenCalled()
  })

  it('rejects departure from already-departed', async () => {
    authenticateAsOwner({ operationalStatus: OP_DEPARTED })
    const res = await markDeparted(RES_ID)
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toContain('Cannot mark departed')
    expect(vi.mocked(prisma.reservation.update)).not.toHaveBeenCalled()
  })

  it('rejects departure from no-show', async () => {
    authenticateAsOwner({ operationalStatus: OP_NO_SHOW })
    const res = await markDeparted(RES_ID)
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toContain('Cannot mark departed')
    expect(vi.mocked(prisma.reservation.update)).not.toHaveBeenCalled()
  })
})

// ─── markNoShow ─────────────────────────────────────────────────────────────

describe('markNoShow', () => {
  it('transitions expected → no-show', async () => {
    authenticateAsOwner({ operationalStatus: OP_EXPECTED })
    vi.mocked(prisma.reservation.update).mockResolvedValue({} as any)

    const res = await markNoShow(RES_ID)
    expect(res.status).toBe('ok')

    const updateCall = vi.mocked(prisma.reservation.update).mock.calls[0][0]
    expect(updateCall.where.id).toBe(RES_ID)
    expect(updateCall.data.operationalStatus).toBe(OP_NO_SHOW)
    // markNoShow must NOT set a timestamp (only checkedIn/departed have timestamps)
    expect(updateCall.data.checkedInAt).toBeUndefined()
    expect(updateCall.data.departedAt).toBeUndefined()
  })

  it('rejects no-show from checked-in', async () => {
    authenticateAsOwner({ operationalStatus: OP_CHECKED_IN })
    const res = await markNoShow(RES_ID)
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toContain('Cannot mark no-show')
    expect(vi.mocked(prisma.reservation.update)).not.toHaveBeenCalled()
  })

  it('rejects no-show from walked-in', async () => {
    authenticateAsOwner({ operationalStatus: OP_WALKED_IN })
    const res = await markNoShow(RES_ID)
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toContain('Cannot mark no-show')
    expect(vi.mocked(prisma.reservation.update)).not.toHaveBeenCalled()
  })

  it('rejects no-show from departed', async () => {
    authenticateAsOwner({ operationalStatus: OP_DEPARTED })
    const res = await markNoShow(RES_ID)
    expect(res.status).toBe('error')
    expect(vi.mocked(prisma.reservation.update)).not.toHaveBeenCalled()
  })
})

// ─── cancelReservation ──────────────────────────────────────────────────────

describe('cancelReservation', () => {
  it('cancels an expected reservation', async () => {
    authenticateAsOwner({ status: 'complete', operationalStatus: OP_EXPECTED })
    vi.mocked(prisma.reservation.update).mockResolvedValue({} as any)

    const res = await cancelReservation(RES_ID)
    expect(res.status).toBe('ok')

    const updateCall = vi.mocked(prisma.reservation.update).mock.calls[0][0]
    expect(updateCall.where.id).toBe(RES_ID)
    expect(updateCall.data.status).toBe(RESERVATION_CANCELED)
  })

  it('cancels a checked-in reservation (partner may need to refund)', async () => {
    authenticateAsOwner({ status: 'complete', operationalStatus: OP_CHECKED_IN })
    vi.mocked(prisma.reservation.update).mockResolvedValue({} as any)

    const res = await cancelReservation(RES_ID)
    expect(res.status).toBe('ok')
  })

  it('rejects cancellation of already-canceled reservation', async () => {
    authenticateAsOwner({ status: RESERVATION_CANCELED, operationalStatus: OP_EXPECTED })
    const res = await cancelReservation(RES_ID)
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Already canceled')
    expect(vi.mocked(prisma.reservation.update)).not.toHaveBeenCalled()
  })

  it('rejects cancellation from departed (reservation already completed)', async () => {
    authenticateAsOwner({ status: 'complete', operationalStatus: OP_DEPARTED })
    const res = await cancelReservation(RES_ID)
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Cannot cancel a completed reservation')
    expect(vi.mocked(prisma.reservation.update)).not.toHaveBeenCalled()
  })

  it('rejects cancellation from no-show (reservation already completed)', async () => {
    authenticateAsOwner({ status: 'complete', operationalStatus: OP_NO_SHOW })
    const res = await cancelReservation(RES_ID)
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Cannot cancel a completed reservation')
    expect(vi.mocked(prisma.reservation.update)).not.toHaveBeenCalled()
  })
})

// ─── updateNotes ────────────────────────────────────────────────────────────

describe('updateNotes', () => {
  it('persists notes for the reservation owner', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.update).mockResolvedValue({} as any)

    const res = await updateNotes(RES_ID, 'Wheelchair access required')
    expect(res.status).toBe('ok')

    const updateCall = vi.mocked(prisma.reservation.update).mock.calls[0][0]
    expect(updateCall.where.id).toBe(RES_ID)
    expect(updateCall.data.internalNotes).toBe('Wheelchair access required')
  })

  it('truncates notes to 500 characters', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.update).mockResolvedValue({} as any)

    const longNotes = 'X'.repeat(600)
    const res = await updateNotes(RES_ID, longNotes)
    expect(res.status).toBe('ok')

    const updateCall = vi.mocked(prisma.reservation.update).mock.calls[0][0]
    expect(updateCall.data.internalNotes).toHaveLength(500)
  })

  it('stores null when notes is an empty string', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.update).mockResolvedValue({} as any)

    const res = await updateNotes(RES_ID, '')
    expect(res.status).toBe('ok')

    const updateCall = vi.mocked(prisma.reservation.update).mock.calls[0][0]
    expect(updateCall.data.internalNotes).toBeNull()
  })
})
