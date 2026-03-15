import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import { cleanDatabase, disconnectDatabase, prisma } from '@/app/test/setup'
import {
  createTestUser,
  createTestSite,
  createTestInventoryItem,
  createTestReservation,
} from '@/app/test/fixtures'

// ---------------------------------------------------------------------------
// Mocks — only auth and next/cache. Everything else hits the real DB.
// ---------------------------------------------------------------------------

let mockUserId: string | null = null

vi.mock('@/app/auth', () => ({
  auth: vi.fn(async () =>
    mockUserId ? { user: { id: mockUserId } } : null
  ),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Import actions AFTER mocks are declared
// ---------------------------------------------------------------------------

import { createPartnerReservation, getAvailableSunbeds } from './actions'

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

beforeAll(async () => {
  await cleanDatabase()
})

beforeEach(async () => {
  await cleanDatabase()
  mockUserId = null
})

afterAll(async () => {
  await cleanDatabase()
  await disconnectDatabase()
})

// ---------------------------------------------------------------------------
// createPartnerReservation
// ---------------------------------------------------------------------------

describe('createPartnerReservation', () => {
  it('creates reservation with paid-in-cash status for cash payment, persists guest info', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    const item = await createTestInventoryItem(user.id, site.id)
    mockUserId = user.id

    const result = await createPartnerReservation({
      siteId: site.id,
      itemIds: [item.id],
      from: '2026-07-01',
      to: '2026-07-03',
      paymentType: 'cash',
      guestName: 'John Doe',
      guestContact: 'john@example.com',
      internalNotes: 'VIP guest',
    })

    expect(result).toEqual({ status: 'ok' })

    const reservation = await prisma.reservation.findFirst({
      where: { siteId: site.id },
      include: { items: true },
    })
    expect(reservation).not.toBeNull()
    expect(reservation!.status).toBe('paid-in-cash')
    expect(reservation!.operationalStatus).toBe('expected')
    expect(reservation!.guestName).toBe('John Doe')
    expect(reservation!.guestContact).toBe('john@example.com')
    expect(reservation!.internalNotes).toBe('VIP guest')
    expect(reservation!.items).toHaveLength(1)
    expect(reservation!.items[0].id).toBe(item.id)
  })

  it('creates reservation with complete status for free payment', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    const item = await createTestInventoryItem(user.id, site.id)
    mockUserId = user.id

    const result = await createPartnerReservation({
      siteId: site.id,
      itemIds: [item.id],
      from: '2026-07-01',
      to: '2026-07-03',
      paymentType: 'free',
    })

    expect(result).toEqual({ status: 'ok' })

    const reservation = await prisma.reservation.findFirst({
      where: { siteId: site.id },
    })
    expect(reservation!.status).toBe('complete')
    expect(reservation!.operationalStatus).toBe('expected')
  })

  it('rejects double-booking for same item and overlapping dates', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    const item = await createTestInventoryItem(user.id, site.id)
    mockUserId = user.id

    // First reservation succeeds
    await createPartnerReservation({
      siteId: site.id,
      itemIds: [item.id],
      from: '2026-07-01',
      to: '2026-07-05',
      paymentType: 'cash',
    })

    // Overlapping reservation should fail
    const result = await createPartnerReservation({
      siteId: site.id,
      itemIds: [item.id],
      from: '2026-07-03',
      to: '2026-07-07',
      paymentType: 'cash',
    })

    expect(result.status).toBe('error')
    expect(result.errors).toContain('One or more sunbeds are already reserved for this period')

    // Verify only 1 reservation exists in DB
    const count = await prisma.reservation.count({ where: { siteId: site.id } })
    expect(count).toBe(1)
  })

  it('allows booking same item on non-overlapping dates', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    const item = await createTestInventoryItem(user.id, site.id)
    mockUserId = user.id

    await createPartnerReservation({
      siteId: site.id,
      itemIds: [item.id],
      from: '2026-07-01',
      to: '2026-07-03',
      paymentType: 'cash',
    })

    const result = await createPartnerReservation({
      siteId: site.id,
      itemIds: [item.id],
      from: '2026-07-10',
      to: '2026-07-12',
      paymentType: 'cash',
    })

    expect(result).toEqual({ status: 'ok' })

    const count = await prisma.reservation.count({ where: { siteId: site.id } })
    expect(count).toBe(2)
  })

  it('allows booking on dates where existing reservation is canceled', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    const item = await createTestInventoryItem(user.id, site.id)
    mockUserId = user.id

    // Create a canceled reservation directly in DB
    await createTestReservation(user.id, site.id, [item.id], {
      from: new Date('2026-07-01'),
      to: new Date('2026-07-05'),
      status: 'canceled',
      operationalStatus: 'expected',
    })

    const result = await createPartnerReservation({
      siteId: site.id,
      itemIds: [item.id],
      from: '2026-07-01',
      to: '2026-07-05',
      paymentType: 'cash',
    })

    expect(result).toEqual({ status: 'ok' })

    const reservations = await prisma.reservation.findMany({ where: { siteId: site.id } })
    expect(reservations).toHaveLength(2)
  })

  it('allows booking on dates where existing reservation is no-show or departed', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    const item1 = await createTestInventoryItem(user.id, site.id, { number: 1 })
    const item2 = await createTestInventoryItem(user.id, site.id, { number: 2 })
    mockUserId = user.id

    // no-show reservation
    await createTestReservation(user.id, site.id, [item1.id], {
      from: new Date('2026-07-01'),
      to: new Date('2026-07-05'),
      status: 'complete',
      operationalStatus: 'no-show',
    })

    // departed reservation
    await createTestReservation(user.id, site.id, [item2.id], {
      from: new Date('2026-07-01'),
      to: new Date('2026-07-05'),
      status: 'complete',
      operationalStatus: 'departed',
    })

    // Book both items for the same dates — should succeed
    const result = await createPartnerReservation({
      siteId: site.id,
      itemIds: [item1.id, item2.id],
      from: '2026-07-01',
      to: '2026-07-05',
      paymentType: 'cash',
    })

    expect(result).toEqual({ status: 'ok' })
  })

  it('rejects booking inactive items and creates nothing in DB', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    const activeItem = await createTestInventoryItem(user.id, site.id, { number: 1, status: 'active' })
    const inactiveItem = await createTestInventoryItem(user.id, site.id, { number: 2, status: 'inactive' })
    mockUserId = user.id

    const result = await createPartnerReservation({
      siteId: site.id,
      itemIds: [activeItem.id, inactiveItem.id],
      from: '2026-07-01',
      to: '2026-07-03',
      paymentType: 'cash',
    })

    expect(result.status).toBe('error')
    expect(result.errors).toContain('Some sunbeds not found or inactive')

    const count = await prisma.reservation.count({ where: { siteId: site.id } })
    expect(count).toBe(0)
  })

  it('rejects empty itemIds', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    mockUserId = user.id

    const result = await createPartnerReservation({
      siteId: site.id,
      itemIds: [],
      from: '2026-07-01',
      to: '2026-07-03',
      paymentType: 'cash',
    })

    expect(result.status).toBe('error')
    expect(result.errors).toContain('Select at least one sunbed')
  })

  it('rejects non-owner and creates nothing in DB', async () => {
    const owner = await createTestUser()
    const stranger = await createTestUser()
    const site = await createTestSite(owner.id)
    const item = await createTestInventoryItem(owner.id, site.id)
    mockUserId = stranger.id

    const result = await createPartnerReservation({
      siteId: site.id,
      itemIds: [item.id],
      from: '2026-07-01',
      to: '2026-07-03',
      paymentType: 'cash',
    })

    expect(result.status).toBe('error')
    expect(result.errors).toContain('Not authorized')

    const count = await prisma.reservation.count({ where: { siteId: site.id } })
    expect(count).toBe(0)
  })

  it('auto-includes paired item in the reservation', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    // Create item A, then item B paired to A
    const itemA = await createTestInventoryItem(user.id, site.id, { number: 1 })
    const itemB = await createTestInventoryItem(user.id, site.id, { number: 2, pairId: itemA.id })
    mockUserId = user.id

    // Only select itemA — itemB should be auto-included via pairId
    const result = await createPartnerReservation({
      siteId: site.id,
      itemIds: [itemA.id],
      from: '2026-07-01',
      to: '2026-07-03',
      paymentType: 'cash',
    })

    expect(result).toEqual({ status: 'ok' })

    const reservation = await prisma.reservation.findFirst({
      where: { siteId: site.id },
      include: { items: { orderBy: { number: 'asc' } } },
    })
    expect(reservation!.items).toHaveLength(2)
    const itemIds = reservation!.items.map(i => i.id).sort()
    expect(itemIds).toEqual([itemA.id, itemB.id].sort())
  })

  it('truncates guest fields to their limits in the DB', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    const item = await createTestInventoryItem(user.id, site.id)
    mockUserId = user.id

    const longName = 'A'.repeat(300)
    const longContact = 'B'.repeat(300)
    const longNotes = 'C'.repeat(700)

    const result = await createPartnerReservation({
      siteId: site.id,
      itemIds: [item.id],
      from: '2026-07-01',
      to: '2026-07-03',
      paymentType: 'cash',
      guestName: longName,
      guestContact: longContact,
      internalNotes: longNotes,
    })

    expect(result).toEqual({ status: 'ok' })

    const reservation = await prisma.reservation.findFirst({
      where: { siteId: site.id },
    })
    expect(reservation!.guestName).toHaveLength(200)
    expect(reservation!.guestContact).toHaveLength(200)
    expect(reservation!.internalNotes).toHaveLength(500)
  })
})

