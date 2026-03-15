import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'

vi.mock('@/app/auth', () => ({
  auth: vi.fn().mockResolvedValue(null),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

// Availability service mocked — we test DB writes, not availability logic
vi.mock('@/service/availabilityService', () => ({
  getAvailability: vi.fn().mockResolvedValue([]),
}))

import { saveReservationForMultipleItems, saveRentalBooking } from './actions'
import { auth } from '@/app/auth'
import { getAvailability } from '@/service/availabilityService'
import { cleanDatabase, disconnectDatabase, prisma } from '@/app/test/setup'
import {
  createTestUser,
  createTestSite,
  createTestInventoryItem,
  createTestRentalItem,
  createTestRentalBooking,
} from '@/app/test/fixtures'

const mockAuth = vi.mocked(auth)
const mockGetAvailability = vi.mocked(getAvailability)

beforeEach(async () => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue(null)
  await cleanDatabase()
})

afterAll(async () => {
  await disconnectDatabase()
})

// ─── saveReservationForMultipleItems ──────────────────────────────────────

describe('saveReservationForMultipleItems', () => {
  it('creates reservation in DB and returns its id', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    const item = await createTestInventoryItem(user.id, site.id)

    mockAuth.mockResolvedValue({ user: { id: user.id } } as any)
    mockGetAvailability.mockResolvedValue([{ itemId: item.id, available: true }] as any)

    const res = await saveReservationForMultipleItems({
      siteId: site.id,
      items: [{ id: item.id } as any],
      type: 'days',
      from: '2025-07-01',
      to: '2025-07-02',
    })

    expect(res.status).toBe('ok')
    expect(res.id).toBeDefined()

    const created = await prisma.reservation.findUnique({ where: { id: res.id! } })
    expect(created).not.toBeNull()
    expect(created!.userId).toBe(user.id)
    expect(created!.siteId).toBe(site.id)
    expect(created!.status).toBe('pending')
  })

  it('calculates payment amount from site price × items × days', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id, { price: 20.0 })
    const item1 = await createTestInventoryItem(user.id, site.id, { number: 1 })
    const item2 = await createTestInventoryItem(user.id, site.id, { number: 2 })

    mockAuth.mockResolvedValue({ user: { id: user.id } } as any)
    mockGetAvailability.mockResolvedValue([
      { itemId: item1.id, available: true },
      { itemId: item2.id, available: true },
    ] as any)

    const res = await saveReservationForMultipleItems({
      siteId: site.id,
      items: [{ id: item1.id } as any, { id: item2.id } as any],
      type: 'days',
      from: '2025-07-01',
      to: '2025-07-04', // 3 days
    })

    expect(res.status).toBe('ok')
    const created = await prisma.reservation.findUnique({ where: { id: res.id! } })
    // 2 items × 20.00 × 3 days = 120
    expect(created!.paymentAmount).toBe(120)
  })

  // BUG: source reads item.price from client input, not from DB.
  // Client can send price: 1.0 while DB item has price: 30.0.
  // Payment amount should always be calculated from DB prices.
  it('uses DB item price — rejects client-supplied price override', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id, { price: 10.0 })
    // DB price is 30 — client will attempt to send price: 1 to underpay
    const item = await createTestInventoryItem(user.id, site.id, { price: 30.0 })

    mockAuth.mockResolvedValue({ user: { id: user.id } } as any)
    mockGetAvailability.mockResolvedValue([{ itemId: item.id, available: true }] as any)

    const res = await saveReservationForMultipleItems({
      siteId: site.id,
      items: [{ id: item.id, price: 1.0 } as any], // client tries to underpay
      type: 'days',
      from: '2025-07-01',
      to: '2025-07-02', // 1 day
    })

    expect(res.status).toBe('ok')
    const created = await prisma.reservation.findUnique({ where: { id: res.id! } })
    // Must use DB price 30, not client price 1
    expect(created!.paymentAmount).toBe(30)
  })

  it('creates reservation with status=complete and zero amount for unpaid site', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id, { type: 'unpaid', price: null })
    const item = await createTestInventoryItem(user.id, site.id)

    mockAuth.mockResolvedValue({ user: { id: user.id } } as any)
    mockGetAvailability.mockResolvedValue([{ itemId: item.id, available: true }] as any)

    const res = await saveReservationForMultipleItems({
      siteId: site.id,
      items: [{ id: item.id } as any],
      type: 'days',
      from: '2025-07-01',
      to: '2025-07-02',
    })

    expect(res.status).toBe('ok')
    const created = await prisma.reservation.findUnique({ where: { id: res.id! } })
    expect(created!.status).toBe('complete')
    expect(created!.paymentAmount).toBe(0)
  })

  it('stores anonId and uses site owner userId for anonymous reservations', async () => {
    const owner = await createTestUser()
    const site = await createTestSite(owner.id, { type: 'unpaid', price: null })
    const item = await createTestInventoryItem(owner.id, site.id)

    // No session — anonymous user
    mockGetAvailability.mockResolvedValue([{ itemId: item.id, available: true }] as any)

    const res = await saveReservationForMultipleItems({
      anonId: 'anon-abc',
      siteId: site.id,
      items: [{ id: item.id } as any],
      type: 'days',
      from: '2025-07-01',
      to: '2025-07-02',
    })

    expect(res.status).toBe('ok')
    const created = await prisma.reservation.findUnique({ where: { id: res.id! } })
    expect(created!.anonId).toBe('anon-abc')
    expect(created!.userId).toBe(owner.id) // site owner's userId as FK
  })

  it('rejects client-supplied userId when no session — prevents impersonation', async () => {
    const victim = await createTestUser()
    const site = await createTestSite(victim.id, { type: 'unpaid', price: null })
    const item = await createTestInventoryItem(victim.id, site.id)

    // No session, no anonId — only a client-supplied userId (impersonation attempt)
    mockGetAvailability.mockResolvedValue([{ itemId: item.id, available: true }] as any)

    const res = await saveReservationForMultipleItems({
      userId: victim.id, // should never be trusted
      siteId: site.id,
      items: [{ id: item.id } as any],
      type: 'days',
      from: '2025-07-01',
      to: '2025-07-02',
    })

    expect(res.status).toBe('error')
    expect(res.errors).toContain('Authentication required')
    const count = await prisma.reservation.count({ where: { siteId: site.id } })
    expect(count).toBe(0)
  })

  it('rejects reservation where from >= to — no backwards date range', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    const item = await createTestInventoryItem(user.id, site.id)

    mockAuth.mockResolvedValue({ user: { id: user.id } } as any)

    const res = await saveReservationForMultipleItems({
      siteId: site.id,
      items: [{ id: item.id } as any],
      type: 'days',
      from: '2025-07-03',
      to: '2025-07-01', // backwards
    })

    expect(res.status).toBe('error')
    const count = await prisma.reservation.count({ where: { siteId: site.id } })
    expect(count).toBe(0)
  })

  it('rejects reservation with no items on a paid site', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id, { price: 15.0 })

    mockAuth.mockResolvedValue({ user: { id: user.id } } as any)

    const res = await saveReservationForMultipleItems({
      siteId: site.id,
      items: [],
      type: 'days',
      from: '2025-07-01',
      to: '2025-07-02',
    })

    expect(res.status).toBe('error')
    const count = await prisma.reservation.count({ where: { siteId: site.id } })
    expect(count).toBe(0)
  })

  it('returns error when requested item is not available', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    const item = await createTestInventoryItem(user.id, site.id)

    mockAuth.mockResolvedValue({ user: { id: user.id } } as any)
    mockGetAvailability.mockResolvedValue([{ itemId: item.id, available: false }] as any)

    const res = await saveReservationForMultipleItems({
      siteId: site.id,
      items: [{ id: item.id } as any],
      type: 'days',
      from: '2025-07-01',
      to: '2025-07-02',
    })

    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toContain('not available')
    const count = await prisma.reservation.count({ where: { siteId: site.id } })
    expect(count).toBe(0)
  })
})

