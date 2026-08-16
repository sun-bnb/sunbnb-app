import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import { cleanDatabase, disconnectDatabase, prisma } from '@/app/test/setup'
import {
  createTestUser,
  createTestSite,
  createTestInventoryItem,
  createTestReservation,
  createTestPairedUnit,
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
// UTC-anchored "today" helpers — the pinned test sites below use
// `timeZone: 'UTC'`, so hand-built "today" windows must be computed in UTC
// (not the test-runner machine's local TZ) to stay deterministic and aligned
// with the venue-anchored bounds the actions now compute (track 017 P3).
// Mirrors apps/user/service/siteService.integration.test.ts's `todayBounds`.
// ---------------------------------------------------------------------------

function utcDayKey(offsetDays: number = 0): string {
  const d = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

function utcDayBounds(offsetDays: number): { start: Date; end: Date } {
  const d = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000)
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0))
  const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999))
  return { start, end }
}

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
    const site = await createTestSite(user.id, { timeZone: 'UTC' })
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
    const site = await createTestSite(user.id, { timeZone: 'UTC' })
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
    const site = await createTestSite(user.id, { timeZone: 'UTC' })
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
    const site = await createTestSite(user.id, { timeZone: 'UTC' })
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
    const site = await createTestSite(user.id, { timeZone: 'UTC' })
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

  // track 012: operational status never frees a bed. A no-show/departed
  // reservation still blocks its date range (a departed day-1 of a multiday stay
  // must not free days 2–3); reuse is an explicit release, not an op-status effect.
  it('rejects booking over a no-show/departed reservation (op-status never frees a bed)', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id, { timeZone: 'UTC' })
    const item1 = await createTestInventoryItem(user.id, site.id, { number: 1 })
    const item2 = await createTestInventoryItem(user.id, site.id, { number: 2 })
    mockUserId = user.id

    // A stay whose last day is in the FUTURE so the departed/no-show beds are NOT
    // yet released (the release only fires once `to <= endOfToday`). Dates are
    // relative to today so the test can't age into "stay over" — a hardcoded
    // 2026-07-05 `to` silently became today and freed the beds.
    const resFrom = utcDayBounds(-1).start
    const resTo = utcDayBounds(3).end

    // no-show reservation
    await createTestReservation(user.id, site.id, [item1.id], {
      from: resFrom,
      to: resTo,
      status: 'complete',
      operationalStatus: 'no-show',
    })

    // departed reservation
    await createTestReservation(user.id, site.id, [item2.id], {
      from: resFrom,
      to: resTo,
      status: 'complete',
      operationalStatus: 'departed',
    })

    // Book both items for an overlapping range — rejected (both beds still held).
    const result = await createPartnerReservation({
      siteId: site.id,
      itemIds: [item1.id, item2.id],
      from: utcDayKey(0),
      to: utcDayKey(2),
      paymentType: 'cash',
    })

    expect(result.status).toBe('error')
  })

  it('rejects booking inactive items and creates nothing in DB', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id, { timeZone: 'UTC' })
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
    const site = await createTestSite(user.id, { timeZone: 'UTC' })
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
    const site = await createTestSite(owner.id, { timeZone: 'UTC' })
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
    const site = await createTestSite(user.id, { timeZone: 'UTC' })
    // Create item A, then item B paired to A
    const pairedUnit = await createTestPairedUnit(user.id, site.id, [1, 2])
    const itemA = pairedUnit.itemA
    const itemB = pairedUnit.itemB
    mockUserId = user.id

    // Only select itemA — itemB should be auto-included via its SunbedGroup
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
    const site = await createTestSite(user.id, { timeZone: 'UTC' })
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

  // Regression (track 017 P3): the write must anchor from/to to the VENUE's
  // civil day, not the server's (UTC on Vercel). Pins a non-UTC venue tz
  // (Europe/Madrid, CEST = UTC+2 in August) and asserts the stored instants
  // land on venue-midnight, not server/UTC-midnight.
  it('venue-anchors from/to to the site timezone, not the server TZ', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id, { timeZone: 'Europe/Madrid' })
    const item = await createTestInventoryItem(user.id, site.id)
    mockUserId = user.id

    const result = await createPartnerReservation({
      siteId: site.id,
      itemIds: [item.id],
      from: '2025-08-15',
      to: '2025-08-15',
      paymentType: 'cash',
    })

    expect(result).toEqual({ status: 'ok' })

    const reservation = await prisma.reservation.findFirst({
      where: { siteId: site.id },
    })
    expect(reservation).not.toBeNull()
    // Venue midnight (Madrid, UTC+2 in August) — NOT server/UTC midnight
    // (which would be 2025-08-15T00:00:00.000Z / T23:59:59.999Z).
    expect(reservation!.from.toISOString()).toBe('2025-08-14T22:00:00.000Z')
    expect(reservation!.to.toISOString()).toBe('2025-08-15T21:59:59.999Z')
  })
})

