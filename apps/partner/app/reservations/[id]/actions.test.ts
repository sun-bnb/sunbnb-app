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
import { applyTransition } from '@repo/data/reservation-machine-apply'
import { sendCancellationEmail } from '@repo/data/reservation-emails'
import {
  OP_EXPECTED,
  OP_CHECKED_IN,
  OP_WALKED_IN,
  OP_DEPARTED,
  OP_NO_SHOW,
  RESERVATION_CANCELED,
} from '@repo/data/reservation-status'

const mockAuth = vi.mocked(auth)
const mockApply = vi.mocked(applyTransition)

const OWNER_ID = 'owner-1'
const OTHER_ID = 'other-1'
const RES_ID = 'res-1'

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

describe('checkInReservation (machine-delegating)', () => {
  it('delegates to staff.checkIn', async () => {
    authenticateAsOwner()
    const res = await checkInReservation(RES_ID)
    expect(res.status).toBe('ok')
    expect(mockApply).toHaveBeenCalledWith(RES_ID, 'staff.checkIn')
  })

  it('maps a machine rejection to a Cannot-check-in error', async () => {
    authenticateAsOwner()
    mockApply.mockResolvedValueOnce(rejected('staff.checkIn'))
    const res = await checkInReservation(RES_ID)
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toContain('Cannot check in')
  })
})

describe('markDeparted (machine-delegating)', () => {
  it('delegates to staff.depart — multiday branching is machine-owned (D15 fossil fix)', async () => {
    authenticateAsOwner({ operationalStatus: 'checked-in' })
    const res = await markDeparted(RES_ID)
    expect(res.status).toBe('ok')
    expect(mockApply).toHaveBeenCalledWith(RES_ID, 'staff.depart')
  })

  it('maps a machine rejection to a Cannot-mark-departed error', async () => {
    authenticateAsOwner()
    mockApply.mockResolvedValueOnce(rejected('staff.depart'))
    const res = await markDeparted(RES_ID)
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toContain('Cannot mark departed')
  })
})

describe('markNoShow (machine-delegating)', () => {
  it('delegates to staff.noShow', async () => {
    authenticateAsOwner()
    const res = await markNoShow(RES_ID)
    expect(res.status).toBe('ok')
    expect(mockApply).toHaveBeenCalledWith(RES_ID, 'staff.noShow')
  })

  it('maps a machine rejection to a Cannot-mark-no-show error', async () => {
    authenticateAsOwner()
    mockApply.mockResolvedValueOnce(rejected('staff.noShow'))
    const res = await markNoShow(RES_ID)
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toContain('Cannot mark no-show')
  })
})

describe('cancelReservation (machine-delegating)', () => {
  it('delegates to partner.cancel and sends the cancellation email on success', async () => {
    authenticateAsOwner()
    const res = await cancelReservation(RES_ID)
    expect(res.status).toBe('ok')
    expect(mockApply).toHaveBeenCalledWith(RES_ID, 'partner.cancel')
    await vi.waitFor(() => expect(vi.mocked(sendCancellationEmail)).toHaveBeenCalledWith(RES_ID))
  })

  it('machine rejection sends NO email', async () => {
    authenticateAsOwner()
    mockApply.mockResolvedValueOnce(rejected('partner.cancel'))
    const res = await cancelReservation(RES_ID)
    expect(res.status).toBe('error')
    expect(vi.mocked(sendCancellationEmail)).not.toHaveBeenCalled()
  })
})

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
