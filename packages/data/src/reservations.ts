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
} from './reservation-status'

// ─── Types ──────────────────────────────────────────────────────────────────

/** The data needed to create a Reservation (without the items connect — that's separate). */
export type ReservationCreateData = Omit<
  Prisma.ReservationCreateInput,
  'items' | 'site' | 'user'
> & {
  /** Connect by id — use the already-expanded list (SunbedGroup + pair siblings). */
  itemIds: string[]
  siteId: string
  userId: string
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

// ─── Main helper ────────────────────────────────────────────────────────────

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

  const { itemIds, siteId, userId, ...reservationFields } = data

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
    const conflict = await tx.reservation.findFirst({
      where: {
        siteId,
        status: { in: blockingStatuses as string[] },
        operationalStatus: { notIn: nonBlockingOpStatuses as string[] },
        from: { lte: data.to as Date },
        to: { gte: data.from as Date },
        items: { some: { id: { in: itemIds } } },
      },
      select: { id: true },
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
        items: {
          connect: itemIds.map((id) => ({ id })),
        },
      },
      select: { id: true },
    })

    return { outcome: 'created' as const, reservationId: reservation.id }
  })
}
