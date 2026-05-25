'use server'

import { revalidatePath } from 'next/cache'
import prisma from '@repo/data/PrismaCient'
import { processChargedTableDeposit } from '@repo/data/payment'
import { sendEmail } from '@repo/data/email'
import { requireRestaurantOwnerWithFlag } from '@/lib/auth-helpers'
import {
  listReservationsForDay,
  markSeated,
  markDeparted,
  markNoShow,
  cancelReservationAsStaff,
  modifyReservationAsStaff,
  chargeNoShowDeposit,
  refundDeposit,
  updateReservationInternalNotes,
  findWaitlistCandidateForFreedReservation,
  markWaitlistNotified,
  removeWaitlistEntryAsStaff,
  waitlistNotifyEmailHtml,
  DEPOSIT_STATUS,
  type TableReservationListItem,
  type WaitlistEntryRecord,
} from '@repo/table-reservations-core'
import { refundDepositPayment } from '@/app/api/_lib/mollie'
import { getRestaurantWaitlist } from '../queries'

type AuthOk = { ok: true; restaurantId: string; userId: string }
type AuthErr = { ok: false; error: string }

async function requireAuth(restaurantId: string): Promise<AuthOk | AuthErr> {
  const { session, error } = await requireRestaurantOwnerWithFlag(restaurantId, 'restaurants')
  if (error) return { ok: false, error }
  return { ok: true, restaurantId, userId: session!.user.id as string }
}

/**
 * Refund a HELD deposit (guest arrived / timely cancel). Best-effort: the
 * operational transition has already committed, so a refund failure must not
 * fail the action — we log it and leave the deposit HELD (status integrity:
 * never mark refunded unless the money actually moved). Demo refs are a no-op.
 */
async function refundHeldDeposit(reservationId: string): Promise<void> {
  try {
    const tr = await prisma.tableReservation.findUnique({
      where: { id: reservationId },
      select: {
        depositStatus: true,
        paymentRef: true,
        restaurant: { select: { partnerAccount: { select: { mollieAccessToken: true } } } },
      },
    })
    if (!tr || tr.depositStatus !== DEPOSIT_STATUS.HELD || !tr.paymentRef) return
    await refundDepositPayment(tr.paymentRef, tr.restaurant?.partnerAccount?.mollieAccessToken)
    await refundDeposit(reservationId)
  } catch (err) {
    console.error('[deposit] refund-on-arrival/cancel failed', err)
  }
}

/**
 * A staff cancel / no-show frees the table for its window — auto-notify the
 * earliest matching waitlist guest. Best-effort (mirrors the consumer-cancel
 * hook in apps/user); a send failure must not fail the operational transition.
 */
async function notifyWaitlistOnFreed(restaurantId: string, reservationId: string): Promise<void> {
  try {
    const candidate = await findWaitlistCandidateForFreedReservation(reservationId)
    if (!candidate) return
    const restaurant = await prisma.restaurant.findUnique({
      where: { id: restaurantId },
      select: { name: true, slug: true, tagline: true },
    })
    if (!restaurant) return
    await sendEmail({
      to: candidate.guestEmail,
      subject: `A table opened up at ${restaurant.name}`,
      html: waitlistNotifyEmailHtml(candidate, restaurant, null),
    })
    await markWaitlistNotified(candidate.id)
  } catch (err) {
    console.error('[waitlist] staff cancel/no-show auto-notify failed', err)
  }
}

export async function getRestaurantReservationsForDay(
  restaurantId: string,
  isoDate: string,
): Promise<{ status: 'ok'; reservations: TableReservationListItem[] } | { status: 'error'; errors: string[] }> {
  const r = await requireAuth(restaurantId)
  if (!r.ok) return { status: 'error', errors: [r.error] }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
    return { status: 'error', errors: ['Invalid date'] }
  }
  const reservations = await listReservationsForDay(r.restaurantId, isoDate)
  return { status: 'ok', reservations }
}

export async function markRestaurantReservationSeated(restaurantId: string, reservationId: string) {
  const r = await requireAuth(restaurantId)
  if (!r.ok) return { status: 'error' as const, errors: [r.error] }
  const res = await markSeated(reservationId, r.userId)
  if (res.status === 'ok') {
    await refundHeldDeposit(reservationId) // refund on arrival
    revalidatePath(`/restaurants/${restaurantId}/reservations`)
  }
  return res
}

export async function markRestaurantReservationDeparted(restaurantId: string, reservationId: string) {
  const r = await requireAuth(restaurantId)
  if (!r.ok) return { status: 'error' as const, errors: [r.error] }
  const res = await markDeparted(reservationId, r.userId)
  if (res.status === 'ok') revalidatePath(`/restaurants/${restaurantId}/reservations`)
  return res
}

