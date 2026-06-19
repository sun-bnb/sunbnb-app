/**
 * reserveWithConflictGuard — transactional check-then-create for reservations.
 *
 * Solves the double-booking race: several call sites in partner and user apps do
 * a conflict-check query then a create as **two separate awaits**, so two concurrent
 * requests can both pass the check and both create → double-booked bed.
 *
 * This helper collapses the check + create into a single interactive
 * `$transaction`, and serializes concurrent claimants for the same beds via a
 * `SELECT … FOR UPDATE` lock on the `InventoryItem` rows. The second caller blocks
 * on the row lock until the first commits, then re-runs the conflict check inside
 * the transaction and sees the newly-created reservation.
 *
 * Usage: call sites expand their item list to include SunbedGroup / pair siblings
 * BEFORE calling this helper. This helper does not expand items — it operates on
 * the already-expanded set.
 *
 * Conflict semantics (configurable via `blockingStatuses` and `blockingOpStatuses`):
 *   - Default `blockingStatuses`: PENDING, PROCESSING, COMPLETE, PAID_IN_CASH
 *     (i.e. BLOCKING_STATUSES from reservation-status.ts). PAYMENT_FAILED,
 *     CANCELED, REFUNDED are non-blocking by default — those beds are free again.
 *   - Default `blockingOpStatuses` excluded (i.e. non-blocking op statuses):
 *     OP_NO_SHOW, OP_DEPARTED. All other operational statuses block.
 *   - Date overlap: standard half-open / closed interval —
 *     existing.from <= requested.to AND existing.to >= requested.from
 *
 * Divergence note: the partner call sites (manage/actions.ts, calendar/actions.ts)
 * use `status: { notIn: [CANCELED] }` which also blocks PAYMENT_FAILED and
 * REFUNDED. The user availability service uses `status: { in: BLOCKING_STATUSES }`
 * which excludes those. The more correct semantic is the user one (a failed or
 * refunded payment frees the seat), so BLOCKING_STATUSES is the default. Pass a
 * custom `blockingStatuses` to match the stricter partner logic if needed.
 */

import { Prisma } from '@prisma/client'
import prisma from '../index'
import {
  BLOCKING_STATUSES,
  OP_NO_SHOW,
  OP_DEPARTED,
  OP_RETURNED,
  RENTAL_CANCELED,
} from './reservation-status'

// ─── Shared private type ─────────────────────────────────────────────────────

/** Prisma transaction client — the argument type for $transaction callbacks. */
type Tx = Prisma.TransactionClient

// ─── Types ──────────────────────────────────────────────────────────────────

/** The data needed to create a Reservation (without the items connect — that's separate). */
export type ReservationCreateData = Omit<
  Prisma.ReservationCreateInput,
  'items' | 'site' | 'user' | 'employee'
> & {
  /** Connect by id — use the already-expanded list (SunbedGroup + pair siblings). */
  itemIds: string[]
  siteId: string
  userId: string
  /** Floor-staff attribution (manage page current worker); null/undefined when unset. */
  employeeId?: string | null
}

export type ConflictGuardOptions = {
  /**
   * Payment statuses that block a bed from being rebooked.
   * Defaults to BLOCKING_STATUSES (PENDING, PROCESSING, COMPLETE, PAID_IN_CASH).
   */
  blockingStatuses?: readonly string[]
  /**
   * Operational statuses that are NON-blocking (i.e. excluded from the conflict check).
   * Defaults to [OP_NO_SHOW, OP_DEPARTED] — those guests are gone.
   */
  nonBlockingOpStatuses?: readonly string[]
}

export type ConflictGuardResult =
  | { outcome: 'created'; reservationId: string }
  | { outcome: 'conflict'; conflictingReservationId: string }

// ─── Shared conflict check helper ────────────────────────────────────────────

/**
 * Find a conflicting reservation inside a transaction.
 *
 * Called from both `reserveWithConflictGuard` (create) and
 * `moveReservationWithConflictGuard` (move). The `excludeReservationId`
 * parameter lets the move guard exclude the reservation being relocated from
 * its own conflict check (a move must not conflict with itself).
 *
 * Must be called via `tx`, not the outer `prisma` client, so it operates on
 * the locked, consistent snapshot.
 */
