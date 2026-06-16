import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/auth', () => ({
  auth: vi.fn().mockResolvedValue(null),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

// Mock the conflict guard — the real implementation does $transaction + FOR UPDATE
// which the PrismaCient mock cannot model. Default: created (success path).
vi.mock('@repo/data/reservations', () => ({
  reserveWithConflictGuard: vi.fn().mockResolvedValue({
    outcome: 'created',
    reservationId: 'r1',
  }),
}))

import { createPartnerReservation, getAvailableSunbeds } from './actions'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import { reserveWithConflictGuard } from '@repo/data/reservations'

const mockAuth = vi.mocked(auth)
const mockGuard = vi.mocked(reserveWithConflictGuard)
const OWNER_ID = 'owner-1'
const SITE_ID = 'site-1'

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue(null)
  // Guard default: success (created). Override in conflict-path tests.
  mockGuard.mockResolvedValue({ outcome: 'created', reservationId: 'r1' })
})

function authenticateAsOwner() {
  mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
  vi.mocked(prisma.site.findUnique).mockResolvedValue({ userId: OWNER_ID } as any)
}

// ─── createPartnerReservation ───────────────────────────────────────────────

describe('createPartnerReservation', () => {
  it('rejects unauthenticated user', async () => {
    const res = await createPartnerReservation({
      siteId: SITE_ID,
      itemIds: ['item-1'],
      from: '2025-07-01',
      to: '2025-07-02',
      paymentType: 'cash',
    })
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authenticated')
  })

  it('rejects non-owner', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'other' } } as any)
    vi.mocked(prisma.site.findUnique).mockResolvedValue({ userId: OWNER_ID } as any)

    const res = await createPartnerReservation({
      siteId: SITE_ID,
      itemIds: ['item-1'],
      from: '2025-07-01',
      to: '2025-07-02',
      paymentType: 'cash',
    })
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authorized')
  })

  it('rejects empty item list', async () => {
    authenticateAsOwner()
    const res = await createPartnerReservation({
      siteId: SITE_ID,
      itemIds: [],
      from: '2025-07-01',
      to: '2025-07-02',
      paymentType: 'cash',
    })
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toContain('at least one sunbed')
  })

  it('rejects when some items not found or inactive', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([{ id: 'item-1' }] as any) // only 1 of 2

    const res = await createPartnerReservation({
      siteId: SITE_ID,
      itemIds: ['item-1', 'item-2'],
      from: '2025-07-01',
      to: '2025-07-02',
      paymentType: 'cash',
    })
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toContain('not found or inactive')
  })

  it('rejects double-booking (guard returns conflict)', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([{ id: 'item-1' }] as any)
    vi.mocked(prisma.inventoryItem.findUnique).mockResolvedValue({
      id: 'item-1', pairId: null, sunbedGroupId: null, pairedBy: null,
    } as any)
    mockGuard.mockResolvedValueOnce({ outcome: 'conflict', conflictingReservationId: 'existing-res' })

    const res = await createPartnerReservation({
      siteId: SITE_ID,
      itemIds: ['item-1'],
      from: '2025-07-01',
      to: '2025-07-02',
      paymentType: 'cash',
    })
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toContain('already reserved')
    expect(vi.mocked(prisma.reservation.create)).not.toHaveBeenCalled()
  })

  it('creates cash reservation with paid-in-cash status', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([{ id: 'item-1' }] as any)
    // findUnique for the group membership expansion — no group
    vi.mocked(prisma.inventoryItem.findUnique).mockResolvedValue({
      id: 'item-1', pairId: null, sunbedGroupId: null, pairedBy: null,
    } as any)

    const res = await createPartnerReservation({
      siteId: SITE_ID,
      itemIds: ['item-1'],
      from: '2025-07-01',
      to: '2025-07-02',
      paymentType: 'cash',
    })
    expect(res.status).toBe('ok')

    const guardCall = mockGuard.mock.calls[0][0]
    expect(guardCall.status).toBe('paid-in-cash')
    expect(guardCall.operationalStatus).toBe('expected')
    expect(vi.mocked(prisma.reservation.create)).not.toHaveBeenCalled()
  })

  it('creates free reservation with complete status', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([{ id: 'item-1' }] as any)
    vi.mocked(prisma.inventoryItem.findUnique).mockResolvedValue({
      id: 'item-1', pairId: null, sunbedGroupId: null, pairedBy: null,
    } as any)

    const res = await createPartnerReservation({
      siteId: SITE_ID,
      itemIds: ['item-1'],
      from: '2025-07-01',
      to: '2025-07-02',
      paymentType: 'free',
    })
    expect(res.status).toBe('ok')

    const guardCall = mockGuard.mock.calls[0][0]
    expect(guardCall.status).toBe('complete')
  })

  it('truncates guest info fields before passing to guard', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([{ id: 'item-1' }] as any)
    vi.mocked(prisma.inventoryItem.findUnique).mockResolvedValue({
      id: 'item-1', pairId: null, sunbedGroupId: null, pairedBy: null,
    } as any)

    await createPartnerReservation({
      siteId: SITE_ID,
      itemIds: ['item-1'],
      from: '2025-07-01',
      to: '2025-07-02',
      paymentType: 'cash',
      guestName: 'N'.repeat(300),
      guestContact: 'C'.repeat(300),
      internalNotes: 'X'.repeat(600),
    })

    const guardCall = mockGuard.mock.calls[0][0]
    expect(guardCall.guestName).toHaveLength(200)
    expect(guardCall.guestContact).toHaveLength(200)
    expect(guardCall.internalNotes).toHaveLength(500)
  })

  it('expands group members BEFORE passing to guard (fixes pair-expansion double-booking)', async () => {
    // The bug: old code checked conflict on itemIds only, then expanded siblings.
    // Fix: expand siblings first, then call guard with all ids — guard sees sibling conflicts.
    authenticateAsOwner()
    vi.mocked(prisma.inventoryItem.findMany)
      .mockResolvedValueOnce([{ id: 'item-1' }] as any)  // active items check
      .mockResolvedValueOnce([{ id: 'item-pair' }] as any)  // sibling lookup
    vi.mocked(prisma.inventoryItem.findUnique).mockResolvedValue({
      id: 'item-1',
      pairId: 'item-pair',
      sunbedGroupId: 'group-1',
      pairedBy: null,
    } as any)

    await createPartnerReservation({
      siteId: SITE_ID,
      itemIds: ['item-1'],
      from: '2025-07-01',
      to: '2025-07-02',
      paymentType: 'cash',
    })

    // Guard must receive both the primary AND the sibling in one call
    const guardCall = mockGuard.mock.calls[0][0]
    expect(guardCall.itemIds).toContain('item-1')
    expect(guardCall.itemIds).toContain('item-pair')
    expect(vi.mocked(prisma.reservation.create)).not.toHaveBeenCalled()
  })

  it('auto-includes paired items via legacy pairId fallback (no SunbedGroup)', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([{ id: 'item-1' }] as any)
    vi.mocked(prisma.inventoryItem.findUnique).mockResolvedValue({
      id: 'item-1',
      pairId: 'item-pair',
      sunbedGroupId: null,
      pairedBy: null,
    } as any)

    await createPartnerReservation({
      siteId: SITE_ID,
      itemIds: ['item-1'],
      from: '2025-07-01',
      to: '2025-07-02',
      paymentType: 'cash',
    })

    const guardCall = mockGuard.mock.calls[0][0]
    expect(guardCall.itemIds).toContain('item-1')
    expect(guardCall.itemIds).toContain('item-pair')
  })
})

// ─── getAvailableSunbeds ────────────────────────────────────────────────────

describe('getAvailableSunbeds', () => {
  it('rejects unauthenticated', async () => {
    const res = await getAvailableSunbeds(SITE_ID, '2025-07-01', '2025-07-02')
    expect(res.status).toBe('error')
  })

  it('filters out reserved items', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([
      { id: 'item-1', number: 1, category: 'standard', pairId: null },
      { id: 'item-2', number: 2, category: 'standard', pairId: null },
      { id: 'item-3', number: 3, category: 'standard', pairId: null },
    ] as any)
    vi.mocked(prisma.reservation.findMany).mockResolvedValue([
      { items: [{ id: 'item-2' }] },
    ] as any)

    const res = await getAvailableSunbeds(SITE_ID, '2025-07-01', '2025-07-02')
    expect(res.status).toBe('ok')
    expect(res.items).toHaveLength(2)
    expect(res.items.map(i => i.id)).toEqual(['item-1', 'item-3'])
  })
})
