import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/auth', () => ({
  auth: vi.fn().mockResolvedValue(null),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

import { createPartnerReservation, getAvailableSunbeds } from './actions'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'

const mockAuth = vi.mocked(auth)
const OWNER_ID = 'owner-1'
const SITE_ID = 'site-1'

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue(null)
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

  it('rejects double-booking (conflicting reservation)', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([{ id: 'item-1' }] as any)
    vi.mocked(prisma.reservation.findFirst).mockResolvedValue({ id: 'existing-res' } as any)

    const res = await createPartnerReservation({
      siteId: SITE_ID,
      itemIds: ['item-1'],
      from: '2025-07-01',
      to: '2025-07-02',
      paymentType: 'cash',
    })
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toContain('already reserved')
  })

  it('creates cash reservation with paid-in-cash status', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([{ id: 'item-1' }] as any)
    vi.mocked(prisma.reservation.findFirst).mockResolvedValue(null) // no conflict
    vi.mocked(prisma.inventoryItem.findUnique).mockResolvedValue({ id: 'item-1', pairId: null, pairedBy: null } as any)
    vi.mocked(prisma.reservation.create).mockResolvedValue({} as any)

    const res = await createPartnerReservation({
      siteId: SITE_ID,
      itemIds: ['item-1'],
      from: '2025-07-01',
      to: '2025-07-02',
      paymentType: 'cash',
    })
    expect(res.status).toBe('ok')

    const createCall = vi.mocked(prisma.reservation.create).mock.calls[0][0]
    expect(createCall.data.status).toBe('paid-in-cash')
    expect(createCall.data.operationalStatus).toBe('expected')
  })

  it('creates free reservation with complete status', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([{ id: 'item-1' }] as any)
    vi.mocked(prisma.reservation.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.inventoryItem.findUnique).mockResolvedValue({ id: 'item-1', pairId: null, pairedBy: null } as any)
    vi.mocked(prisma.reservation.create).mockResolvedValue({} as any)

    const res = await createPartnerReservation({
      siteId: SITE_ID,
      itemIds: ['item-1'],
      from: '2025-07-01',
      to: '2025-07-02',
      paymentType: 'free',
    })
    expect(res.status).toBe('ok')

    const createCall = vi.mocked(prisma.reservation.create).mock.calls[0][0]
    expect(createCall.data.status).toBe('complete')
  })

  it('truncates guest info fields', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([{ id: 'item-1' }] as any)
    vi.mocked(prisma.reservation.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.inventoryItem.findUnique).mockResolvedValue({ id: 'item-1', pairId: null, pairedBy: null } as any)
    vi.mocked(prisma.reservation.create).mockResolvedValue({} as any)

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

    const createCall = vi.mocked(prisma.reservation.create).mock.calls[0][0]
    expect(createCall.data.guestName).toHaveLength(200)
    expect(createCall.data.guestContact).toHaveLength(200)
    expect(createCall.data.internalNotes).toHaveLength(500)
  })

  it('auto-includes paired items', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([{ id: 'item-1' }] as any)
    vi.mocked(prisma.reservation.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.inventoryItem.findUnique).mockResolvedValue({
      id: 'item-1',
      pairId: 'item-pair',
      pairedBy: null,
    } as any)
    vi.mocked(prisma.reservation.create).mockResolvedValue({} as any)

    await createPartnerReservation({
      siteId: SITE_ID,
      itemIds: ['item-1'],
      from: '2025-07-01',
      to: '2025-07-02',
      paymentType: 'cash',
    })

    const createCall = vi.mocked(prisma.reservation.create).mock.calls[0][0]
    const connectedIds = createCall.data.items.connect.map((c: any) => c.id)
    expect(connectedIds).toContain('item-1')
    expect(connectedIds).toContain('item-pair')
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