async function findConflictingReservation(
  tx: Tx,
  params: {
    siteId: string
    from: Date
    to: Date
    itemIds: string[]
    blockingStatuses: readonly string[]
    nonBlockingOpStatuses: readonly string[]
    /** Exclude this reservation id from the conflict check (used by the move guard). */
    excludeReservationId?: string
  }
): Promise<{ id: string } | null> {
  return tx.reservation.findFirst({
    where: {
      siteId: params.siteId,
      status: { in: params.blockingStatuses as string[] },
      operationalStatus: { notIn: params.nonBlockingOpStatuses as string[] },
      from: { lte: params.to },
      to: { gte: params.from },
      items: { some: { id: { in: params.itemIds } } },
      ...(params.excludeReservationId
        ? { id: { not: params.excludeReservationId } }
        : {}),
    },
    select: { id: true },
  })
}

// ─── Guard 1a: reserveWithConflictGuard ─────────────────────────────────────

/**
 * Create a reservation inside a serialized transaction.
 *
 * 1. Acquires a FOR UPDATE row lock on all candidate InventoryItem rows —
 *    any concurrent caller trying to claim the same bed will block here.
 * 2. Re-checks for conflicting reservations inside the transaction using tx.
 * 3. If a conflict is found → rolls back and returns { outcome: 'conflict' }.
 * 4. If clear → creates the reservation and returns { outcome: 'created' }.
 *
 * The caller is responsible for expanding itemIds to include SunbedGroup /
 * pair siblings before calling this function.
 *
 * @throws Only for unexpected DB / Prisma errors (not for normal conflicts).
 */
export async function reserveWithConflictGuard(
  data: ReservationCreateData,
  options: ConflictGuardOptions = {}
): Promise<ConflictGuardResult> {
  const {
    blockingStatuses = BLOCKING_STATUSES,
    nonBlockingOpStatuses = [OP_NO_SHOW, OP_DEPARTED],
  } = options

  const { itemIds, siteId, userId, employeeId, ...reservationFields } = data

  return prisma.$transaction(async (tx) => {
    // ── Step 1: Lock the candidate InventoryItem rows FOR UPDATE ──────────────
    //
    // This is the serialization point. Two concurrent callers claiming the same
    // bed will both try to acquire this lock. The second one blocks until the
    // first transaction commits or rolls back, then proceeds to the conflict
    // check and (correctly) finds the newly-created reservation.
    //
    // We lock InventoryItem rows (not Reservation rows) because the reservation
    // doesn't exist yet — we can't lock something that hasn't been created.
    // Prisma doesn't expose SELECT FOR UPDATE directly, so we drop to $queryRaw.
    if (itemIds.length > 0) {
      await tx.$queryRaw`
        SELECT id FROM "InventoryItem"
        WHERE id = ANY(${itemIds}::text[])
        FOR UPDATE
      `
    }

    // ── Step 2: Conflict check inside the transaction ─────────────────────────
    //
    // Must run via `tx`, not the outer `prisma` client, so it sees the locked
    // state and any rows committed by a concurrent transaction that just released
    // the lock.
    const conflict = await findConflictingReservation(tx, {
      siteId,
      from: data.from as Date,
      to: data.to as Date,
      itemIds,
      blockingStatuses,
      nonBlockingOpStatuses,
    })

    if (conflict) {
      // Return structured conflict result — do NOT throw (throwing would make the
      // transaction error, masking the real reason from the caller).
      // Prisma will roll back the transaction when we return here because we
      // haven't thrown, but the transaction function will resolve (not reject).
      // We signal the conflict via the return value.
      return { outcome: 'conflict' as const, conflictingReservationId: conflict.id }
    }

    // ── Step 3: Create the reservation ───────────────────────────────────────
    const reservation = await tx.reservation.create({
      data: {
        ...reservationFields,
        site: { connect: { id: siteId } },
        user: { connect: { id: userId } },
        ...(employeeId ? { employee: { connect: { id: employeeId } } } : {}),
        items: {
          connect: itemIds.map((id) => ({ id })),
        },
      },
      select: { id: true },
    })

    return { outcome: 'created' as const, reservationId: reservation.id }
  })
}

// ─── Guard 1b: moveReservationWithConflictGuard ───────────────────────────────

/**
 * Relocate an existing reservation onto new beds, with a transactional conflict
 * check that prevents double-booking.
 *
 * The partner `moveReservation` action previously disconnected old items and
 * connected new ones with NO availability check — a concurrent request could
 * race and double-book the target bed. This guard closes that window.
 *
 * 1. Acquires a FOR UPDATE lock on the TARGET InventoryItem rows.
 * 2. Loads the reservation's current date range inside the transaction.
 * 3. Checks for conflicts on newItemIds over [from, to], **excluding this
 *    reservation's own id** — a move is allowed onto beds the reservation
 *    already occupies (self-move is not a conflict).
 * 4. If conflict → returns { outcome: 'conflict' } without writing.
 * 5. If clear → disconnects old items, connects new ones → { outcome: 'moved' }.
 */
