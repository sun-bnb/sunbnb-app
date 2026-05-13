import { describe, it, expect } from 'vitest'
import {
  TABLE_RESERVATION_STATUS,
  TABLE_RESERVATION_OP_STATUS,
  BLOCKING_TABLE_RESERVATION_STATUSES,
  BLOCKING_TABLE_RESERVATION_OP_STATUSES,
  TERMINAL_TABLE_RESERVATION_OP_STATUSES,
} from './status'

describe('table reservation status', () => {
  it('blocks a slot when confirmed + expected', () => {
    expect(BLOCKING_TABLE_RESERVATION_STATUSES).toContain(
      TABLE_RESERVATION_STATUS.CONFIRMED,
    )
    expect(BLOCKING_TABLE_RESERVATION_OP_STATUSES).toContain(
      TABLE_RESERVATION_OP_STATUS.EXPECTED,
    )
    expect(BLOCKING_TABLE_RESERVATION_OP_STATUSES).toContain(
      TABLE_RESERVATION_OP_STATUS.SEATED,
    )
  })

  it('does not block when canceled or no_show', () => {
    expect(BLOCKING_TABLE_RESERVATION_STATUSES).not.toContain(
      TABLE_RESERVATION_STATUS.CANCELED,
    )
    expect(BLOCKING_TABLE_RESERVATION_OP_STATUSES).not.toContain(
      TABLE_RESERVATION_OP_STATUS.NO_SHOW,
    )
  })

  it('marks departed and no_show as terminal', () => {
    expect(TERMINAL_TABLE_RESERVATION_OP_STATUSES).toContain(
      TABLE_RESERVATION_OP_STATUS.DEPARTED,
    )
    expect(TERMINAL_TABLE_RESERVATION_OP_STATUSES).toContain(
      TABLE_RESERVATION_OP_STATUS.NO_SHOW,
    )
  })

  it('does not mark expected or seated as terminal', () => {
    expect(TERMINAL_TABLE_RESERVATION_OP_STATUSES).not.toContain(
      TABLE_RESERVATION_OP_STATUS.EXPECTED,
    )
    expect(TERMINAL_TABLE_RESERVATION_OP_STATUSES).not.toContain(
      TABLE_RESERVATION_OP_STATUS.SEATED,
    )
  })
})
