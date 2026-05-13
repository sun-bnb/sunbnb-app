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