export type MoveConflictGuardResult =
  | { outcome: 'moved' }
  | { outcome: 'conflict'; conflictingReservationId: string }
  | { outcome: 'not_found' }

export async function moveReservationWithConflictGuard(
  reservationId: string,
  newItemIds: string[],
  options: ConflictGuardOptions = {}
): Promise<MoveConflictGuardResult> {
  const {
    blockingStatuses = BLOCKING_STATUSES,
    nonBlockingOpStatuses = [OP_NO_SHOW, OP_DEPARTED],
  } = options

  return prisma.$transaction(async (tx) => {
    // ── Step 1: Lock the TARGET InventoryItem rows FOR UPDATE ─────────────────
    //
    // Concurrent move attempts onto the same bed will both try to lock these
    // rows. The second one blocks until the first commits (or rolls back), then
    // re-runs the conflict check and finds the first move already committed.
    if (newItemIds.length > 0) {
      await tx.$queryRaw`
        SELECT id FROM "InventoryItem"
        WHERE id = ANY(${newItemIds}::text[])
        FOR UPDATE
      `
    }

    // ── Step 2: Load the reservation inside the tx ────────────────────────────
    //
    // Must be inside the tx so we see the locked state. We need from/to to
    // scope the conflict check, and current items to disconnect them on success.
    const reservation = await tx.reservation.findUnique({
      where: { id: reservationId },
      select: {
        siteId: true,
        from: true,
        to: true,
        items: { select: { id: true } },
      },
    })

    if (!reservation) {
      return { outcome: 'not_found' as const }
    }

    // ── Step 3: Conflict check, excluding this reservation ────────────────────
    //
    // `excludeReservationId` prevents the guard from treating the reservation's
    // OWN row as a conflict. Without this, a move that keeps one existing bed
    // (partial re-assignment) would always return 'conflict' because the
    // reservation's own row overlaps the target date range.
    const conflict = await findConflictingReservation(tx, {
      siteId: reservation.siteId,
      from: reservation.from,
      to: reservation.to,
      itemIds: newItemIds,
      blockingStatuses,
      nonBlockingOpStatuses,
      excludeReservationId: reservationId,
    })

    if (conflict) {
      return { outcome: 'conflict' as const, conflictingReservationId: conflict.id }
    }

    // ── Step 4: Move — disconnect old items, connect new ones ─────────────────
    const currentItemIds = reservation.items.map((i) => i.id)
    await tx.reservation.update({
      where: { id: reservationId },
      data: {
        items: {
          disconnect: currentItemIds.map((id) => ({ id })),
          connect: newItemIds.map((id) => ({ id })),
        },
      },
    })

    return { outcome: 'moved' as const }
  })
}

// ─── Guard 2: createRentalBookingsWithGuard ───────────────────────────────────

/**
 * The data for a single rental booking to be created atomically.
 * Prices must be computed by the caller (from DB-fetched rates, never client
 * values) before passing to this function — this guard does not recompute money.
 */
export type RentalBookingInput = {
  rentalItemId: string
  siteId: string
  userId: string
  from: Date
  to: Date
  quantity: number
  durationType: string
  totalPrice: number
  paymentAmount: number
  status: string
  operationalStatus: string
  employeeId?: string | null
  pickedUpAt?: Date | null
  guestName?: string | null
  /** Anonymous guest identity — mirrors the same fields on Reservation. */
  anonId?: string | null
  guestEmail?: string | null
  guestContact?: string | null
}

export type RentalGuardResult =
  | { outcome: 'created'; bookingIds: string[] }
  | { outcome: 'unavailable'; rentalItemId: string }

export type RentalGuardOptions = {
  /**
   * Operational statuses that are NON-blocking (excluded from the booked-qty
   * aggregate). Defaults to [OP_RETURNED, RENTAL_CANCELED] — returned and
   * canceled bookings no longer consume stock.
   *
   * Note: RENTAL_CANCELED ('canceled') shares the same string value as the
   * payment status constant; it is used here as an operational status value
   * because some call sites set operationalStatus = 'canceled' on cancellations.
   * This matches the semantics of the existing createWalkInRental call site.
   */
  nonBlockingOpStatuses?: readonly string[]
}

