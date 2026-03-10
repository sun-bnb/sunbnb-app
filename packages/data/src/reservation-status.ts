/**
 * Shared Reservation / Order / RentalBooking Status Constants
 *
 * Single source of truth for all status values used across the platform.
 * Import from '@repo/data/reservation-status' in any app or package.
 *
 * Status lifecycle:
 *
 *   Reservation (online payment):
 *     pending → processing → complete
 *     pending → processing → payment_failed
 *     complete → canceled  (triggers refund)
 *     complete → refunded  (via provider webhook)
 *
 *   Reservation (off-platform / walk-in):
 *     → complete       (free site, created directly)
 *     → paid-in-cash   (cash site, walk-in or calendar booking)
 *
 *   Order:
 *     pending → processing → complete
 *     pending → complete   (off-platform / unpaid site)
 *     complete → accepted → preparing → ready → delivered
 *     complete → canceled / refunded
 *
 *   RentalBooking:
 *     pending → processing → complete
 *     pending → processing → payment_failed
 */

// ─── Reservation Statuses ───────────────────────────────────────────────────

/** Initial state — reservation created, awaiting payment initiation. */
export const RESERVATION_PENDING = 'pending' as const

/** Payment initiated with provider — waiting for confirmation. */
export const RESERVATION_PROCESSING = 'processing' as const

/** Payment confirmed and invoices created — the terminal success state. */
export const RESERVATION_COMPLETE = 'complete' as const

/** Walk-in or cash booking — partner-created, no online payment. */
export const RESERVATION_PAID_IN_CASH = 'paid-in-cash' as const

/** Payment provider reported failure, cancellation, or expiry. */
export const RESERVATION_PAYMENT_FAILED = 'payment_failed' as const

/** User or partner canceled the reservation (refund issued if was paid). */
export const RESERVATION_CANCELED = 'canceled' as const

/** Payment provider confirmed a refund (via webhook). */
export const RESERVATION_REFUNDED = 'refunded' as const

// ─── All Valid Reservation Statuses ─────────────────────────────────────────

export const RESERVATION_STATUSES = [
  RESERVATION_PENDING,
  RESERVATION_PROCESSING,
  RESERVATION_COMPLETE,
  RESERVATION_PAID_IN_CASH,
  RESERVATION_PAYMENT_FAILED,
  RESERVATION_CANCELED,
  RESERVATION_REFUNDED,
] as const

export type ReservationStatus = (typeof RESERVATION_STATUSES)[number]

// ─── Semantic Groupings ─────────────────────────────────────────────────────

/** Statuses that block a seat/item from being available for new bookings. */
export const BLOCKING_STATUSES: ReservationStatus[] = [
  RESERVATION_PENDING,
  RESERVATION_PROCESSING,
  RESERVATION_COMPLETE,
  RESERVATION_PAID_IN_CASH,
]

/** Statuses that represent a successfully paid/completed reservation. */
export const PAID_STATUSES: ReservationStatus[] = [
  RESERVATION_COMPLETE,
]

/** Statuses where no further transitions are expected. */
export const TERMINAL_STATUSES: ReservationStatus[] = [
  RESERVATION_PAYMENT_FAILED,
  RESERVATION_CANCELED,
  RESERVATION_REFUNDED,
]

// ─── Order Statuses ─────────────────────────────────────────────────────────

export const ORDER_PENDING = 'pending' as const
export const ORDER_PROCESSING = 'processing' as const
export const ORDER_COMPLETE = 'complete' as const
export const ORDER_PAYMENT_FAILED = 'payment_failed' as const
export const ORDER_CANCELED = 'canceled' as const
export const ORDER_REFUNDED = 'refunded' as const

// Order fulfillment statuses (post-payment)
export const ORDER_ACCEPTED = 'accepted' as const
export const ORDER_PREPARING = 'preparing' as const
export const ORDER_READY = 'ready' as const
export const ORDER_DELIVERED = 'delivered' as const
export const ORDER_COMPLETED = 'completed' as const
export const ORDER_REJECTED = 'rejected' as const
export const ORDER_DISCARDED = 'discarded' as const

// ─── Rental Booking Statuses ────────────────────────────────────────────────

export const RENTAL_PENDING = 'pending' as const
export const RENTAL_PROCESSING = 'processing' as const
export const RENTAL_COMPLETE = 'complete' as const
export const RENTAL_PAYMENT_FAILED = 'payment_failed' as const
export const RENTAL_CANCELED = 'canceled' as const
export const RENTAL_REFUNDED = 'refunded' as const

// ─── Operational Statuses (orthogonal to payment status) ────────────────────

export const OP_EXPECTED = 'expected' as const
export const OP_CHECKED_IN = 'checked-in' as const
export const OP_WALKED_IN = 'walked-in' as const
export const OP_DEPARTED = 'departed' as const
export const OP_NO_SHOW = 'no-show' as const

// Rental operational statuses
export const OP_RESERVED = 'reserved' as const
export const OP_PICKED_UP = 'picked-up' as const
export const OP_RETURNED = 'returned' as const
