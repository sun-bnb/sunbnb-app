'use server'

import { revalidatePath } from 'next/cache'
import { requireSiteOwnerWithFlag } from '@/lib/auth-helpers'
import prisma from '@repo/data/PrismaCient'
import {
  listReservationsForDay,
  markSeated,
  markDeparted,
  markNoShow,
  cancelReservationAsStaff,
  updateReservationInternalNotes,
  type TableReservationListItem,
} from '@repo/table-reservations-core'

type LinkedOk = { ok: true; restaurantId: string; userId: string }
type LinkedErr = { ok: false; error: string }

async function requireLinkedRestaurant(siteId: string): Promise<LinkedOk | LinkedErr> {
  const { session, error } = await requireSiteOwnerWithFlag(siteId, 'restaurants')
  if (error) return { ok: false, error }

  const site = await prisma.site.findUnique({
    where: { id: siteId },
    select: { restaurantId: true },
  })
  if (!site?.restaurantId) return { ok: false, error: 'Site has no linked restaurant' }
  return { ok: true, restaurantId: site.restaurantId, userId: session!.user.id as string }
}

export async function getReservationsForDay(
  siteId: string,
  isoDate: string,
): Promise<{ status: 'ok'; reservations: TableReservationListItem[] } | { status: 'error'; errors: string[] }> {
  const r = await requireLinkedRestaurant(siteId)
  if (!r.ok) return { status: 'error', errors: [r.error] }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
    return { status: 'error', errors: ['Invalid date'] }
  }
  const date = new Date(`${isoDate}T00:00:00`)
  const reservations = await listReservationsForDay(r.restaurantId, date)
  return { status: 'ok', reservations }
}

export async function markReservationSeated(siteId: string, reservationId: string) {
  const r = await requireLinkedRestaurant(siteId)
  if (!r.ok) return { status: 'error' as const, errors: [r.error] }
  const res = await markSeated(reservationId, r.userId)
  if (res.status === 'ok') revalidatePath(`/sites/${siteId}/restaurant/reservations`)
  return res
}

export async function markReservationDeparted(siteId: string, reservationId: string) {
  const r = await requireLinkedRestaurant(siteId)
  if (!r.ok) return { status: 'error' as const, errors: [r.error] }
  const res = await markDeparted(reservationId, r.userId)
  if (res.status === 'ok') revalidatePath(`/sites/${siteId}/restaurant/reservations`)
  return res
}

export async function markReservationNoShow(siteId: string, reservationId: string) {
  const r = await requireLinkedRestaurant(siteId)
  if (!r.ok) return { status: 'error' as const, errors: [r.error] }
  const res = await markNoShow(reservationId, r.userId)
  if (res.status === 'ok') revalidatePath(`/sites/${siteId}/restaurant/reservations`)
  return res
}

export async function cancelReservationForSite(siteId: string, reservationId: string) {
  const r = await requireLinkedRestaurant(siteId)
  if (!r.ok) return { status: 'error' as const, errors: [r.error] }
  const res = await cancelReservationAsStaff(reservationId, r.userId)
  if (res.status === 'ok') revalidatePath(`/sites/${siteId}/restaurant/reservations`)
  return res
}

export async function setReservationInternalNotes(
  siteId: string,
  reservationId: string,
  notes: string | null,
) {
  const r = await requireLinkedRestaurant(siteId)
  if (!r.ok) return { status: 'error' as const, errors: [r.error] }
  const res = await updateReservationInternalNotes(reservationId, notes, r.userId)
  if (res.status === 'ok') revalidatePath(`/sites/${siteId}/restaurant/reservations`)
  return res
}
