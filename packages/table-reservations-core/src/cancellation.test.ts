import { describe, it, expect } from 'vitest'
import { isPastCancellationDeadline } from './cancellation'

describe('isPastCancellationDeadline', () => {
  const from = new Date('2026-05-25T20:00:00Z') // reservation start

  it('never restricts when no deadline is configured', () => {
    const now = new Date('2026-05-25T19:59:00Z') // 1 min before, but no deadline
    expect(isPastCancellationDeadline(from, null, now)).toBe(false)
    expect(isPastCancellationDeadline(from, undefined, now)).toBe(false)
    expect(isPastCancellationDeadline(from, 0, now)).toBe(false)
    expect(isPastCancellationDeadline(from, -3, now)).toBe(false)
  })

  it('is false comfortably before the deadline', () => {
    // 24h deadline → the cutoff is 2026-05-24T20:00; well before that is fine.
    expect(isPastCancellationDeadline(from, 24, new Date('2026-05-24T10:00:00Z'))).toBe(false)
  })

  it('is true once within the deadline window (too late)', () => {
    // 24h deadline → at/after 2026-05-24T20:00 is too late.
    expect(isPastCancellationDeadline(from, 24, new Date('2026-05-24T20:00:00Z'))).toBe(true)
    expect(isPastCancellationDeadline(from, 24, new Date('2026-05-25T12:00:00Z'))).toBe(true)
    // 2h deadline, 1h before start → too late.
    expect(isPastCancellationDeadline(from, 2, new Date('2026-05-25T19:00:00Z'))).toBe(true)
  })
})
