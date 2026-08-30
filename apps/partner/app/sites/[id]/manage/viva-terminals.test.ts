/**
 * Unit tests for the Viva terminal registry (track 024, W8, packet C1):
 *   listVivaTerminals, discoverVivaTerminals, registerVivaTerminal, removeVivaTerminal
 *
 * Gate: verifySiteOwnership → verifySiteAccess (lib/auth-helpers.ts), the same
 * token-or-session gate as every other manage action. Full auth-rejection
 * coverage runs through the auth-matrix (gated-actions.ts); this file covers
 * the business logic once auth passes: upsert semantics and cross-site
 * rejection.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/auth', () => ({
  auth: vi.fn().mockResolvedValue(null),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

vi.mock('@repo/data/payment', () => ({
  processConfirmedReservation: vi.fn().mockResolvedValue(undefined),
  processCashRentalBooking: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@repo/data/reservations', () => ({
  reserveWithConflictGuard: vi.fn().mockResolvedValue({ outcome: 'created', reservationId: 'r1' }),
  moveReservationWithConflictGuard: vi.fn().mockResolvedValue({ outcome: 'moved' }),
  createRentalBookingsWithGuard: vi.fn().mockResolvedValue({ outcome: 'created', bookingIds: ['rb1'] }),
}))

vi.mock('@repo/data/viva', () => ({
  getVivaClient: vi.fn(),
}))

import { listVivaTerminals, discoverVivaTerminals, registerVivaTerminal, removeVivaTerminal } from './actions'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import { getVivaClient } from '@repo/data/viva'

const mockAuth = vi.mocked(auth)
const mockGetVivaClient = vi.mocked(getVivaClient)

const OWNER_ID = 'owner-1'
const SITE_ID = 'site-1'
const OTHER_SITE_ID = 'site-2'
const TERMINAL_ID = 'term-1'

const mockSearchDevices = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue(null)
  mockGetVivaClient.mockReturnValue({
    createSale: vi.fn(),
    getSession: vi.fn(),
    abortSession: vi.fn(),
    refund: vi.fn(),
    searchDevices: mockSearchDevices,
  } as any)
  vi.mocked(prisma.securityToken.findUnique).mockResolvedValue(null)
  vi.mocked(prisma.site.findUnique).mockResolvedValue({ userId: OWNER_ID } as any)
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ sudo: false } as any)
})

function ownerSession() {
  mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
}

// ─── listVivaTerminals ────────────────────────────────────────────────────────

describe('listVivaTerminals', () => {
  it('rejects when not authenticated', async () => {
    const result = await listVivaTerminals(SITE_ID)
    expect(result.status).toBe('error')
    expect(prisma.vivaTerminal.findMany).not.toHaveBeenCalled()
  })

  it('returns the site-scoped terminal list for the owner', async () => {
    ownerSession()
    vi.mocked(prisma.vivaTerminal.findMany).mockResolvedValue([
      { id: 't1', terminalId: TERMINAL_ID, label: 'Bar iPad', lastSeenAt: null },
    ] as any)

    const result = await listVivaTerminals(SITE_ID)

    expect(result).toEqual({
      status: 'ok',
      terminals: [{ id: 't1', terminalId: TERMINAL_ID, label: 'Bar iPad', lastSeenAt: null }],
    })
    expect(prisma.vivaTerminal.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { siteId: SITE_ID } }),
    )
  })
})

// ─── discoverVivaTerminals ──────────────────────────────────────────────────

describe('discoverVivaTerminals', () => {
  it('errors when the partner has no Viva merchant connected', async () => {
    ownerSession()
    vi.mocked(prisma.partnerAccount.findUnique).mockResolvedValue({ vivaMerchantId: null } as any)

    const result = await discoverVivaTerminals(SITE_ID)

    expect(result).toEqual({ status: 'error', errors: ['Viva not connected'] })
    expect(mockSearchDevices).not.toHaveBeenCalled()
  })

  it('marks devices already registered to this site', async () => {
    ownerSession()
    vi.mocked(prisma.partnerAccount.findUnique).mockResolvedValue({ vivaMerchantId: 'merchant-1' } as any)
    mockSearchDevices.mockResolvedValue([
      { terminalId: 'term-a', statusId: 1, sourceCode: 'src' },
      { terminalId: 'term-b', statusId: 1 },
    ])
    vi.mocked(prisma.vivaTerminal.findMany).mockResolvedValue([
      { terminalId: 'term-a', label: 'Bar iPad' },
    ] as any)

    const result = await discoverVivaTerminals(SITE_ID)

    expect(mockSearchDevices).toHaveBeenCalledWith('merchant-1')
    expect(result).toEqual({
      status: 'ok',
      devices: [
        { terminalId: 'term-a', statusId: 1, sourceCode: 'src', registered: true, label: 'Bar iPad' },
        { terminalId: 'term-b', statusId: 1, sourceCode: undefined, registered: false, label: null },
      ],
    })
  })
})

// ─── registerVivaTerminal ───────────────────────────────────────────────────

describe('registerVivaTerminal', () => {
  it('rejects a blank terminal id', async () => {
    ownerSession()

    const result = await registerVivaTerminal(SITE_ID, '   ', 'Label')

    expect(result).toEqual({ status: 'error', errors: ['Terminal id is required'] })
    expect(prisma.vivaTerminal.upsert).not.toHaveBeenCalled()
  })

  it('upserts with cashRegisterId defaulted to the site id', async () => {
    ownerSession()
    vi.mocked(prisma.vivaTerminal.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.vivaTerminal.upsert).mockResolvedValue({
      id: 't1',
      terminalId: TERMINAL_ID,
      label: 'Bar iPad',
      lastSeenAt: null,
    } as any)

    const result = await registerVivaTerminal(SITE_ID, TERMINAL_ID, 'Bar iPad')

    expect(result.status).toBe('ok')
    expect(prisma.vivaTerminal.upsert).toHaveBeenCalledWith({
      where: { terminalId: TERMINAL_ID },
      create: { siteId: SITE_ID, terminalId: TERMINAL_ID, label: 'Bar iPad', cashRegisterId: SITE_ID },
      update: { label: 'Bar iPad' },
      select: { id: true, terminalId: true, label: true, lastSeenAt: true },
    })
  })

  /**
   * BUG-REVEALING: a terminal already bound to a DIFFERENT site must be
   * rejected, not silently re-parented by the upsert (terminalId is globally
   * unique — a physical device belongs to one site at a time).
   */
  it('rejects registering a terminal already bound to another site', async () => {
    ownerSession()
    vi.mocked(prisma.vivaTerminal.findUnique).mockResolvedValue({
      terminalId: TERMINAL_ID,
      siteId: OTHER_SITE_ID,
    } as any)

    const result = await registerVivaTerminal(SITE_ID, TERMINAL_ID, 'Bar iPad')

    expect(result).toEqual({
      status: 'error',
      errors: ['This terminal is already registered to another site'],
    })
    expect(prisma.vivaTerminal.upsert).not.toHaveBeenCalled()
  })

  it('allows re-registering (relabeling) a terminal already bound to THIS site', async () => {
    ownerSession()
    vi.mocked(prisma.vivaTerminal.findUnique).mockResolvedValue({
      terminalId: TERMINAL_ID,
      siteId: SITE_ID,
    } as any)
    vi.mocked(prisma.vivaTerminal.upsert).mockResolvedValue({
      id: 't1',
      terminalId: TERMINAL_ID,
      label: 'Renamed',
      lastSeenAt: null,
    } as any)

    const result = await registerVivaTerminal(SITE_ID, TERMINAL_ID, 'Renamed')

    expect(result.status).toBe('ok')
    expect(prisma.vivaTerminal.upsert).toHaveBeenCalled()
  })
})

