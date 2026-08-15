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
  getAvailabilityForItems: vi.fn().mockResolvedValue([]),
}))

import { saveReservationForMultipleItems, saveRentalBooking, findAnonRentalBooking } from './actions'
import { auth } from '@/app/auth'
import { getAvailabilityForItems } from '@/service/availabilityService'
import { cleanDatabase, disconnectDatabase, prisma } from '@/app/test/setup'
import {
  createTestUser,
  createTestSite,
  createTestInventoryItem,
  createTestSunbedGroup,
  createTestRentalItem,
  createTestRentalBooking,
} from '@/app/test/fixtures'

const mockAuth = vi.mocked(auth)
// The action validates via the SCOPED variant since track 020 P2.
const mockGetAvailability = vi.mocked(getAvailabilityForItems)

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

  it('venue-anchors from/to to the site timezone, not the browser/server TZ (track 017 P3)', async () => {
    const user = await createTestUser()
    // Europe/Madrid = UTC+2 in August. Civil day N = [N-1 22:00Z, N 21:59:59.999Z].
    const site = await createTestSite(user.id, { timeZone: 'Europe/Madrid' })
    const item = await createTestInventoryItem(user.id, site.id)

    mockAuth.mockResolvedValue({ user: { id: user.id } } as any)
    mockGetAvailability.mockResolvedValue([{ itemId: item.id, available: true }] as any)

    const res = await saveReservationForMultipleItems({
      siteId: site.id,
      items: [{ id: item.id } as any],
      type: 'days',
      from: '2025-08-13',
      to: '2025-08-15', // INCLUSIVE last day → 3 occupied days (Aug 13, 14, 15)
    })

    expect(res.status).toBe('ok')
    const created = await prisma.reservation.findUnique({ where: { id: res.id! } })
    // from = venue-midnight of Aug 13; to = venue END-OF-DAY of Aug 15 (the
    // picker emits [firstDay.startOf, lastDay.endOf] — `to` is the inclusive
    // last day of the stay) — both anchored to Madrid, not the server's UTC day.
    expect(created!.from.toISOString()).toBe('2025-08-12T22:00:00.000Z')
    expect(created!.to.toISOString()).toBe('2025-08-15T21:59:59.999Z')
  })

  // Bug-revealing (2026-08-15 founder report): the reserve-first default flow
  // (track 014) books a SINGLE day — dateRange [today.start, today.end], which
  // serialises to the SAME civil date for from and to. Under 017 P3's original
  // exclusive-checkout anchoring both ends landed on venue midnight and every
  // one-day booking was rejected with "End date must be after start date".
  it('accepts a one-day booking (from == to civil date) and bills exactly one day', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id, { price: 20.0, timeZone: 'Europe/Madrid' })
    const item = await createTestInventoryItem(user.id, site.id)

    mockAuth.mockResolvedValue({ user: { id: user.id } } as any)
    mockGetAvailability.mockResolvedValue([{ itemId: item.id, available: true }] as any)

    const res = await saveReservationForMultipleItems({
      siteId: site.id,
      items: [{ id: item.id } as any],
      type: 'days',
      from: '2025-08-13',
      to: '2025-08-13',
    })

    expect(res.status).toBe('ok')
    const created = await prisma.reservation.findUnique({ where: { id: res.id! } })
    // One venue civil day: [Aug 13 00:00, Aug 13 23:59:59.999] Madrid.
    expect(created!.from.toISOString()).toBe('2025-08-12T22:00:00.000Z')
    expect(created!.to.toISOString()).toBe('2025-08-13T21:59:59.999Z')
    // 1 item × 20.00 × 1 day
    expect(created!.paymentAmount).toBe(20)
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
      to: '2025-07-03', // inclusive last day → 3 days (Jul 1, 2, 3)
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
      to: '2025-07-01', // inclusive → 1 day
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

  // BUG-REVEALING: pair-expansion double-booking (suspected bug #2).
  //
  // Before the guard: the page expands SunbedGroup siblings and sends all item IDs
  // to this action. The action checked availability on the expanded set (correct),
  // but used prisma.reservation.create (two separate awaits vs the conflict check).
  // A concurrent request that already claimed the sibling between the check and the
  // create would succeed in double-booking it.
  //
  // After the guard: reserveWithConflictGuard locks all candidate InventoryItem rows
  // FOR UPDATE, re-checks conflict inside the same transaction, and returns
  // { outcome: 'conflict' } rather than creating.
  //
  // This test simulates the scenario where a sibling in a SunbedGroup is already
  // reserved (as if a concurrent request already committed), then calls the action
  // requesting the primary — passing the full expanded set (primary + sibling).
  // Before the fix this would silently double-book the sibling; after the fix it
  // returns a conflict error.
  it('rejects reservation when a SunbedGroup sibling is already reserved — prevents pair-expansion double-booking', async () => {
    const owner = await createTestUser()
    const customer = await createTestUser()
    const site = await createTestSite(owner.id, { price: 20.0 })

    // Create two items and group them as a SunbedGroup (the page would expand
    // a request for item1 to include item2 as its sibling).
    const item1 = await createTestInventoryItem(owner.id, site.id, { number: 1 })
    const item2 = await createTestInventoryItem(owner.id, site.id, { number: 2 })
    await createTestSunbedGroup(site.id, [item1.id, item2.id])

    // Simulate item2 already reserved (concurrent request already committed).
    await prisma.reservation.create({
      data: {
        userId: owner.id,
        siteId: site.id,
        from: new Date('2025-07-01'),
        to: new Date('2025-07-02'),
        type: 'days',
        status: 'pending',
        paymentAmount: 20,
        items: { connect: [{ id: item2.id }] },
      },
    })

    mockAuth.mockResolvedValue({ user: { id: customer.id } } as any)
    // The page expanded item1 to [item1, item2] — so the action receives both.
    // Availability service is mocked: both appear available (it hasn't learned
    // of the concurrent commit yet — that's the race window).
    mockGetAvailability.mockResolvedValue([
      { itemId: item1.id, available: true },
      { itemId: item2.id, available: true },
    ] as any)

    // The guard's in-tx re-check sees item2 is already reserved → conflict.
    const res = await saveReservationForMultipleItems({
      siteId: site.id,
      items: [{ id: item1.id } as any, { id: item2.id } as any],
      type: 'days',
      from: '2025-07-01',
      to: '2025-07-02',
    })

    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toContain('not available')

    // Only the pre-existing reservation for item2 exists — no double-booking created.
    const count = await prisma.reservation.count({ where: { siteId: site.id } })
    expect(count).toBe(1)
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
    // The guard returns a "not enough ... available" message (not the old inline
    // "Only N available" message from the pre-guard aggregate-then-create path).
    expect(res.errors?.[0]).toContain('Beach Umbrella')
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

  // ── Anonymous path integration tests ─────────────────────────────────────

  // BUG-REVEALING: before Phase 1b, saveRentalBooking was auth-only. An anonymous
  // user (no session, only anonId) would receive "Authentication required" and no
  // booking would be created. After the fix, anon bookings succeed with the site
  // owner's userId as the FK placeholder and the anonId persisted on the row.
  it('anon path: persists anonId and uses site owner userId as FK', async () => {
    const owner = await createTestUser()
    const site = await createTestSite(owner.id, { type: 'paid', price: 10.0 })
    const item = await createTestRentalItem(site.id, { pricePerDay: 20.0, totalQuantity: 5 })

    // No session — anonymous user
    const res = await saveRentalBooking({
      siteId: site.id,
      items: [{ rentalItemId: item.id, quantity: 1 }],
      durationType: 'days',
      from: '2025-07-01T10:00:00Z',
      to: '2025-07-02T10:00:00Z',
      anonId: 'anon-test-uuid-1234',
      guestEmail: 'anon@example.com',
    })

    expect(res.status).toBe('ok')
    expect(res.bookingIds).toHaveLength(1)

    const booking = await prisma.rentalBooking.findUnique({ where: { id: res.bookingIds![0] } })
    expect(booking).not.toBeNull()
    // Site owner's userId used as FK placeholder
    expect(booking!.userId).toBe(owner.id)
    // Real anonymous customer identity stored
    expect(booking!.anonId).toBe('anon-test-uuid-1234')
    expect(booking!.guestEmail).toBe('anon@example.com')
  })

  // The auth path must continue to set the real userId (no regression).
  it('auth path: still sets real userId (not owner FK)', async () => {
    const owner = await createTestUser()
    const customer = await createTestUser()
    const site = await createTestSite(owner.id)
    const item = await createTestRentalItem(site.id, { totalQuantity: 5 })

    mockAuth.mockResolvedValue({ user: { id: customer.id } } as any)

    const res = await saveRentalBooking({
      siteId: site.id,
      items: [{ rentalItemId: item.id, quantity: 1 }],
      durationType: 'days',
      from: '2025-07-01T10:00:00Z',
      to: '2025-07-02T10:00:00Z',
    })

    expect(res.status).toBe('ok')
    const booking = await prisma.rentalBooking.findUnique({ where: { id: res.bookingIds![0] } })
    // Real customer userId, not owner FK
    expect(booking!.userId).toBe(customer.id)
    expect(booking!.anonId).toBeNull()
  })

  // Missing-both guard: no session AND no anonId → rejected (no booking written).
  it('anon path: rejected when no session and no anonId', async () => {
    const owner = await createTestUser()
    const site = await createTestSite(owner.id)
    const item = await createTestRentalItem(site.id, { totalQuantity: 5 })

    // No session, no anonId
    const res = await saveRentalBooking({
      siteId: site.id,
      items: [{ rentalItemId: item.id, quantity: 1 }],
      durationType: 'days',
      from: '2025-07-01T10:00:00Z',
      to: '2025-07-02T10:00:00Z',
    })

    expect(res.status).toBe('error')
    expect(res.errors).toContain('Authentication required')
    const count = await prisma.rentalBooking.count({ where: { siteId: site.id } })
    expect(count).toBe(0)
  })
})