export async function markRestaurantReservationNoShow(restaurantId: string, reservationId: string) {
  const r = await requireAuth(restaurantId)
  if (!r.ok) return { status: 'error' as const, errors: [r.error] }
  const res = await markNoShow(reservationId, r.userId)
  if (res.status === 'ok') {
    await notifyWaitlistOnFreed(restaurantId, reservationId) // freed table → notify waitlist
    revalidatePath(`/restaurants/${restaurantId}/reservations`)
  }
  return res
}

export async function cancelRestaurantReservation(restaurantId: string, reservationId: string) {
  const r = await requireAuth(restaurantId)
  if (!r.ok) return { status: 'error' as const, errors: [r.error] }
  const res = await cancelReservationAsStaff(reservationId, r.userId)
  if (res.status === 'ok') {
    await refundHeldDeposit(reservationId) // refund deposit on staff cancel
    await notifyWaitlistOnFreed(restaurantId, reservationId) // freed table → notify waitlist
    revalidatePath(`/restaurants/${restaurantId}/reservations`)
  }
  return res
}

export async function setRestaurantReservationNotes(
  restaurantId: string,
  reservationId: string,
  notes: string | null,
) {
  const r = await requireAuth(restaurantId)
  if (!r.ok) return { status: 'error' as const, errors: [r.error] }
  const res = await updateReservationInternalNotes(reservationId, notes, r.userId)
  if (res.status === 'ok') revalidatePath(`/restaurants/${restaurantId}/reservations`)
  return res
}

export async function modifyRestaurantReservation(
  restaurantId: string,
  reservationId: string,
  changes: { fromIso?: string; toIso?: string; partySize?: number; tableId?: string },
) {
  const r = await requireAuth(restaurantId)
  if (!r.ok) return { status: 'error' as const, errors: [r.error] }
  const res = await modifyReservationAsStaff(
    reservationId,
    {
      from: changes.fromIso ? new Date(changes.fromIso) : undefined,
      to: changes.toIso ? new Date(changes.toIso) : undefined,
      partySize: changes.partySize,
      tableId: changes.tableId,
    },
    r.userId,
  )
  if (res.status === 'ok') revalidatePath(`/restaurants/${restaurantId}/reservations`)
  return res
}

/**
 * Charge a held no-show deposit (operator action after marking no-show).
 * Flips the deposit HELD→CHARGED, then runs the @repo/data invoice + fee
 * cascade (PARTNER revenue − commission, PLATFORM commission). The cascade is
 * idempotent; we only invoke it once the deposit is actually CHARGED with a
 * positive amount, so charging a booking that had no deposit is a no-op.
 */
export async function chargeRestaurantReservationDeposit(
  restaurantId: string,
  reservationId: string,
) {
  const r = await requireAuth(restaurantId)
  if (!r.ok) return { status: 'error' as const, errors: [r.error] }

  const res = await chargeNoShowDeposit(reservationId, r.userId)
  if (res.status !== 'ok') return res

  const tr = await prisma.tableReservation.findUnique({
    where: { id: reservationId },
    select: { depositStatus: true, depositAmount: true },
  })
  if (tr?.depositStatus === DEPOSIT_STATUS.CHARGED && (tr.depositAmount ?? 0) > 0) {
    try {
      await processChargedTableDeposit(reservationId)
    } catch (err) {
      console.error('[deposit] charge cascade failed', err)
      return { status: 'error' as const, errors: ['Deposit charged but invoice generation failed'] }
    }
  }

  revalidatePath(`/restaurants/${restaurantId}/reservations`)
  return { status: 'ok' as const }
}

// ── Waitlist (staff) ─────────────────────────────────────────────────────────

export async function getRestaurantWaitlistForDay(
  restaurantId: string,
  isoDate: string,
): Promise<{ status: 'ok'; entries: WaitlistEntryRecord[] } | { status: 'error'; errors: string[] }> {
  const r = await requireAuth(restaurantId)
  if (!r.ok) return { status: 'error', errors: [r.error] }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
    return { status: 'error', errors: ['Invalid date'] }
  }
  const entries = await getRestaurantWaitlist(r.restaurantId, isoDate)
  return { status: 'ok', entries: entries ?? [] }
}

/** Remove a waitlist entry (staff cleared it / seated the guest elsewhere). */
export async function removeRestaurantWaitlistEntry(restaurantId: string, entryId: string) {
  const r = await requireAuth(restaurantId)
  if (!r.ok) return { status: 'error' as const, errors: [r.error] }
  const res = await removeWaitlistEntryAsStaff(entryId, r.userId)
  if (res.status === 'ok') revalidatePath(`/restaurants/${restaurantId}/reservations`)
  return res
}