// ---------------------------------------------------------------------------
// getAvailableSunbeds
// ---------------------------------------------------------------------------

describe('getAvailableSunbeds', () => {
  it('returns all active items when no reservations exist', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    const item1 = await createTestInventoryItem(user.id, site.id, { number: 1 })
    const item2 = await createTestInventoryItem(user.id, site.id, { number: 2 })
    mockUserId = user.id

    const result = await getAvailableSunbeds(site.id, '2026-07-01', '2026-07-03')

    expect(result.status).toBe('ok')
    expect(result.items).toHaveLength(2)
    const ids = result.items.map(i => i.id).sort()
    expect(ids).toEqual([item1.id, item2.id].sort())
  })

  it('excludes items with active reservations for the date range', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    const item1 = await createTestInventoryItem(user.id, site.id, { number: 1 })
    const item2 = await createTestInventoryItem(user.id, site.id, { number: 2 })
    mockUserId = user.id

    // Reserve item1 for overlapping dates
    await createTestReservation(user.id, site.id, [item1.id], {
      from: new Date('2026-07-01'),
      to: new Date('2026-07-05'),
      status: 'complete',
      operationalStatus: 'expected',
    })

    const result = await getAvailableSunbeds(site.id, '2026-07-03', '2026-07-07')

    expect(result.status).toBe('ok')
    expect(result.items).toHaveLength(1)
    expect(result.items[0].id).toBe(item2.id)
  })

  it('includes items whose only reservations are canceled, no-show, or departed', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    const item1 = await createTestInventoryItem(user.id, site.id, { number: 1 })
    const item2 = await createTestInventoryItem(user.id, site.id, { number: 2 })
    const item3 = await createTestInventoryItem(user.id, site.id, { number: 3 })
    mockUserId = user.id

    // canceled reservation
    await createTestReservation(user.id, site.id, [item1.id], {
      from: new Date('2026-07-01'),
      to: new Date('2026-07-05'),
      status: 'canceled',
      operationalStatus: 'expected',
    })

    // no-show reservation
    await createTestReservation(user.id, site.id, [item2.id], {
      from: new Date('2026-07-01'),
      to: new Date('2026-07-05'),
      status: 'complete',
      operationalStatus: 'no-show',
    })

    // departed reservation
    await createTestReservation(user.id, site.id, [item3.id], {
      from: new Date('2026-07-01'),
      to: new Date('2026-07-05'),
      status: 'complete',
      operationalStatus: 'departed',
    })

    const result = await getAvailableSunbeds(site.id, '2026-07-01', '2026-07-05')

    expect(result.status).toBe('ok')
    expect(result.items).toHaveLength(3)
  })

  it('does not return inactive items', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    await createTestInventoryItem(user.id, site.id, { number: 1, status: 'active' })
    await createTestInventoryItem(user.id, site.id, { number: 2, status: 'inactive' })
    mockUserId = user.id

    const result = await getAvailableSunbeds(site.id, '2026-07-01', '2026-07-03')

    expect(result.status).toBe('ok')
    expect(result.items).toHaveLength(1)
  })

  it('rejects non-owner', async () => {
    const owner = await createTestUser()
    const stranger = await createTestUser()
    const site = await createTestSite(owner.id)
    await createTestInventoryItem(owner.id, site.id)
    mockUserId = stranger.id

    const result = await getAvailableSunbeds(site.id, '2026-07-01', '2026-07-03')

    expect(result.status).toBe('error')
    expect(result.errors).toContain('Not authorized')
    expect(result.items).toEqual([])
  })
})