// ─── findAnonRentalBooking — cross-anon isolation ─────────────────────────
//
// Key regression guard: anon A's lookup must ONLY return A's bookings, never B's.
// This test uses real DB writes to verify isolation holds end-to-end through
// Prisma, mirroring the pattern in partner search-isolation tests.

describe('findAnonRentalBooking (cross-anon isolation)', () => {
  it('returns only the calling anon\'s booking, not another anon\'s', async () => {
    const owner = await createTestUser()
    const site = await createTestSite(owner.id)
    const item = await createTestRentalItem(site.id, { totalQuantity: 10 })

    const anonA = 'aaaaaaaa-0000-0000-0000-000000000001'
    const anonB = 'bbbbbbbb-0000-0000-0000-000000000002'

    // Both anon A and anon B have active (complete) bookings on the same site/item,
    // with a time range that includes "now" so the active window filter passes.
    const now = new Date()
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000)
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000)

    const bookingA = await createTestRentalBooking(site.id, item.id, owner.id, {
      anonId: anonA,
      status: 'complete',
      from: yesterday,
      to: tomorrow,
    })
    const bookingB = await createTestRentalBooking(site.id, item.id, owner.id, {
      anonId: anonB,
      status: 'complete',
      from: yesterday,
      to: tomorrow,
    })

    // A's lookup returns only A's booking
    const resultA = await findAnonRentalBooking(anonA, site.id)
    expect(resultA).not.toBeNull()
    expect(resultA!.id).toBe(bookingA.id)
    expect(resultA!.anonId).toBe(anonA)

    // B's lookup returns only B's booking, not A's
    const resultB = await findAnonRentalBooking(anonB, site.id)
    expect(resultB).not.toBeNull()
    expect(resultB!.id).toBe(bookingB.id)
    expect(resultB!.anonId).toBe(anonB)

    // Critically: A's result is NOT B's booking, and vice versa
    expect(resultA!.id).not.toBe(bookingB.id)
    expect(resultB!.id).not.toBe(bookingA.id)
  })

  it('returns null for an anon with no bookings on the site', async () => {
    const owner = await createTestUser()
    const site = await createTestSite(owner.id)
    const item = await createTestRentalItem(site.id, { totalQuantity: 5 })

    const anonA = 'aaaaaaaa-0000-0000-0000-000000000001'
    const anonUnknown = 'cccccccc-0000-0000-0000-000000000003'

    const now = new Date()
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000)
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000)

    // Only anon A has a booking
    await createTestRentalBooking(site.id, item.id, owner.id, {
      anonId: anonA,
      status: 'complete',
      from: yesterday,
      to: tomorrow,
    })

    // An unrelated anon gets null
    const result = await findAnonRentalBooking(anonUnknown, site.id)
    expect(result).toBeNull()
  })

  it('ignores bookings outside the active time window (expired)', async () => {
    const owner = await createTestUser()
    const site = await createTestSite(owner.id)
    const item = await createTestRentalItem(site.id, { totalQuantity: 5 })

    const anonA = 'aaaaaaaa-0000-0000-0000-000000000001'

    // Booking that ended yesterday — not "active" anymore
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000)

    await createTestRentalBooking(site.id, item.id, owner.id, {
      anonId: anonA,
      status: 'complete',
      from: twoDaysAgo,
      to: yesterday, // expired — ends before now
    })

    // findAnonRentalBooking should not return expired bookings
    const result = await findAnonRentalBooking(anonA, site.id)
    expect(result).toBeNull()
  })
})
