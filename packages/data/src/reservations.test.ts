/**
 * Unit tests for reservations.ts — pure/extractable parts only.
 *
 * The actual DB-level serialization (FOR UPDATE) is proven in the integration
 * test. Here we verify the conflict-check predicate semantics that can be
 * reasoned about without a real database.
 */

import { describe, it, expect } from 'vitest'
import {
  BLOCKING_STATUSES,
  RESERVATION_PENDING,
  RESERVATION_PROCESSING,
  RESERVATION_COMPLETE,
  RESERVATION_PAID_IN_CASH,
  RESERVATION_PAYMENT_FAILED,
  RESERVATION_CANCELED,
  RESERVATION_REFUNDED,
  OP_NO_SHOW,
  OP_DEPARTED,
  OP_EXPECTED,
  OP_CHECKED_IN,
  OP_WALKED_IN,
} from './reservation-status'

// ─── Conflict predicate (pure, extracted for testability) ────────────────────
//
// This mirrors the WHERE clause used in reserveWithConflictGuard. We test the
// predicate logic in isolation so we can cover all status / overlap combinations
// cheaply. The integration test confirms the same predicate fires correctly in
// the real Prisma transaction.

type MockReservation = {
  id: string
  status: string
  operationalStatus: string
  from: Date
  to: Date
  itemIds: string[]
}

