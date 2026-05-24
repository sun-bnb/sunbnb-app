'use server'

import { revalidatePath } from 'next/cache'
import prisma from '@repo/data/PrismaCient'
import { processChargedTableDeposit } from '@repo/data/payment'
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
  DEPOSIT_STATUS,
  type TableReservationListItem,
} from '@repo/table-reservations-core'
import { refundDepositPayment } from '@/app/api/_lib/mollie'

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
  if (res.status === 'ok') revalidatePath(`/restaurants/${restaurantId}/reservations`)
  return res
}

export async function cancelRestaurantReservation(restaurantId: string, reservationId: string) {
  const r = await requireAuth(restaurantId)
  if (!r.ok) return { status: 'error' as const, errors: [r.error] }
  const res = await cancelReservationAsStaff(reservationId, r.userId)
  if (res.status === 'ok') {
    await refundHeldDeposit(reservationId) // refund deposit on staff cancel
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