/**
 * Create one or more rental bookings atomically, with a transactional quantity
 * guard that prevents over-booking under concurrency.
 *
 * `createWalkInRental` checked availability and created bookings in two
 * separate steps (aggregate → loop create). This creates two races:
 *  a) Two concurrent requests both pass the aggregate check before either
 *     creates a booking, both then create → total quantity exceeded.
 *  b) A mid-loop failure after some bookings are created → partial write.
 *
 * This guard collapses both into one atomic interactive transaction:
 *
 * 1. Acquires FOR UPDATE locks on all involved RentalItem rows.
 * 2. Re-aggregates booked quantity for each booking inside the tx (consistent
 *    read, no stale data from before the lock was acquired).
 * 3. If any booking would exceed its item's totalQuantity → returns
 *    { outcome: 'unavailable', rentalItemId } with NO rows written (all-or-nothing).
 * 4. If all fit → creates all bookings → { outcome: 'created', bookingIds }.
 *
 * Callers must pass pre-computed prices from DB-fetched rates. This function
 * does not recompute any money values.
 *
 * @throws Only for unexpected DB / Prisma errors (not for normal unavailability).
 */
export async function createRentalBookingsWithGuard(
  bookings: RentalBookingInput[],
  options: RentalGuardOptions = {}
): Promise<RentalGuardResult> {
  const { nonBlockingOpStatuses = [OP_RETURNED, RENTAL_CANCELED] } = options

  // Deduplicate rental item IDs so we lock each item exactly once.
  const rentalItemIds = [...new Set(bookings.map((b) => b.rentalItemId))]

  return prisma.$transaction(async (tx) => {
    // ── Step 1: Lock all involved RentalItem rows FOR UPDATE ──────────────────
    //
    // All concurrent walk-in bookings for these items will contend on these
    // locks. The second concurrent request blocks until the first commits,
    // then re-runs the aggregate and sees the already-created bookings.
    if (rentalItemIds.length > 0) {
      await tx.$queryRaw`
        SELECT id FROM "RentalItem"
        WHERE id = ANY(${rentalItemIds}::text[])
        FOR UPDATE
      `
    }

    // ── Step 2: Load total quantities (consistent read after lock) ────────────
    const rentalItems = await tx.rentalItem.findMany({
      where: { id: { in: rentalItemIds } },
      select: { id: true, totalQuantity: true },
    })
    const totalQtyById = new Map(rentalItems.map((ri) => [ri.id, ri.totalQuantity]))

    // ── Step 3: Availability check for each booking inside the tx ────────────
    //
    // Re-aggregate booked quantity using the same overlap predicate as the
    // original createWalkInRental: open interval (from < to, to > from).
    // Check ALL bookings before writing ANY — ensures all-or-nothing semantics.
    for (const booking of bookings) {
      const totalQty = totalQtyById.get(booking.rentalItemId) ?? 0

      const bookedAgg = await tx.rentalBooking.aggregate({
        where: {
          rentalItemId: booking.rentalItemId,
          siteId: booking.siteId,
          operationalStatus: { notIn: nonBlockingOpStatuses as string[] },
          from: { lt: booking.to },
          to: { gt: booking.from },
        },
        _sum: { quantity: true },
      })

      const inUse = bookedAgg._sum?.quantity ?? 0
      if (booking.quantity + inUse > totalQty) {
        // Return early — nothing has been written yet, so this is a clean no-op.
        return { outcome: 'unavailable' as const, rentalItemId: booking.rentalItemId }
      }
    }

    // ── Step 4: All availability checks passed — create all bookings ──────────
    //
    // All-or-nothing: because we're inside $transaction, a failure on any create
    // rolls back every preceding create in this tx automatically.
    const createdIds: string[] = []
    for (const booking of bookings) {
      const created = await tx.rentalBooking.create({
        data: {
          siteId: booking.siteId,
          rentalItemId: booking.rentalItemId,
          userId: booking.userId,
          from: booking.from,
          to: booking.to,
          quantity: booking.quantity,
          durationType: booking.durationType,
          totalPrice: booking.totalPrice,
          paymentAmount: booking.paymentAmount,
          status: booking.status,
          operationalStatus: booking.operationalStatus,
          employeeId: booking.employeeId ?? null,
          pickedUpAt: booking.pickedUpAt ?? null,
          guestName: booking.guestName ?? null,
          anonId: booking.anonId ?? null,
          guestEmail: booking.guestEmail ?? null,
          guestContact: booking.guestContact ?? null,
        },
        select: { id: true },
      })
      createdIds.push(created.id)
    }

    return { outcome: 'created' as const, bookingIds: createdIds }
  })
}