// ---------------------------------------------------------------------------
// getAvailableSunbeds
// ---------------------------------------------------------------------------

describe('getAvailableSunbeds', () => {
  it('returns all active items when no reservations exist', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id, { timeZone: 'UTC' })
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
    const site = await createTestSite(user.id, { timeZone: 'UTC' })
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

  // track 012: a CANCELED reservation frees the bed (non-blocking payment status),
  // but no-show/departed do NOT — operational status never frees a bed, so those
  // beds stay held until an explicit release.
  it('frees only the canceled item; no-show/departed still block (op-status never frees)', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id, { timeZone: 'UTC' })
    const item1 = await createTestInventoryItem(user.id, site.id, { number: 1 })
    const item2 = await createTestInventoryItem(user.id, site.id, { number: 2 })
    const item3 = await createTestInventoryItem(user.id, site.id, { number: 3 })
    mockUserId = user.id

    // A stay whose last day is in the FUTURE so the departed/no-show beds are NOT
    // yet released (release only fires once `to <= endOfToday`). Relative to today
    // so the test can't age into "stay over" — a hardcoded 2026-07-05 `to` silently
    // became today and freed the beds.
    const resFrom = utcDayBounds(-1).start
    const resTo = utcDayBounds(3).end

    // canceled reservation — frees item1 (canceled is non-blocking by status)
    await createTestReservation(user.id, site.id, [item1.id], {
      from: resFrom,
      to: resTo,
      status: 'canceled',
      operationalStatus: 'expected',
    })

    // no-show reservation — item2 STILL blocked (op-status never frees)
    await createTestReservation(user.id, site.id, [item2.id], {
      from: resFrom,
      to: resTo,
      status: 'complete',
      operationalStatus: 'no-show',
    })

    // departed reservation — item3 STILL blocked
    await createTestReservation(user.id, site.id, [item3.id], {
      from: resFrom,
      to: resTo,
      status: 'complete',
      operationalStatus: 'departed',
    })

    const result = await getAvailableSunbeds(
      site.id,
      utcDayKey(0),
      utcDayKey(2),
    )

    expect(result.status).toBe('ok')
    // Only the canceled item is free; the no-show and departed beds stay held.
    expect(result.items).toHaveLength(1)
    expect(result.items?.[0]?.id).toBe(item1.id)
  })

  it('does not return inactive items', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id, { timeZone: 'UTC' })
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
    const site = await createTestSite(owner.id, { timeZone: 'UTC' })
    await createTestInventoryItem(owner.id, site.id)
    mockUserId = stranger.id

    const result = await getAvailableSunbeds(site.id, '2026-07-01', '2026-07-03')

    expect(result.status).toBe('error')
    expect(result.errors).toContain('Not authorized')
    expect(result.items).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Bug-revealing: pair-expansion double-booking in createPartnerReservation
//
// Before this fix, createPartnerReservation checked availability on the
// requested itemIds only, then expanded siblings AFTER — so a sibling already
// reserved was invisible to the conflict check (silent overbook).
// ---------------------------------------------------------------------------

