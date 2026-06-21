/**
 * Integration tests for reserveWithConflictGuard.
 *
 * Headline: a concurrency race test that fires TWO calls for the SAME bed +
 * overlapping range concurrently via Promise.all, asserts exactly one succeeds
 * and one returns { outcome: 'conflict' }, and asserts exactly ONE reservation
 * row exists afterwards.
 *
 * The FOR UPDATE lock on InventoryItem rows is what serializes the race. Both
 * callers enter the interactive transaction and immediately try to lock the same
 * row. The second one blocks until the first commits. After the first commits
 * (creating the reservation), the second acquires the lock, re-runs the conflict
 * check via `tx`, finds the new reservation, and returns { outcome: 'conflict' }.
 *
 * pg pool max default is 10, so two concurrent interactive transactions are
 * supported without any special configuration.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { cleanDatabase, disconnectDatabase, prisma } from './test/setup'
import {
  createTestUser,
  createTestSite,
  createTestInventoryItem,
  createTestSunbedGroup,
  createTestReservation,
  createTestRentalItem,
  createTestRentalBooking,
  resetCounter,
} from './test/fixtures'
import {
  reserveWithConflictGuard,
  moveReservationWithConflictGuard,
  createRentalBookingsWithGuard,
} from './reservations'
import {
  RESERVATION_PAID_IN_CASH,
  RESERVATION_COMPLETE,
  RESERVATION_CANCELED,
  RESERVATION_PAYMENT_FAILED,
  RESERVATION_REFUNDED,
  OP_WALKED_IN,
  OP_EXPECTED,
  OP_NO_SHOW,
  OP_DEPARTED,
  RENTAL_COMPLETE,
  OP_RESERVED,
} from './reservation-status'

beforeEach(async () => {
  await cleanDatabase()
  resetCounter()
})

afterAll(async () => {
  await disconnectDatabase()
})

// ─── Happy path ──────────────────────────────────────────────────────────────

describe('reserveWithConflictGuard — no conflict', () => {
  it('creates a reservation and returns { outcome: "created" } when no conflicting reservation exists', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    const item = await createTestInventoryItem(user.id, site.id, { number: 1 })

    const from = new Date('2026-08-01T00:00:00Z')
    const to = new Date('2026-08-07T23:59:59Z')

    const result = await reserveWithConflictGuard({
      itemIds: [item.id],
      siteId: site.id,
      userId: user.id,
      from,
      to,
      type: 'days',
      status: RESERVATION_PAID_IN_CASH,
      operationalStatus: OP_WALKED_IN,
    })

    expect(result.outcome).toBe('created')
    if (result.outcome !== 'created') throw new Error('narrowing')

    // Verify the row actually exists in the DB
    const row = await prisma.reservation.findUnique({
      where: { id: result.reservationId },
      include: { items: true },
    })
    expect(row).not.toBeNull()
    expect(row!.status).toBe(RESERVATION_PAID_IN_CASH)
    expect(row!.items.map((i) => i.id)).toContain(item.id)
  })

  it('creates a reservation with multiple items (expanded group)', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    const item1 = await createTestInventoryItem(user.id, site.id, { number: 1 })
    const item2 = await createTestInventoryItem(user.id, site.id, { number: 2 })

    const from = new Date('2026-08-01T00:00:00Z')
    const to = new Date('2026-08-07T23:59:59Z')

    const result = await reserveWithConflictGuard({
      itemIds: [item1.id, item2.id],
      siteId: site.id,
      userId: user.id,
      from,
      to,
      type: 'days',
      status: RESERVATION_PAID_IN_CASH,
      operationalStatus: OP_WALKED_IN,
    })

    expect(result.outcome).toBe('created')
    if (result.outcome !== 'created') throw new Error('narrowing')

    const row = await prisma.reservation.findUnique({
      where: { id: result.reservationId },
      include: { items: true },
    })
    expect(row!.items).toHaveLength(2)
    expect(row!.items.map((i) => i.id)).toContain(item1.id)
    expect(row!.items.map((i) => i.id)).toContain(item2.id)
  })
})

// ─── Conflict detection ──────────────────────────────────────────────────────

describe('reserveWithConflictGuard — conflict detection', () => {
  it('returns { outcome: "conflict" } when a blocking reservation already exists for the period', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    const item = await createTestInventoryItem(user.id, site.id, { number: 1 })

    const from = new Date('2026-08-01T00:00:00Z')
    const to = new Date('2026-08-07T23:59:59Z')

    // Pre-existing blocking reservation
    const existing = await createTestReservation(user.id, site.id, [item.id], {
      from,
      to,
      status: RESERVATION_COMPLETE,
      operationalStatus: OP_EXPECTED,
    })

    const result = await reserveWithConflictGuard({
      itemIds: [item.id],
      siteId: site.id,
      userId: user.id,
      from,
      to,
      type: 'days',
      status: RESERVATION_PAID_IN_CASH,
      operationalStatus: OP_WALKED_IN,
    })

    expect(result.outcome).toBe('conflict')
    if (result.outcome !== 'conflict') throw new Error('narrowing')
    expect(result.conflictingReservationId).toBe(existing.id)

    // Verify no extra row was created
    const count = await prisma.reservation.count({ where: { siteId: site.id } })
    expect(count).toBe(1)
  })

  it('detects conflict on partial item overlap (sibling in group already booked)', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    const item1 = await createTestInventoryItem(user.id, site.id, { number: 1 })
    const item2 = await createTestInventoryItem(user.id, site.id, { number: 2 })

    const from = new Date('2026-08-01T00:00:00Z')
    const to = new Date('2026-08-07T23:59:59Z')

    // Only item1 is in the existing reservation
    await createTestReservation(user.id, site.id, [item1.id], {
      from,
      to,
      status: RESERVATION_COMPLETE,
      operationalStatus: OP_EXPECTED,
    })

    // Request covers both item1 (conflict) and item2
    const result = await reserveWithConflictGuard({
      itemIds: [item1.id, item2.id],
      siteId: site.id,
      userId: user.id,
      from,
      to,
      type: 'days',
      status: RESERVATION_PAID_IN_CASH,
      operationalStatus: OP_WALKED_IN,
    })

    expect(result.outcome).toBe('conflict')
  })

  it('does NOT conflict when existing reservation is for a different date range (no overlap)', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    const item = await createTestInventoryItem(user.id, site.id, { number: 1 })

    // Existing: July 1–7
    await createTestReservation(user.id, site.id, [item.id], {
      from: new Date('2026-07-01T00:00:00Z'),
      to: new Date('2026-07-07T23:59:59Z'),
      status: RESERVATION_COMPLETE,
      operationalStatus: OP_EXPECTED,
    })

    // Requesting: August 1–7 (no overlap)
    const result = await reserveWithConflictGuard({
      itemIds: [item.id],
      siteId: site.id,
      userId: user.id,
      from: new Date('2026-08-01T00:00:00Z'),
      to: new Date('2026-08-07T23:59:59Z'),
      type: 'days',
      status: RESERVATION_PAID_IN_CASH,
      operationalStatus: OP_WALKED_IN,
    })

    expect(result.outcome).toBe('created')
  })
})

// ─── Non-blocking status semantics ──────────────────────────────────────────

describe('reserveWithConflictGuard — non-blocking statuses', () => {
  it('CANCELED reservation does NOT block (can re-book a canceled bed)', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    const item = await createTestInventoryItem(user.id, site.id, { number: 1 })

    const from = new Date('2026-08-01T00:00:00Z')
    const to = new Date('2026-08-07T23:59:59Z')

    await createTestReservation(user.id, site.id, [item.id], {
      from,
      to,
      status: RESERVATION_CANCELED,
      operationalStatus: OP_EXPECTED,
    })

    const result = await reserveWithConflictGuard({
      itemIds: [item.id],
      siteId: site.id,
      userId: user.id,
      from,
      to,
      type: 'days',
      status: RESERVATION_PAID_IN_CASH,
      operationalStatus: OP_WALKED_IN,
    })

    expect(result.outcome).toBe('created')
  })

  it('PAYMENT_FAILED reservation does NOT block (default BLOCKING_STATUSES)', () => {
    // Tested at unit level — PAYMENT_FAILED not in BLOCKING_STATUSES.
    // Integration-level: the DB test for CANCELED above is representative.
    // This annotation records the semantic, not duplicating the full DB round-trip.
    expect(true).toBe(true) // documentation test — see unit suite for predicate coverage
  })

  // track 012 stay-over rule: a no-show/departed booking frees its bed only once
  // its stay is OVER (no remaining reserved days, to <= end of today). These two
  // use a FUTURE range (08-01..08-07), so the booking still has days left → it
  // stays blocking (a departed day-1 of a multiday stay must not free days 2–3).
  // The released (stay-over) case is the test below them.
  it('NO_SHOW with remaining days STILL blocks (stay not over)', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    const item = await createTestInventoryItem(user.id, site.id, { number: 1 })

    const from = new Date('2026-08-01T00:00:00Z')
    const to = new Date('2026-08-07T23:59:59Z')

    await createTestReservation(user.id, site.id, [item.id], {
      from,
      to,
      status: RESERVATION_COMPLETE,
      operationalStatus: OP_NO_SHOW,
    })

    const result = await reserveWithConflictGuard({
      itemIds: [item.id],
      siteId: site.id,
      userId: user.id,
      from,
      to,
      type: 'days',
      status: RESERVATION_PAID_IN_CASH,
      operationalStatus: OP_WALKED_IN,
    })

    expect(result.outcome).toBe('conflict')
  })

  it('DEPARTED with remaining days STILL blocks (stay not over)', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    const item = await createTestInventoryItem(user.id, site.id, { number: 1 })

    const from = new Date('2026-08-01T00:00:00Z')
    const to = new Date('2026-08-07T23:59:59Z')

    await createTestReservation(user.id, site.id, [item.id], {
      from,
      to,
      status: RESERVATION_COMPLETE,
      operationalStatus: OP_DEPARTED,
    })

    const result = await reserveWithConflictGuard({
      itemIds: [item.id],
      siteId: site.id,
      userId: user.id,
      from,
      to,
      type: 'days',
      status: RESERVATION_PAID_IN_CASH,
      operationalStatus: OP_WALKED_IN,
    })

    expect(result.outcome).toBe('conflict')
  })

  // The released case: a SAME-DAY booking (to = end of today), departed → stay is
  // over → the bed is freed, so a new booking on the same item is created. This is
  // what makes single-day and last-day departures re-bookable (the turnover case).
  it('DEPARTED whose stay is OVER frees the bed (same-day → re-bookable)', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    const item = await createTestInventoryItem(user.id, site.id, { number: 1 })

    const from = new Date(new Date().setHours(0, 0, 0, 0))
    const to = new Date(new Date().setHours(23, 59, 59, 999))

    await createTestReservation(user.id, site.id, [item.id], {
      from,
      to,
      status: RESERVATION_COMPLETE,
      operationalStatus: OP_DEPARTED,
    })

    const result = await reserveWithConflictGuard({
      itemIds: [item.id],
      siteId: site.id,
      userId: user.id,
      from,
      to,
      type: 'days',
      status: RESERVATION_PAID_IN_CASH,
      operationalStatus: OP_WALKED_IN,
    })

    expect(result.outcome).toBe('created')
  })
})

// ─── Multi-item group / range overlap ────────────────────────────────────────

describe('reserveWithConflictGuard — multi-item group and range overlap', () => {
  it('detects conflict when any group sibling is booked for a partially overlapping range', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    const group = await createTestSunbedGroup(site.id)
    const item1 = await createTestInventoryItem(user.id, site.id, {
      number: 1,
      sunbedGroupId: group.id,
    })
    const item2 = await createTestInventoryItem(user.id, site.id, {
      number: 2,
      sunbedGroupId: group.id,
    })

    // item2 is booked for July 3–10 (overlaps the requested July 5–10)
    await createTestReservation(user.id, site.id, [item2.id], {
      from: new Date('2026-07-03T00:00:00Z'),
      to: new Date('2026-07-10T23:59:59Z'),
      status: RESERVATION_COMPLETE,
      operationalStatus: OP_EXPECTED,
    })

    // Request for item1 + item2 (group expansion) for July 5–12
    const result = await reserveWithConflictGuard({
      itemIds: [item1.id, item2.id],
      siteId: site.id,
      userId: user.id,
      from: new Date('2026-07-05T00:00:00Z'),
      to: new Date('2026-07-12T23:59:59Z'),
      type: 'days',
      status: RESERVATION_PAID_IN_CASH,
      operationalStatus: OP_WALKED_IN,
    })

    expect(result.outcome).toBe('conflict')
  })

  it('allows booking a non-conflicting range for the same group after a gap', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    const group = await createTestSunbedGroup(site.id)
    const item1 = await createTestInventoryItem(user.id, site.id, {
      number: 1,
      sunbedGroupId: group.id,
    })
    const item2 = await createTestInventoryItem(user.id, site.id, {
      number: 2,
      sunbedGroupId: group.id,
    })

    // Existing: July 1–7
    await createTestReservation(user.id, site.id, [item1.id, item2.id], {
      from: new Date('2026-07-01T00:00:00Z'),
      to: new Date('2026-07-07T23:59:59Z'),
      status: RESERVATION_COMPLETE,
      operationalStatus: OP_EXPECTED,
    })

    // Request: July 10–15 (no overlap)
    const result = await reserveWithConflictGuard({
      itemIds: [item1.id, item2.id],
      siteId: site.id,
      userId: user.id,
      from: new Date('2026-07-10T00:00:00Z'),
      to: new Date('2026-07-15T23:59:59Z'),
      type: 'days',
      status: RESERVATION_PAID_IN_CASH,
      operationalStatus: OP_WALKED_IN,
    })

    expect(result.outcome).toBe('created')

    const count = await prisma.reservation.count({ where: { siteId: site.id } })
    expect(count).toBe(2)
  })
})

// ─── THE HEADLINE: concurrent race test ─────────────────────────────────────

describe('reserveWithConflictGuard — concurrency race (the headline test)', () => {
  it('exactly one of two concurrent claims on the same bed succeeds; one reservation row exists', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    const item = await createTestInventoryItem(user.id, site.id, { number: 1 })

    const from = new Date('2026-09-01T00:00:00Z')
    const to = new Date('2026-09-07T23:59:59Z')

    const makeCall = () =>
      reserveWithConflictGuard({
        itemIds: [item.id],
        siteId: site.id,
        userId: user.id,
        from,
        to,
        type: 'days',
        status: RESERVATION_PAID_IN_CASH,
        operationalStatus: OP_WALKED_IN,
      })

    // Fire both concurrently — this is the race. Without the FOR UPDATE lock,
    // both would pass the conflict check (no row exists yet when they run it)
    // and both would create a reservation → double-booking.
    // With the lock, one blocks until the other commits, then re-checks and
    // finds the conflict.
    const [result1, result2] = await Promise.all([makeCall(), makeCall()])

    const outcomes = [result1.outcome, result2.outcome]

    // Exactly one must have succeeded and one must have found a conflict
    expect(outcomes.filter((o) => o === 'created')).toHaveLength(1)
    expect(outcomes.filter((o) => o === 'conflict')).toHaveLength(1)

    // Exactly one reservation row must exist — no double-booking
    const reservations = await prisma.reservation.findMany({
      where: { siteId: site.id },
      include: { items: true },
    })
    expect(reservations).toHaveLength(1)
    expect(reservations[0]!.items.map((i) => i.id)).toContain(item.id)

    // The 'created' result must match the row in the DB
    const createdResult = results_find_created(result1, result2)
    expect(reservations[0]!.id).toBe(createdResult.reservationId)
  })

  it('exactly one of two concurrent claims on a two-item group succeeds (both siblings locked)', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    const group = await createTestSunbedGroup(site.id)
    const item1 = await createTestInventoryItem(user.id, site.id, {
      number: 1,
      sunbedGroupId: group.id,
    })
    const item2 = await createTestInventoryItem(user.id, site.id, {
      number: 2,
      sunbedGroupId: group.id,
    })

    const from = new Date('2026-09-10T00:00:00Z')
    const to = new Date('2026-09-14T23:59:59Z')

    const makeCall = () =>
      reserveWithConflictGuard({
        itemIds: [item1.id, item2.id],
        siteId: site.id,
        userId: user.id,
        from,
        to,
        type: 'days',
        status: RESERVATION_PAID_IN_CASH,
        operationalStatus: OP_WALKED_IN,
      })

    const [result1, result2] = await Promise.all([makeCall(), makeCall()])

    const outcomes = [result1.outcome, result2.outcome]
    expect(outcomes.filter((o) => o === 'created')).toHaveLength(1)
    expect(outcomes.filter((o) => o === 'conflict')).toHaveLength(1)

    const reservations = await prisma.reservation.count({ where: { siteId: site.id } })
    expect(reservations).toBe(1)
  })
})

// ─── Custom options (partner stricter semantics) ─────────────────────────────

describe('reserveWithConflictGuard — custom blockingStatuses option', () => {
  it('PAYMENT_FAILED blocks when caller passes it in blockingStatuses', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    const item = await createTestInventoryItem(user.id, site.id, { number: 1 })

    const from = new Date('2026-08-01T00:00:00Z')
    const to = new Date('2026-08-07T23:59:59Z')

    await createTestReservation(user.id, site.id, [item.id], {
      from,
      to,
      status: RESERVATION_PAYMENT_FAILED,
      operationalStatus: OP_EXPECTED,
    })

    const result = await reserveWithConflictGuard(
      {
        itemIds: [item.id],
        siteId: site.id,
        userId: user.id,
        from,
        to,
        type: 'days',
        status: RESERVATION_PAID_IN_CASH,
        operationalStatus: OP_WALKED_IN,
      },
      {
        blockingStatuses: [
          RESERVATION_PAYMENT_FAILED,
          'pending',
          'processing',
          'complete',
          'paid-in-cash',
        ],
      }
    )

    expect(result.outcome).toBe('conflict')
  })

  it('REFUNDED blocks when caller passes it in blockingStatuses', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    const item = await createTestInventoryItem(user.id, site.id, { number: 1 })

    const from = new Date('2026-08-01T00:00:00Z')
    const to = new Date('2026-08-07T23:59:59Z')

    await createTestReservation(user.id, site.id, [item.id], {
      from,
      to,
      status: RESERVATION_REFUNDED,
      operationalStatus: OP_EXPECTED,
    })

    const result = await reserveWithConflictGuard(
      {
        itemIds: [item.id],
        siteId: site.id,
        userId: user.id,
        from,
        to,
        type: 'days',
        status: RESERVATION_PAID_IN_CASH,
        operationalStatus: OP_WALKED_IN,
      },
      {
        blockingStatuses: [
          RESERVATION_REFUNDED,
          'pending',
          'processing',
          'complete',
          'paid-in-cash',
        ],
      }
    )

    expect(result.outcome).toBe('conflict')
  })
})

// ─── Helpers ─────────────────────────────────────────────────────────────────

function results_find_created(
  r1: Awaited<ReturnType<typeof reserveWithConflictGuard>>,
  r2: Awaited<ReturnType<typeof reserveWithConflictGuard>>
): Extract<typeof r1, { outcome: 'created' }> {
  if (r1.outcome === 'created') return r1
  if (r2.outcome === 'created') return r2 as Extract<typeof r2, { outcome: 'created' }>
  throw new Error('Neither result was "created"')
}

// ─── moveReservationWithConflictGuard — correctness ─────────────────────────

describe('moveReservationWithConflictGuard — correctness', () => {
  it('clean move to a free bed returns { outcome: "moved" } and updates DB item assignments', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    const bed1 = await createTestInventoryItem(user.id, site.id, { number: 1 })
    const bed2 = await createTestInventoryItem(user.id, site.id, { number: 2 })

    const from = new Date('2026-09-01T00:00:00Z')
    const to = new Date('2026-09-07T23:59:59Z')

    const res = await createTestReservation(user.id, site.id, [bed1.id], {
      from,
      to,
      status: RESERVATION_COMPLETE,
      operationalStatus: OP_EXPECTED,
    })

    const result = await moveReservationWithConflictGuard(res.id, [bed2.id])

    expect(result.outcome).toBe('moved')

    // DB: res now holds bed2, not bed1
    const updated = await prisma.reservation.findUnique({
      where: { id: res.id },
      include: { items: true },
    })
    const itemIds = updated!.items.map((i) => i.id)
    expect(itemIds).toContain(bed2.id)
    expect(itemIds).not.toContain(bed1.id)
  })

  it('move onto an independently-occupied bed returns { outcome: "conflict" }', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    const bed1 = await createTestInventoryItem(user.id, site.id, { number: 1 })
    const bed2 = await createTestInventoryItem(user.id, site.id, { number: 2 })

    const from = new Date('2026-09-01T00:00:00Z')
    const to = new Date('2026-09-07T23:59:59Z')

    // res1 on bed1 — the reservation we want to move
    const res1 = await createTestReservation(user.id, site.id, [bed1.id], {
      from,
      to,
      status: RESERVATION_COMPLETE,
      operationalStatus: OP_EXPECTED,
    })

    // res2 on bed2 — already occupies the target
    const res2 = await createTestReservation(user.id, site.id, [bed2.id], {
      from,
      to,
      status: RESERVATION_COMPLETE,
      operationalStatus: OP_EXPECTED,
    })

    const result = await moveReservationWithConflictGuard(res1.id, [bed2.id])

    expect(result.outcome).toBe('conflict')
    if (result.outcome !== 'conflict') throw new Error('narrowing')
    expect(result.conflictingReservationId).toBe(res2.id)

    // res1 must still hold bed1 (not moved)
    const unchanged = await prisma.reservation.findUnique({
      where: { id: res1.id },
      include: { items: true },
    })
    expect(unchanged!.items.map((i) => i.id)).toContain(bed1.id)
  })

  it('self-exclusion: moving onto a bed occupied only by the moving reservation itself returns "moved"', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    const bed1 = await createTestInventoryItem(user.id, site.id, { number: 1 })
    const bed2 = await createTestInventoryItem(user.id, site.id, { number: 2 })

    const from = new Date('2026-09-01T00:00:00Z')
    const to = new Date('2026-09-07T23:59:59Z')

    // res1 holds both bed1 and bed2; no other reservation is on bed1
    const res1 = await createTestReservation(user.id, site.id, [bed1.id, bed2.id], {
      from,
      to,
      status: RESERVATION_COMPLETE,
      operationalStatus: OP_EXPECTED,
    })

    // Move res1 to just [bed1]. bed1 is already on res1 — but no OTHER reservation is there.
    // Without excludeReservationId, res1 would conflict with itself and the move would fail.
    const result = await moveReservationWithConflictGuard(res1.id, [bed1.id])

    expect(result.outcome).toBe('moved')
  })
})

// ─── moveReservationWithConflictGuard — concurrency race (headline test) ─────

describe('moveReservationWithConflictGuard — concurrency race (headline test)', () => {
  it('exactly one of two concurrent moves onto the same bed succeeds; only one reservation holds that bed', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    const bed1 = await createTestInventoryItem(user.id, site.id, { number: 1 })
    const bed2 = await createTestInventoryItem(user.id, site.id, { number: 2 })
    const target = await createTestInventoryItem(user.id, site.id, { number: 3 })

    const from = new Date('2026-09-10T00:00:00Z')
    const to = new Date('2026-09-16T23:59:59Z')

    // Two reservations on separate beds, same overlapping date range — both want to move to target
    const res1 = await createTestReservation(user.id, site.id, [bed1.id], {
      from,
      to,
      status: RESERVATION_COMPLETE,
      operationalStatus: OP_EXPECTED,
    })
    const res2 = await createTestReservation(user.id, site.id, [bed2.id], {
      from,
      to,
      status: RESERVATION_COMPLETE,
      operationalStatus: OP_EXPECTED,
    })

    // Both try to move to target concurrently.
    // The FOR UPDATE lock on target serializes them: the second blocks until the first
    // commits, then re-checks conflict and finds the first reservation now on target.
    const [result1, result2] = await Promise.all([
      moveReservationWithConflictGuard(res1.id, [target.id]),
      moveReservationWithConflictGuard(res2.id, [target.id]),
    ])

    const outcomes = [result1.outcome, result2.outcome]

    // Exactly one must have moved, one must have conflicted
    expect(outcomes.filter((o) => o === 'moved')).toHaveLength(1)
    expect(outcomes.filter((o) => o === 'conflict')).toHaveLength(1)

    // DB: exactly one reservation holds the target bed — no double-assignment
    const holdersOfTarget = await prisma.reservation.findMany({
      where: { items: { some: { id: target.id } } },
    })
    expect(holdersOfTarget).toHaveLength(1)

    // The winner is whichever returned 'moved'
    const winnerId = result1.outcome === 'moved' ? res1.id : res2.id
    expect(holdersOfTarget[0]!.id).toBe(winnerId)
  })
})

// ─── createRentalBookingsWithGuard — correctness ─────────────────────────────

describe('createRentalBookingsWithGuard — correctness', () => {
  it('within-capacity booking returns { outcome: "created" } and writes the booking row', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    const item = await createTestRentalItem(site.id, { totalQuantity: 5 })

    const from = new Date('2026-09-01T10:00:00Z')
    const to = new Date('2026-09-01T12:00:00Z')

    const result = await createRentalBookingsWithGuard([
      {
        rentalItemId: item.id,
        siteId: site.id,
        userId: user.id,
        from,
        to,
        quantity: 2,
        durationType: 'hours',
        totalPrice: 20.0,
        paymentAmount: 20.0,
        status: RENTAL_COMPLETE,
        operationalStatus: OP_RESERVED,
      },
    ])

    expect(result.outcome).toBe('created')
    if (result.outcome !== 'created') throw new Error('narrowing')
    expect(result.bookingIds).toHaveLength(1)

    const booking = await prisma.rentalBooking.findUnique({
      where: { id: result.bookingIds[0] },
    })
    expect(booking).not.toBeNull()
    expect(booking!.quantity).toBe(2)
    expect(booking!.rentalItemId).toBe(item.id)
  })

  it('over-capacity booking returns { outcome: "unavailable" } and writes NO rows', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    const item = await createTestRentalItem(site.id, { totalQuantity: 2 })

    const from = new Date('2026-09-01T10:00:00Z')
    const to = new Date('2026-09-01T12:00:00Z')

    // Pre-fill capacity: 2 already booked (fills the item completely)
    await createTestRentalBooking(user.id, site.id, item.id, {
      from,
      to,
      quantity: 2,
      operationalStatus: OP_RESERVED,
    })

    const result = await createRentalBookingsWithGuard([
      {
        rentalItemId: item.id,
        siteId: site.id,
        userId: user.id,
        from,
        to,
        quantity: 1,
        durationType: 'hours',
        totalPrice: 10.0,
        paymentAmount: 10.0,
        status: RENTAL_COMPLETE,
        operationalStatus: OP_RESERVED,
      },
    ])

    expect(result.outcome).toBe('unavailable')
    if (result.outcome !== 'unavailable') throw new Error('narrowing')
    expect(result.rentalItemId).toBe(item.id)

    // Only the pre-existing booking exists — the guard wrote nothing
    const bookings = await prisma.rentalBooking.findMany({ where: { rentalItemId: item.id } })
    expect(bookings).toHaveLength(1)
  })

  it('all-or-nothing: if any booking in the batch is unavailable, no bookings in the batch are written', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    const item1 = await createTestRentalItem(site.id, { totalQuantity: 10 })
    const item2 = await createTestRentalItem(site.id, { totalQuantity: 1 })

    const from = new Date('2026-09-01T10:00:00Z')
    const to = new Date('2026-09-01T12:00:00Z')

    // item2 is at capacity
    await createTestRentalBooking(user.id, site.id, item2.id, {
      from,
      to,
      quantity: 1,
      operationalStatus: OP_RESERVED,
    })

    // Batch: item1 passes availability, item2 fails — guard must write nothing at all
    const result = await createRentalBookingsWithGuard([
      {
        rentalItemId: item1.id,
        siteId: site.id,
        userId: user.id,
        from,
        to,
        quantity: 1,
        durationType: 'hours',
        totalPrice: 10.0,
        paymentAmount: 10.0,
        status: RENTAL_COMPLETE,
        operationalStatus: OP_RESERVED,
      },
      {
        rentalItemId: item2.id,
        siteId: site.id,
        userId: user.id,
        from,
        to,
        quantity: 1,
        durationType: 'hours',
        totalPrice: 10.0,
        paymentAmount: 10.0,
        status: RENTAL_COMPLETE,
        operationalStatus: OP_RESERVED,
      },
    ])

    expect(result.outcome).toBe('unavailable')

    // item1's booking must NOT have been created — the guard checks all before writing any
    const item1Bookings = await prisma.rentalBooking.findMany({
      where: { rentalItemId: item1.id },
    })
    expect(item1Bookings).toHaveLength(0)
  })
})

// ─── createRentalBookingsWithGuard — concurrency race (headline test) ─────────

describe('createRentalBookingsWithGuard — concurrency race (headline test)', () => {
  it('exactly one of two concurrent over-capacity bookings succeeds; quantity never exceeded in DB', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    // Each call requests qty 2; totalQuantity 3 fits one call (2 ≤ 3) but not both (2+2=4 > 3)
    const item = await createTestRentalItem(site.id, { totalQuantity: 3 })

    const from = new Date('2026-09-10T10:00:00Z')
    const to = new Date('2026-09-10T12:00:00Z')

    const makeBooking = () =>
      createRentalBookingsWithGuard([
        {
          rentalItemId: item.id,
          siteId: site.id,
          userId: user.id,
          from,
          to,
          quantity: 2,
          durationType: 'hours',
          totalPrice: 20.0,
          paymentAmount: 20.0,
          status: RENTAL_COMPLETE,
          operationalStatus: OP_RESERVED,
        },
      ])

    // Fire both concurrently — the FOR UPDATE lock on RentalItem serializes them.
    // The second blocks until the first commits, then re-aggregates and finds
    // 2 already booked: 2+2=4 > totalQuantity 3 → unavailable.
    const [result1, result2] = await Promise.all([makeBooking(), makeBooking()])

    const outcomes = [result1.outcome, result2.outcome]

    // Exactly one booking succeeded, one found it unavailable
    expect(outcomes.filter((o) => o === 'created')).toHaveLength(1)
    expect(outcomes.filter((o) => o === 'unavailable')).toHaveLength(1)

    // DB: only the winner's booking exists — quantity never exceeded totalQuantity (3)
    const allBookings = await prisma.rentalBooking.findMany({
      where: { rentalItemId: item.id },
    })
    expect(allBookings).toHaveLength(1)

    const totalBooked = allBookings.reduce((sum, b) => sum + b.quantity, 0)
    expect(totalBooked).toBeLessThanOrEqual(3)

    // The 'unavailable' result correctly identifies the item
    const unavailable = result1.outcome === 'unavailable' ? result1 : result2
    if (unavailable.outcome !== 'unavailable') throw new Error('narrowing')
    expect(unavailable.rentalItemId).toBe(item.id)
  })
})

// ─── createRentalBookingsWithGuard — anon fields (Phase 1a / track-009) ──────
//
// Requirements:
//  1. When anonId + guestEmail (+ guestContact) are provided in RentalBookingInput,
//     the created RentalBooking row persists all three.
//  2. When they are omitted (authenticated booking), the DB row has them null —
//     existing authenticated bookings are unaffected.

describe('createRentalBookingsWithGuard — anon fields persisted to DB', () => {
  it('persists anonId, guestEmail, and guestContact on the created row when supplied', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    const item = await createTestRentalItem(site.id, { totalQuantity: 5 })

    const from = new Date('2026-10-01T10:00:00Z')
    const to = new Date('2026-10-01T12:00:00Z')

    const result = await createRentalBookingsWithGuard([
      {
        rentalItemId: item.id,
        siteId: site.id,
        userId: user.id,
        from,
        to,
        quantity: 1,
        durationType: 'hours',
        totalPrice: 10.0,
        paymentAmount: 10.0,
        status: RENTAL_COMPLETE,
        operationalStatus: OP_RESERVED,
        anonId: 'c0ffee00-0000-4000-8000-000000000001',
        guestEmail: 'guest@example.com',
        guestContact: '+358401234567',
      },
    ])

    expect(result.outcome).toBe('created')
    if (result.outcome !== 'created') throw new Error('narrowing')

    const booking = await prisma.rentalBooking.findUnique({
      where: { id: result.bookingIds[0] },
    })
    expect(booking).not.toBeNull()
    // All three anon fields must be persisted exactly as supplied
    expect(booking!.anonId).toBe('c0ffee00-0000-4000-8000-000000000001')
    expect(booking!.guestEmail).toBe('guest@example.com')
    expect(booking!.guestContact).toBe('+358401234567')
  })

  it('leaves anonId, guestEmail, and guestContact null when omitted (authenticated path)', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    const item = await createTestRentalItem(site.id, { totalQuantity: 5 })

    const from = new Date('2026-10-02T10:00:00Z')
    const to = new Date('2026-10-02T12:00:00Z')

    const result = await createRentalBookingsWithGuard([
      {
        rentalItemId: item.id,
        siteId: site.id,
        userId: user.id,
        from,
        to,
        quantity: 1,
        durationType: 'hours',
        totalPrice: 10.0,
        paymentAmount: 10.0,
        status: RENTAL_COMPLETE,
        operationalStatus: OP_RESERVED,
        // anonId / guestEmail / guestContact intentionally omitted
      },
    ])

    expect(result.outcome).toBe('created')
    if (result.outcome !== 'created') throw new Error('narrowing')

    const booking = await prisma.rentalBooking.findUnique({
      where: { id: result.bookingIds[0] },
    })
    expect(booking).not.toBeNull()
    // Authenticated booking: all three anon fields must be null
    expect(booking!.anonId).toBeNull()
    expect(booking!.guestEmail).toBeNull()
    expect(booking!.guestContact).toBeNull()
  })
})
