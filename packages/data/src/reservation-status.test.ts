import { describe, it, expect } from 'vitest'
import {
  RESERVATION_PENDING,
  RESERVATION_PROCESSING,
  RESERVATION_COMPLETE,
  RESERVATION_PAID_IN_CASH,
  RESERVATION_HELD,
  RESERVATION_PAYMENT_FAILED,
  RESERVATION_CANCELED,
  RESERVATION_REFUNDED,
  RESERVATION_STATUSES,
  BLOCKING_STATUSES,
  PAID_STATUSES,
  TERMINAL_STATUSES,
} from './reservation-status'

describe('BLOCKING_STATUSES', () => {
  it('contains pending, processing, complete, paid-in-cash, and held', () => {
    expect(BLOCKING_STATUSES).toContain(RESERVATION_PENDING)
    expect(BLOCKING_STATUSES).toContain(RESERVATION_PROCESSING)
    expect(BLOCKING_STATUSES).toContain(RESERVATION_COMPLETE)
    expect(BLOCKING_STATUSES).toContain(RESERVATION_PAID_IN_CASH)
    expect(BLOCKING_STATUSES).toContain(RESERVATION_HELD)
  })

  it('excludes canceled, refunded, and payment_failed', () => {
    expect(BLOCKING_STATUSES).not.toContain(RESERVATION_CANCELED)
    expect(BLOCKING_STATUSES).not.toContain(RESERVATION_REFUNDED)
    expect(BLOCKING_STATUSES).not.toContain(RESERVATION_PAYMENT_FAILED)
  })
})

describe('PAID_STATUSES', () => {
  it('contains only complete', () => {
    expect(PAID_STATUSES).toEqual([RESERVATION_COMPLETE])
  })

  it('excludes held — a hold carries no payment / revenue', () => {
    expect(PAID_STATUSES).not.toContain(RESERVATION_HELD)
  })
})

describe('TERMINAL_STATUSES', () => {
  it('contains payment_failed, canceled, and refunded', () => {
    expect(TERMINAL_STATUSES).toContain(RESERVATION_PAYMENT_FAILED)
    expect(TERMINAL_STATUSES).toContain(RESERVATION_CANCELED)
    expect(TERMINAL_STATUSES).toContain(RESERVATION_REFUNDED)
  })

  it('excludes active states', () => {
    expect(TERMINAL_STATUSES).not.toContain(RESERVATION_PENDING)
    expect(TERMINAL_STATUSES).not.toContain(RESERVATION_PROCESSING)
    expect(TERMINAL_STATUSES).not.toContain(RESERVATION_COMPLETE)
  })
})

describe('no unexpected overlap', () => {
  it('terminal statuses do not intersect with blocking statuses', () => {
    const overlap = TERMINAL_STATUSES.filter(s => BLOCKING_STATUSES.includes(s))
    expect(overlap).toHaveLength(0)
  })
})

describe('RESERVATION_STATUSES', () => {
  it('contains all individual status constants', () => {
    const allStatuses = [
      RESERVATION_PENDING,
      RESERVATION_PROCESSING,
      RESERVATION_COMPLETE,
      RESERVATION_PAID_IN_CASH,
      RESERVATION_HELD,
      RESERVATION_PAYMENT_FAILED,
      RESERVATION_CANCELED,
      RESERVATION_REFUNDED,
    ]
    for (const status of allStatuses) {
      expect(RESERVATION_STATUSES).toContain(status)
    }
  })

  it('has no extra statuses beyond the known constants', () => {
    expect(RESERVATION_STATUSES).toHaveLength(8)
  })
})