describe('createPartnerReservation — pair-expansion conflict detection (bug #2)', () => {
  it('rejects booking a primary item when its SunbedGroup sibling is already booked for the same period', async () => {
    // Bug scenario: sibling (itemB) is reserved for 2026-07-01 to 2026-07-05.
    // Partner books itemA for overlapping 2026-07-03 to 2026-07-07.
    // Old code: checked only itemA → passed → created reservation covering both
    // itemA and itemB even though itemB was already taken.
    // Fixed: siblings are expanded first, guard sees both in the conflict check.
    const user = await createTestUser()
    const site = await createTestSite(user.id, { timeZone: 'UTC' })

    const group = await prisma.sunbedGroup.create({ data: { siteId: site.id } })
    const itemA = await createTestInventoryItem(user.id, site.id, {
      number: 1,
      sunbedGroupId: group.id,
    })
    const itemB = await createTestInventoryItem(user.id, site.id, {
      number: 2,
      sunbedGroupId: group.id,
    })
    mockUserId = user.id

    // Pre-existing reservation occupying the SIBLING (itemB) for the overlap period
    await createTestReservation(user.id, site.id, [itemB.id], {
      from: new Date('2026-07-01'),
      to: new Date('2026-07-05'),
      status: 'complete',
      operationalStatus: 'expected',
    })

    // Try to reserve itemA for an overlapping period — guard must reject it
    const result = await createPartnerReservation({
      siteId: site.id,
      itemIds: [itemA.id],
      from: '2026-07-03',
      to: '2026-07-07',
      paymentType: 'cash',
    })

    expect(result.status).toBe('error')
    expect(result.errors?.[0]).toContain('already reserved')

    // Only the pre-existing reservation should exist
    const count = await prisma.reservation.count({ where: { siteId: site.id } })
    expect(count).toBe(1)
  })

  it('rejects booking a seat when its UNIT sibling is already booked for the same period', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id, { timeZone: 'UTC' })

    const { itemA, itemB } = await createTestPairedUnit(user.id, site.id, [1, 2])
    mockUserId = user.id

    // Pre-existing reservation on the SIBLING (itemB)
    await createTestReservation(user.id, site.id, [itemB.id], {
      from: new Date('2026-07-01'),
      to: new Date('2026-07-05'),
      status: 'complete',
      operationalStatus: 'expected',
    })

    const result = await createPartnerReservation({
      siteId: site.id,
      itemIds: [itemA.id],
      from: '2026-07-03',
      to: '2026-07-07',
      paymentType: 'cash',
    })

    expect(result.status).toBe('error')
    expect(result.errors?.[0]).toContain('already reserved')

    const count = await prisma.reservation.count({ where: { siteId: site.id } })
    expect(count).toBe(1)
  })

  it('allows booking when sibling reservation does not overlap the requested period', async () => {
    // Control test: same structure, but the sibling reservation is on non-overlapping dates.
    const user = await createTestUser()
    const site = await createTestSite(user.id, { timeZone: 'UTC' })

    const group = await prisma.sunbedGroup.create({ data: { siteId: site.id } })
    const itemA = await createTestInventoryItem(user.id, site.id, {
      number: 1,
      sunbedGroupId: group.id,
    })
    const itemB = await createTestInventoryItem(user.id, site.id, {
      number: 2,
      sunbedGroupId: group.id,
    })
    mockUserId = user.id

    // Sibling (itemB) reserved for a DIFFERENT period (no overlap)
    await createTestReservation(user.id, site.id, [itemB.id], {
      from: new Date('2026-08-01'),
      to: new Date('2026-08-05'),
      status: 'complete',
      operationalStatus: 'expected',
    })

    const result = await createPartnerReservation({
      siteId: site.id,
      itemIds: [itemA.id],
      from: '2026-07-01',
      to: '2026-07-05',
      paymentType: 'cash',
    })

    expect(result).toEqual({ status: 'ok' })

    // Two reservations: the pre-existing one on itemB (Aug) and the new one on A+B (Jul)
    const count = await prisma.reservation.count({ where: { siteId: site.id } })
    expect(count).toBe(2)
  })
})
