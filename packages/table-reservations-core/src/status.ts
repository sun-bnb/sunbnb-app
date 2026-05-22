// Status constants for TableReservation. Plain strings (not Prisma enums)
// to match the convention in @repo/data/reservation-status.
//
// Two dimensions:
//   - TABLE_RESERVATION_STATUS   — lifecycle: confirmed | canceled
//   - TABLE_RESERVATION_OP_STATUS — operational: expected → seated → departed
//                                   (or no_show)

export const TABLE_RESERVATION_STATUS = {
  CONFIRMED: 'confirmed',
  CANCELED: 'canceled',
} as const

export type TableReservationStatus =
  (typeof TABLE_RESERVATION_STATUS)[keyof typeof TABLE_RESERVATION_STATUS]

export const TABLE_RESERVATION_OP_STATUS = {
  EXPECTED: 'expected',
  SEATED: 'seated',
  DEPARTED: 'departed',
  NO_SHOW: 'no_show',
} as const

export type TableReservationOpStatus =
  (typeof TABLE_RESERVATION_OP_STATUS)[keyof typeof TABLE_RESERVATION_OP_STATUS]

// Reservations in these statuses *block* a table's slot from being re-booked.
// A canceled or no_show reservation does not block.
export const BLOCKING_TABLE_RESERVATION_STATUSES: readonly string[] = [
  TABLE_RESERVATION_STATUS.CONFIRMED,
]

export const BLOCKING_TABLE_RESERVATION_OP_STATUSES: readonly string[] = [
  TABLE_RESERVATION_OP_STATUS.EXPECTED,
  TABLE_RESERVATION_OP_STATUS.SEATED,
]

// Terminal states — reservation is done, no more transitions expected.
export const TERMINAL_TABLE_RESERVATION_OP_STATUSES: readonly string[] = [
  TABLE_RESERVATION_OP_STATUS.DEPARTED,
  TABLE_RESERVATION_OP_STATUS.NO_SHOW,
]

// ─── No-show protection (chunk 1e) ───────────────────────────────────────────

export const NO_SHOW_POLICY = {
  NONE: 'none',
  DEPOSIT: 'deposit',
} as const

export type NoShowPolicy = (typeof NO_SHOW_POLICY)[keyof typeof NO_SHOW_POLICY]

// Deposit lifecycle: none (free) → pending (required, awaiting payment) → held
// (collected) → charged (kept after no-show) | refunded (timely cancel) |
// released (guest showed; hold dropped / credited).
export const DEPOSIT_STATUS = {
  NONE: 'none',
  PENDING: 'pending',
  HELD: 'held',
  CHARGED: 'charged',
  REFUNDED: 'refunded',
  RELEASED: 'released',
} as const

export type DepositStatus = (typeof DEPOSIT_STATUS)[keyof typeof DEPOSIT_STATUS]

// ─── Waitlist (chunk 1g) ──────────────────────────────────────────────────────

export const WAITLIST_STATUS = {
  WAITING: 'waiting',
  NOTIFIED: 'notified',
  CONVERTED: 'converted',
  EXPIRED: 'expired',
} as const

export type WaitlistStatus = (typeof WAITLIST_STATUS)[keyof typeof WAITLIST_STATUS]