// ─── removeVivaTerminal ──────────────────────────────────────────────────────

describe('removeVivaTerminal', () => {
  it('rejects removing a terminal that does not belong to this site', async () => {
    ownerSession()
    vi.mocked(prisma.vivaTerminal.findUnique).mockResolvedValue({
      terminalId: TERMINAL_ID,
      siteId: OTHER_SITE_ID,
    } as any)

    const result = await removeVivaTerminal(SITE_ID, TERMINAL_ID)

    expect(result).toEqual({ status: 'error', errors: ['Terminal not found for this site'] })
    expect(prisma.vivaTerminal.delete).not.toHaveBeenCalled()
  })

  it('deletes a terminal that belongs to this site', async () => {
    ownerSession()
    vi.mocked(prisma.vivaTerminal.findUnique).mockResolvedValue({
      terminalId: TERMINAL_ID,
      siteId: SITE_ID,
    } as any)
    vi.mocked(prisma.vivaTerminal.delete).mockResolvedValue({} as any)

    const result = await removeVivaTerminal(SITE_ID, TERMINAL_ID)

    expect(result).toEqual({ status: 'ok' })
    expect(prisma.vivaTerminal.delete).toHaveBeenCalledWith({ where: { terminalId: TERMINAL_ID } })
  })
})
