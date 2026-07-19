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

/**
 * Floor-created lightweight hold (Alonso `reservada`): a bed penciled in for
 * today with **no payment and no invoice** — distinct from a paid walk-in
 * (`paid-in-cash`) and a booked online reservation (`complete`). Blocking (it
 * occupies the bed) but zero-revenue; the cleanup cron GC's it once expired.
 * Pairs with `operationalStatus = OP_EXPECTED` so it reuses the check-in / no-show
 * machinery and renders in the existing "expected" (reserved) lane.
 */
export const RESERVATION_HELD = 'held' as const

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
  RESERVATION_HELD,
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
  RESERVATION_HELD,
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
// These values live on TWO columns: Reservation.operationalStatus (whole-stay
// legacy, will be retired in P4) and ReservationDay.operationalStatus (per-day
// authoritative record, introduced in track 012). Use these constants for both.

export const OP_EXPECTED = 'expected' as const
export const OP_CHECKED_IN = 'checked-in' as const
export const OP_WALKED_IN = 'walked-in' as const
export const OP_DEPARTED = 'departed' as const
export const OP_NO_SHOW = 'no-show' as const

/**
 * Complimentary occupancy — the bed is given away free (regulars, staff, comps).
 * Occupies the bed like a walk-in but carries no charge; pair with the durable
 * `Reservation.isComp` flag (the analytics source of truth that survives the
 * operational lifecycle). Distinct from OP_WALKED_IN so comps never collide with
 * walk-in release/queries, and from 'blocked' (out-of-service, not a guest).
 */
export const OP_COMP = 'comp' as const

// Rental operational statuses
export const OP_RESERVED = 'reserved' as const
export const OP_PICKED_UP = 'picked-up' as const
export const OP_RETURNED = 'returned' as const

// ─── Dine-In Tab Statuses ────────────────────────────────────────────────────
// These values live on the `TableTab.status` column (plain String, not enum).
// TAB_OPEN is the schema default and MUST remain exactly `'open'` to match it.

/**
 * The tab is open — orders are accumulating, payment not yet initiated.
 * MUST equal the schema default (`@default("open")`).
 */
export const TAB_OPEN = 'open' as const

/**
 * A Mollie (or demo) payment has been initiated for the tab total.
 * The tab is waiting for payment confirmation.
 */
export const TAB_PENDING_PAYMENT = 'pending_payment' as const

/**
 * Payment confirmed and invoices created — the terminal success state for
 * an online payment. Mirrors RESERVATION_COMPLETE semantics.
 */
export const TAB_PAID = 'paid' as const

/**
 * The tab was closed by staff via a cash settlement at the table.
 * Partner-only receipt; no Mollie routing occurred.
 */
export const TAB_SETTLED_CASH = 'settled_cash' as const

/**
 * The tab was discarded by staff (walk-out / comp / error correction).
 * No revenue recorded; orders remain for kitchen reporting.
 */
export const TAB_DISCARDED = 'discarded' as const

/** All valid tab status values. */
export const TAB_STATUSES = [
  TAB_OPEN,
  TAB_PENDING_PAYMENT,
  TAB_PAID,
  TAB_SETTLED_CASH,
  TAB_DISCARDED,
] as const

export type TabStatus = (typeof TAB_STATUSES)[number]

/**
 * Terminal tab statuses — no further payment or status transitions expected.
 * A tab in any of these states has a NULL `openTableId` (concurrency guard
 * reset), allowing a new tab to be opened on the same table.
 */
export const TAB_TERMINAL_STATUSES: TabStatus[] = [
  TAB_PAID,
  TAB_SETTLED_CASH,
  TAB_DISCARDED,
]

/**
 * The single open state — a tab with this status has `openTableId` set to
 * the tableId, preventing a second concurrent open tab on the same table.
 */
export const TAB_OPEN_STATUSES: TabStatus[] = [
  TAB_OPEN,
  TAB_PENDING_PAYMENT,
]