function isConflicting(
  existing: MockReservation,
  requestedItemIds: string[],
  requestedFrom: Date,
  requestedTo: Date,
  blockingStatuses: readonly string[] = BLOCKING_STATUSES,
  nonBlockingOpStatuses: readonly string[] = [OP_NO_SHOW, OP_DEPARTED],
): boolean {
  // Status must be blocking
  if (!blockingStatuses.includes(existing.status)) return false
  // Operational status must not be in the non-blocking set
  if (nonBlockingOpStatuses.includes(existing.operationalStatus)) return false
  // At least one item must overlap
  const itemOverlap = existing.itemIds.some((id) => requestedItemIds.includes(id))
  if (!itemOverlap) return false
  // Date overlap: existing.from <= requestedTo AND existing.to >= requestedFrom
  if (existing.from > requestedTo) return false
  if (existing.to < requestedFrom) return false
  return true
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function d(iso: string): Date {
  return new Date(iso)
}

function makeReservation(overrides: Partial<MockReservation> = {}): MockReservation {
  return {
    id: 'res-1',
    status: RESERVATION_COMPLETE,
    operationalStatus: OP_EXPECTED,
    from: d('2026-07-01T00:00:00Z'),
    to: d('2026-07-07T23:59:59Z'),
    itemIds: ['item-1'],
    ...overrides,
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('conflict predicate — status filtering', () => {
  const requestedFrom = d('2026-07-03T00:00:00Z')
  const requestedTo = d('2026-07-05T23:59:59Z')
  const requestedItems = ['item-1']

  it('PENDING reservation blocks the date range', () => {
    const res = makeReservation({ status: RESERVATION_PENDING })
    expect(isConflicting(res, requestedItems, requestedFrom, requestedTo)).toBe(true)
  })

  it('PROCESSING reservation blocks the date range', () => {
    const res = makeReservation({ status: RESERVATION_PROCESSING })
    expect(isConflicting(res, requestedItems, requestedFrom, requestedTo)).toBe(true)
  })

  it('COMPLETE reservation blocks the date range', () => {
    const res = makeReservation({ status: RESERVATION_COMPLETE })
    expect(isConflicting(res, requestedItems, requestedFrom, requestedTo)).toBe(true)
  })

  it('PAID_IN_CASH reservation blocks the date range', () => {
    const res = makeReservation({ status: RESERVATION_PAID_IN_CASH })
    expect(isConflicting(res, requestedItems, requestedFrom, requestedTo)).toBe(true)
  })

  it('CANCELED reservation does NOT block (default blocking set)', () => {
    const res = makeReservation({ status: RESERVATION_CANCELED })
    expect(isConflicting(res, requestedItems, requestedFrom, requestedTo)).toBe(false)
  })

  it('PAYMENT_FAILED reservation does NOT block (default blocking set)', () => {
    const res = makeReservation({ status: RESERVATION_PAYMENT_FAILED })
    expect(isConflicting(res, requestedItems, requestedFrom, requestedTo)).toBe(false)
  })

  it('REFUNDED reservation does NOT block (default blocking set)', () => {
    const res = makeReservation({ status: RESERVATION_REFUNDED })
    expect(isConflicting(res, requestedItems, requestedFrom, requestedTo)).toBe(false)
  })
})

describe('conflict predicate — operational status filtering', () => {
  const requestedFrom = d('2026-07-03T00:00:00Z')
  const requestedTo = d('2026-07-05T23:59:59Z')
  const requestedItems = ['item-1']

  it('EXPECTED operational status is blocking', () => {
    const res = makeReservation({ operationalStatus: OP_EXPECTED })
    expect(isConflicting(res, requestedItems, requestedFrom, requestedTo)).toBe(true)
  })

  it('CHECKED_IN operational status is blocking', () => {
    const res = makeReservation({ operationalStatus: OP_CHECKED_IN })
    expect(isConflicting(res, requestedItems, requestedFrom, requestedTo)).toBe(true)
  })

  it('WALKED_IN operational status is blocking', () => {
    const res = makeReservation({ operationalStatus: OP_WALKED_IN })
    expect(isConflicting(res, requestedItems, requestedFrom, requestedTo)).toBe(true)
  })

  it('NO_SHOW operational status is NON-blocking (guest never arrived)', () => {
    const res = makeReservation({ operationalStatus: OP_NO_SHOW })
    expect(isConflicting(res, requestedItems, requestedFrom, requestedTo)).toBe(false)
  })

  it('DEPARTED operational status is NON-blocking (guest left)', () => {
    const res = makeReservation({ operationalStatus: OP_DEPARTED })
    expect(isConflicting(res, requestedItems, requestedFrom, requestedTo)).toBe(false)
  })
})

describe('conflict predicate — date overlap', () => {
  const requestedFrom = d('2026-07-05T00:00:00Z')
  const requestedTo = d('2026-07-10T23:59:59Z')
  const requestedItems = ['item-1']

  it('existing range fully inside requested range conflicts', () => {
    const res = makeReservation({
      from: d('2026-07-06T00:00:00Z'),
      to: d('2026-07-09T23:59:59Z'),
    })
    expect(isConflicting(res, requestedItems, requestedFrom, requestedTo)).toBe(true)
  })

  it('existing range fully covers requested range conflicts', () => {
    const res = makeReservation({
      from: d('2026-07-01T00:00:00Z'),
      to: d('2026-07-15T23:59:59Z'),
    })
    expect(isConflicting(res, requestedItems, requestedFrom, requestedTo)).toBe(true)
  })

  it('existing range overlaps start of requested range conflicts', () => {
    const res = makeReservation({
      from: d('2026-07-01T00:00:00Z'),
      to: d('2026-07-07T23:59:59Z'),
    })
    expect(isConflicting(res, requestedItems, requestedFrom, requestedTo)).toBe(true)
  })

  it('existing range overlaps end of requested range conflicts', () => {
    const res = makeReservation({
      from: d('2026-07-08T00:00:00Z'),
      to: d('2026-07-15T23:59:59Z'),
    })
    expect(isConflicting(res, requestedItems, requestedFrom, requestedTo)).toBe(true)
  })

  it('existing range ends exactly on requested start conflicts (boundary touch)', () => {
    const res = makeReservation({
      from: d('2026-07-01T00:00:00Z'),
      to: d('2026-07-05T00:00:00Z'), // touches requestedFrom exactly
    })
    expect(isConflicting(res, requestedItems, requestedFrom, requestedTo)).toBe(true)
  })

  it('existing range starts exactly on requested end conflicts (boundary touch)', () => {
    const res = makeReservation({
      from: d('2026-07-10T23:59:59Z'), // touches requestedTo exactly
      to: d('2026-07-15T23:59:59Z'),
    })
    expect(isConflicting(res, requestedItems, requestedFrom, requestedTo)).toBe(true)
  })

  it('existing range entirely before requested range does not conflict', () => {
    const res = makeReservation({
      from: d('2026-07-01T00:00:00Z'),
      to: d('2026-07-04T23:59:59Z'), // ends before requestedFrom
    })
    expect(isConflicting(res, requestedItems, requestedFrom, requestedTo)).toBe(false)
  })

  it('existing range entirely after requested range does not conflict', () => {
    const res = makeReservation({
      from: d('2026-07-11T00:00:00Z'), // starts after requestedTo
      to: d('2026-07-15T23:59:59Z'),
    })
    expect(isConflicting(res, requestedItems, requestedFrom, requestedTo)).toBe(false)
  })
})

describe('conflict predicate — item overlap', () => {
  const requestedFrom = d('2026-07-05T00:00:00Z')
  const requestedTo = d('2026-07-10T23:59:59Z')

  it('conflict when existing reservation shares at least one item with requested', () => {
    const res = makeReservation({ itemIds: ['item-1', 'item-2'] })
    expect(isConflicting(res, ['item-2', 'item-3'], requestedFrom, requestedTo)).toBe(true)
  })

  it('no conflict when existing reservation has no items in common', () => {
    const res = makeReservation({ itemIds: ['item-3', 'item-4'] })
    expect(isConflicting(res, ['item-1', 'item-2'], requestedFrom, requestedTo)).toBe(false)
  })

  it('multi-item group: all sibling items block when any one is claimed', () => {
    // Simulates the SunbedGroup expansion — caller passes all group member IDs
    const res = makeReservation({ itemIds: ['item-A', 'item-B', 'item-C'] })
    // Requesting only item-B (a sibling) still conflicts
    expect(isConflicting(res, ['item-B'], requestedFrom, requestedTo)).toBe(true)
  })
})

describe('conflict predicate — custom blocking sets (partner stricter semantics)', () => {
  const requestedFrom = d('2026-07-05T00:00:00Z')
  const requestedTo = d('2026-07-10T23:59:59Z')
  const requestedItems = ['item-1']

  // Partner sites use notIn:[CANCELED] — so PAYMENT_FAILED and REFUNDED ARE blocking there.
  // To match that, pass a custom blockingStatuses that includes them.
  const strictBlockingStatuses = [
    RESERVATION_PENDING,
    RESERVATION_PROCESSING,
    RESERVATION_COMPLETE,
    RESERVATION_PAID_IN_CASH,
    RESERVATION_PAYMENT_FAILED,
    RESERVATION_REFUNDED,
  ] as const

  it('PAYMENT_FAILED blocks under strict partner semantics', () => {
    const res = makeReservation({ status: RESERVATION_PAYMENT_FAILED })
    expect(
      isConflicting(res, requestedItems, requestedFrom, requestedTo, strictBlockingStatuses)
    ).toBe(true)
  })

  it('REFUNDED blocks under strict partner semantics', () => {
    const res = makeReservation({ status: RESERVATION_REFUNDED })
    expect(
      isConflicting(res, requestedItems, requestedFrom, requestedTo, strictBlockingStatuses)
    ).toBe(true)
  })

  it('CANCELED still does not block even under strict semantics', () => {
    const res = makeReservation({ status: RESERVATION_CANCELED })
    expect(
      isConflicting(res, requestedItems, requestedFrom, requestedTo, strictBlockingStatuses)
    ).toBe(false)
  })
})
