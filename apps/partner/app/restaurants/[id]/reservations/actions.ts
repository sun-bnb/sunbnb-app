'use server'

import { revalidatePath } from 'next/cache'
import { requireRestaurantOwnerWithFlag } from '@/lib/auth-helpers'
import {
  listReservationsForDay,
  markSeated,
  markDeparted,
  markNoShow,
  cancelReservationAsStaff,
  updateReservationInternalNotes,
  type TableReservationListItem,
} from '@repo/table-reservations-core'

type AuthOk = { ok: true; restaurantId: string; userId: string }
type AuthErr = { ok: false; error: string }

async function requireAuth(restaurantId: string): Promise<AuthOk | AuthErr> {
  const { session, error } = await requireRestaurantOwnerWithFlag(restaurantId, 'restaurants')
  if (error) return { ok: false, error }
  return { ok: true, restaurantId, userId: session!.user.id as string }
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
  const date = new Date(`${isoDate}T00:00:00`)
  const reservations = await listReservationsForDay(r.restaurantId, date)
  return { status: 'ok', reservations }
}

export async function markRestaurantReservationSeated(restaurantId: string, reservationId: string) {
  const r = await requireAuth(restaurantId)
  if (!r.ok) return { status: 'error' as const, errors: [r.error] }
  const res = await markSeated(reservationId, r.userId)
  if (res.status === 'ok') revalidatePath(`/restaurants/${restaurantId}/reservations`)
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
  if (res.status === 'ok') revalidatePath(`/restaurants/${restaurantId}/reservations`)
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
