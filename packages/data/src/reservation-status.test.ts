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
  TAB_OPEN,
  TAB_PENDING_PAYMENT,
  TAB_PAID,
  TAB_SETTLED_CASH,
  TAB_DISCARDED,
  TAB_STATUSES,
  TAB_TERMINAL_STATUSES,
  TAB_OPEN_STATUSES,
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

// ─── Dine-In Tab Status tests ─────────────────────────────────────────────────

describe('TAB_OPEN', () => {
  it('equals exactly "open" to match the schema default', () => {
    expect(TAB_OPEN).toBe('open')
  })
})

describe('TAB_STATUSES', () => {
  it('contains all five tab status constants', () => {
    expect(TAB_STATUSES).toContain(TAB_OPEN)
    expect(TAB_STATUSES).toContain(TAB_PENDING_PAYMENT)
    expect(TAB_STATUSES).toContain(TAB_PAID)
    expect(TAB_STATUSES).toContain(TAB_SETTLED_CASH)
    expect(TAB_STATUSES).toContain(TAB_DISCARDED)
  })

  it('has exactly 5 statuses', () => {
    expect(TAB_STATUSES).toHaveLength(5)
  })
})

describe('TAB_TERMINAL_STATUSES', () => {
  it('contains paid, settled_cash, and discarded', () => {
    expect(TAB_TERMINAL_STATUSES).toContain(TAB_PAID)
    expect(TAB_TERMINAL_STATUSES).toContain(TAB_SETTLED_CASH)
    expect(TAB_TERMINAL_STATUSES).toContain(TAB_DISCARDED)
  })

  it('excludes open and pending_payment (non-terminal states)', () => {
    expect(TAB_TERMINAL_STATUSES).not.toContain(TAB_OPEN)
    expect(TAB_TERMINAL_STATUSES).not.toContain(TAB_PENDING_PAYMENT)
  })
})

describe('TAB_OPEN_STATUSES', () => {
  it('contains open and pending_payment', () => {
    expect(TAB_OPEN_STATUSES).toContain(TAB_OPEN)
    expect(TAB_OPEN_STATUSES).toContain(TAB_PENDING_PAYMENT)
  })

  it('excludes all terminal statuses', () => {
    for (const s of TAB_TERMINAL_STATUSES) {
      expect(TAB_OPEN_STATUSES).not.toContain(s)
    }
  })
})

describe('TAB grouping invariants', () => {
  it('open and terminal statuses partition TAB_STATUSES with no overlap', () => {
    const overlap = TAB_OPEN_STATUSES.filter(s => TAB_TERMINAL_STATUSES.includes(s))
    expect(overlap).toHaveLength(0)
  })

  it('union of open and terminal covers all TAB_STATUSES', () => {
    const union = new Set([...TAB_OPEN_STATUSES, ...TAB_TERMINAL_STATUSES])
    for (const s of TAB_STATUSES) {
      expect(union.has(s)).toBe(true)
    }
  })
})