// ─── saveRentalBooking ────────────────────────────────────────────────────

describe('saveRentalBooking', () => {
  it('creates rental booking in DB with correct daily pricing', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    const item = await createTestRentalItem(site.id, { pricePerDay: 20.0, totalQuantity: 5 })

    mockAuth.mockResolvedValue({ user: { id: user.id } } as any)

    const res = await saveRentalBooking({
      siteId: site.id,
      items: [{ rentalItemId: item.id, quantity: 2 }],
      durationType: 'days',
      from: '2025-07-01T10:00:00Z',
      to: '2025-07-03T10:00:00Z', // 2 days
    })

    expect(res.status).toBe('ok')
    expect(res.bookingIds).toHaveLength(1)

    const booking = await prisma.rentalBooking.findUnique({ where: { id: res.bookingIds![0] } })
    expect(booking).not.toBeNull()
    // 20 per day × 2 days × 2 qty = 80
    expect(booking!.totalPrice).toBe(80)
    expect(booking!.quantity).toBe(2)
    expect(booking!.status).toBe('pending')
  })

  it('creates booking with status=complete for unpaid site', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id, { type: 'unpaid' })
    const item = await createTestRentalItem(site.id, { totalQuantity: 5 })

    mockAuth.mockResolvedValue({ user: { id: user.id } } as any)

    const res = await saveRentalBooking({
      siteId: site.id,
      items: [{ rentalItemId: item.id, quantity: 1 }],
      durationType: 'days',
      from: '2025-07-01T10:00:00Z',
      to: '2025-07-02T10:00:00Z',
    })

    expect(res.status).toBe('ok')
    const booking = await prisma.rentalBooking.findUnique({ where: { id: res.bookingIds![0] } })
    expect(booking!.status).toBe('complete')
  })

  it('blocks overbooking via real DB aggregate query', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    // Only 3 total, create an existing booking for 2 (operationalStatus='reserved' so it counts)
    const item = await createTestRentalItem(site.id, { totalQuantity: 3 })
    await createTestRentalBooking(site.id, item.id, user.id, {
      quantity: 2,
      from: new Date('2025-07-01T10:00:00Z'),
      to: new Date('2025-07-03T10:00:00Z'),
      operationalStatus: 'reserved',
    })

    mockAuth.mockResolvedValue({ user: { id: user.id } } as any)

    // Try to book 2 more — only 1 is available
    const res = await saveRentalBooking({
      siteId: site.id,
      items: [{ rentalItemId: item.id, quantity: 2 }],
      durationType: 'days',
      from: '2025-07-01T10:00:00Z',
      to: '2025-07-03T10:00:00Z',
    })

    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toContain('Only 1')
    const count = await prisma.rentalBooking.count({ where: { siteId: site.id } })
    expect(count).toBe(1) // only the pre-existing booking
  })

  it('calculates hourly pricing when durationType is hours', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    const item = await createTestRentalItem(site.id, {
      pricePerHour: 5.0,
      pricePerDay: null,
      totalQuantity: 5,
    })

    mockAuth.mockResolvedValue({ user: { id: user.id } } as any)

    const res = await saveRentalBooking({
      siteId: site.id,
      items: [{ rentalItemId: item.id, quantity: 1 }],
      durationType: 'hours',
      from: '2025-07-01T10:00:00Z',
      to: '2025-07-01T13:00:00Z', // 3 hours
    })

    expect(res.status).toBe('ok')
    const booking = await prisma.rentalBooking.findUnique({ where: { id: res.bookingIds![0] } })
    // 5 per hour × 3 hours × 1 qty = 15
    expect(booking!.totalPrice).toBe(15)
  })

  it('rejects rental booking where from >= to — no backwards date range', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    const item = await createTestRentalItem(site.id, { totalQuantity: 5 })

    mockAuth.mockResolvedValue({ user: { id: user.id } } as any)

    const res = await saveRentalBooking({
      siteId: site.id,
      items: [{ rentalItemId: item.id, quantity: 1 }],
      durationType: 'days',
      from: '2025-07-03T10:00:00Z',
      to: '2025-07-01T10:00:00Z', // backwards
    })

    expect(res.status).toBe('error')
    const count = await prisma.rentalBooking.count({ where: { siteId: site.id } })
    expect(count).toBe(0)
  })
})
