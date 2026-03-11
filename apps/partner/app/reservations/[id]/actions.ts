'use server'

import { revalidatePath } from 'next/cache'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import {
  OP_EXPECTED,
  OP_CHECKED_IN,
  OP_WALKED_IN,
  OP_DEPARTED,
  OP_NO_SHOW,
  RESERVATION_CANCELED,
} from '@repo/data/reservation-status'

// ─── Auth helper ────────────────────────────────────────────

async function verifyOwnership(reservationId: string) {
  const session = await auth()
  if (!session?.user) return { error: 'Not authenticated' }
  const reservation = await prisma.reservation.findUnique({
    where: { id: reservationId },
    select: { id: true, siteId: true, status: true, operationalStatus: true, site: { select: { userId: true } } },
  })
  if (!reservation || reservation.site.userId !== session.user.id) {
    return { error: 'Not authorized' }
  }
  return { reservation }
}

function revalidate(reservationId: string) {
  revalidatePath(`/reservations/${reservationId}`)
  revalidatePath('/frontdesk')
}

// ─── Actions ────────────────────────────────────────────────

export async function checkInReservation(reservationId: string) {
  const result = await verifyOwnership(reservationId)
  if ('error' in result) return { status: 'error', errors: [result.error] }
  const { reservation } = result

  if (reservation.operationalStatus !== OP_EXPECTED) {
    return { status: 'error', errors: [`Cannot check in from status: ${reservation.operationalStatus}`] }
  }

  await prisma.reservation.update({
    where: { id: reservationId },
    data: { operationalStatus: OP_CHECKED_IN, checkedInAt: new Date() },
  })

  revalidate(reservationId)
  return { status: 'ok' }
}

export async function markDeparted(reservationId: string) {
  const result = await verifyOwnership(reservationId)
  if ('error' in result) return { status: 'error', errors: [result.error] }
  const { reservation } = result

  if (!([OP_CHECKED_IN, OP_WALKED_IN] as string[]).includes(reservation.operationalStatus)) {
    return { status: 'error', errors: [`Cannot mark departed from status: ${reservation.operationalStatus}`] }
  }

  await prisma.reservation.update({
    where: { id: reservationId },
    data: { operationalStatus: OP_DEPARTED, departedAt: new Date() },
  })

  revalidate(reservationId)
  return { status: 'ok' }
}

export async function markNoShow(reservationId: string) {
  const result = await verifyOwnership(reservationId)
  if ('error' in result) return { status: 'error', errors: [result.error] }
  const { reservation } = result

  if (reservation.operationalStatus !== OP_EXPECTED) {
    return { status: 'error', errors: [`Cannot mark no-show from status: ${reservation.operationalStatus}`] }
  }

  await prisma.reservation.update({
    where: { id: reservationId },
    data: { operationalStatus: OP_NO_SHOW },
  })

  revalidate(reservationId)
  return { status: 'ok' }
}

export async function cancelReservation(reservationId: string) {
  const result = await verifyOwnership(reservationId)
  if ('error' in result) return { status: 'error', errors: [result.error] }
  const { reservation } = result

  if (reservation.status === RESERVATION_CANCELED) {
    return { status: 'error', errors: ['Already canceled'] }
  }
  if (([OP_DEPARTED, OP_NO_SHOW] as string[]).includes(reservation.operationalStatus)) {
    return { status: 'error', errors: ['Cannot cancel a completed reservation'] }
  }

  await prisma.reservation.update({
    where: { id: reservationId },
    data: { status: RESERVATION_CANCELED },
  })

  try {
    const { sendCancellationEmail } = await import('@repo/data/reservation-emails')
    sendCancellationEmail(reservationId).catch(() => {})
  } catch {}

  revalidate(reservationId)
  return { status: 'ok' }
}

export async function updateNotes(reservationId: string, notes: string) {
  const result = await verifyOwnership(reservationId)
  if ('error' in result) return { status: 'error', errors: [result.error] }

  await prisma.reservation.update({
    where: { id: reservationId },
    data: { internalNotes: notes.slice(0, 500) || null },
  })

  revalidate(reservationId)
  return { status: 'ok' }
}
