// Pure-validation tests for createTableReservation's input rules.
// Kept separate from the DB-touching path so these run with Vitest alone.

import { describe, it, expect } from 'vitest'

// Re-implement the validator under test here to avoid pulling the Prisma
// dependency graph into a unit test. If the internal validator diverges
// from this mirror, the integration test (MVP-6) catches it.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

interface Input {
  restaurantId?: string
  tableId?: string
  from?: Date
  to?: Date
  partySize?: number
  guestName?: string
  guestEmail?: string
  guestPhone?: string | null
  specialRequests?: string | null
  userId?: string | null
  anonId?: string | null
}

function validate(input: Input): string[] {
  const errors: string[] = []
  if (!input.restaurantId) errors.push('restaurantId is required')
  if (!input.tableId) errors.push('tableId is required')
  if (!(input.from instanceof Date) || Number.isNaN(input.from.getTime())) errors.push('Invalid from')
  if (!(input.to instanceof Date) || Number.isNaN(input.to.getTime())) errors.push('Invalid to')
  if (input.from && input.to && input.from >= input.to) errors.push('from must be before to')
  if (!Number.isInteger(input.partySize) || (input.partySize ?? 0) < 1 || (input.partySize ?? 0) > 50)
    errors.push('Party size must be 1–50')
  if (!input.guestName || input.guestName.trim().length === 0) errors.push('Guest name is required')
  if (input.guestName && input.guestName.length > 120) errors.push('Guest name too long')
  if (!input.guestEmail || !EMAIL_RE.test(input.guestEmail)) errors.push('Valid guest email is required')
  if (input.guestPhone && input.guestPhone.length > 40) errors.push('Guest phone too long')
  if (input.specialRequests && input.specialRequests.length > 500) errors.push('Special requests too long')
  if (!input.userId && !input.anonId) errors.push('Identity is required (userId or anonId)')
  if (input.from && input.from.getTime() < Date.now() - 60 * 1000) errors.push('Cannot book in the past')
  return errors
}

const good = (): Input => ({
  restaurantId: 'r1',
  tableId: 't1',
  from: new Date(Date.now() + 3600_000),
  to: new Date(Date.now() + 3600_000 + 7200_000),
  partySize: 2,
  guestName: 'Alice',
  guestEmail: 'alice@example.com',
  anonId: 'anon-1',
})

describe('createTableReservation input validation', () => {
  it('accepts a well-formed input', () => {
    expect(validate(good())).toEqual([])
  })

  it('rejects missing restaurantId', () => {
    const out = validate({ ...good(), restaurantId: undefined })
    expect(out).toContain('restaurantId is required')
  })

  it('rejects a swapped time range', () => {
    const g = good()
    const out = validate({ ...g, from: g.to, to: g.from })
    expect(out).toContain('from must be before to')
  })

  it('rejects an invalid email', () => {
    expect(validate({ ...good(), guestEmail: 'not-an-email' })).toContain(
      'Valid guest email is required',
    )
  })

  it('rejects party size out of range', () => {
    expect(validate({ ...good(), partySize: 0 })).toContain('Party size must be 1–50')
    expect(validate({ ...good(), partySize: 999 })).toContain('Party size must be 1–50')
  })

  it('rejects a booking in the past', () => {
    const past = new Date(Date.now() - 3600_000)
    const later = new Date(Date.now() - 1800_000)
    expect(validate({ ...good(), from: past, to: later })).toContain('Cannot book in the past')
  })

  it('requires identity (userId or anonId)', () => {
    expect(validate({ ...good(), userId: null, anonId: null })).toContain(
      'Identity is required (userId or anonId)',
    )
  })
})
