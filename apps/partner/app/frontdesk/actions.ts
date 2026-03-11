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
  OP_RESERVED,
  OP_PICKED_UP,
  OP_RETURNED,
  RESERVATION_CANCELED,
  RENTAL_CANCELED,
} from '@repo/data/reservation-status'
import type { SunbedReservation, RentalBooking } from './view'

// ─── Search action ──────────────────────────────────────────────────────────

export async function searchAllReservations(query: string): Promise<{
  sunbedReservations: SunbedReservation[]
  rentalBookings: RentalBooking[]
}> {
  const session = await auth()
  if (!session?.user) return { sunbedReservations: [], rentalBookings: [] }

  const userId = session.user.id
  const siteIds = (await prisma.site.findMany({
    where: { userId },
    select: { id: true },
  })).map(s => s.id)

  if (siteIds.length === 0) return { sunbedReservations: [], rentalBookings: [] }

  const q = query.trim()
  if (!q) return { sunbedReservations: [], rentalBookings: [] }

  const likeQ = `%${q}%`

  const [sunbedRaw, rentalRaw] = await Promise.all([
    prisma.reservation.findMany({
      where: {
        siteId: { in: siteIds },
        status: { not: RESERVATION_CANCELED },
        OR: [
          { guestName: { contains: q, mode: 'insensitive' } },
          { guestContact: { contains: q, mode: 'insensitive' } },
          { user: { email: { contains: q, mode: 'insensitive' } } },
          { id: { contains: q, mode: 'insensitive' } },
        ],
      },
      orderBy: { from: 'desc' },
      take: 30,
      select: {
        id: true, from: true, to: true, type: true, status: true,
        operationalStatus: true, guestName: true, guestContact: true,
        internalNotes: true, checkedInAt: true, departedAt: true,
        site: { select: { id: true, name: true } },
        user: { select: { email: true } },
        _count: { select: { items: true } },
      },
    }),

    prisma.rentalBooking.findMany({
      where: {
        siteId: { in: siteIds },
        status: { not: RENTAL_CANCELED },
        OR: [
          { guestName: { contains: q, mode: 'insensitive' } },
          { user: { email: { contains: q, mode: 'insensitive' } } },
          { id: { contains: q, mode: 'insensitive' } },
        ],
      },
      orderBy: { from: 'desc' },
      take: 30,
      select: {
        id: true, from: true, to: true, quantity: true, durationType: true,
        totalPrice: true, status: true, operationalStatus: true, guestName: true,
        pickedUpAt: true, returnedAt: true,
        rentalItem: { select: { id: true, name: true, category: true } },
        site: { select: { id: true, name: true } },
        user: { select: { email: true } },
      },
    }),
  ])

  return {
    sunbedReservations: sunbedRaw.map(r => ({
      id: r.id,
      from: r.from.toISOString(),
      to: r.to.toISOString(),
      type: 'sunbed' as const,
      status: r.status,
      operationalStatus: r.operationalStatus,
      guestName: r.guestName,
      guestContact: r.guestContact,
      guestEmail: r.user.email,
      internalNotes: r.internalNotes,
      checkedInAt: r.checkedInAt?.toISOString() ?? null,
      departedAt: r.departedAt?.toISOString() ?? null,
      siteName: r.site.name ?? 'Unnamed site',
      siteId: r.site.id,
      itemCount: r._count.items,
    })),
    rentalBookings: rentalRaw.map(r => ({
      id: r.id,
      from: r.from.toISOString(),
      to: r.to.toISOString(),
      type: 'rental' as const,
      status: r.status,
      operationalStatus: r.operationalStatus,
      guestName: r.guestName,
      guestEmail: r.user.email,
      siteName: r.site.name ?? 'Unnamed site',
      siteId: r.site.id,
      rentalItemName: r.rentalItem.name,
      quantity: r.quantity,
      totalPrice: r.totalPrice,
      pickedUpAt: r.pickedUpAt?.toISOString() ?? null,
      returnedAt: r.returnedAt?.toISOString() ?? null,
    })),
  }
}

// ─── Auth helper ────────────────────────────────────────────────────────────

async function verifyReservationOwnership(reservationId: string) {
  const session = await auth()
  if (!session?.user) return { error: 'Not authenticated' }
  const reservation = await prisma.reservation.findUnique({
    where: { id: reservationId },
    select: { siteId: true, operationalStatus: true, site: { select: { userId: true } } },
  })
  if (!reservation || reservation.site.userId !== session.user.id) {
    return { error: 'Not authorized' }
  }
  return { reservation }
}

async function verifyRentalOwnership(bookingId: string) {
  const session = await auth()
  if (!session?.user) return { error: 'Not authenticated' }
  const booking = await prisma.rentalBooking.findUnique({
    where: { id: bookingId },
    select: { siteId: true, operationalStatus: true, site: { select: { userId: true } } },
  })
  if (!booking || booking.site.userId !== session.user.id) {
    return { error: 'Not authorized' }
  }
  return { booking }
}

function revalidate() {
  revalidatePath('/frontdesk')
}

// ═══════════════════════════════════════════════════════════════════════════
// SUNBED RESERVATION ACTIONS
// ═══════════════════════════════════════════════════════════════════════════

export async function checkInReservation(reservationId: string) {
  const result = await verifyReservationOwnership(reservationId)
  if ('error' in result) return { status: 'error', errors: [result.error] }
  const { reservation } = result

  if (reservation.operationalStatus !== OP_EXPECTED) {
    return { status: 'error', errors: [`Cannot check in from: ${reservation.operationalStatus}`] }
  }

  await prisma.reservation.update({
    where: { id: reservationId },
    data: { operationalStatus: OP_CHECKED_IN, checkedInAt: new Date() },
  })

  revalidate()
  return { status: 'ok' }
}

export async function markDeparted(reservationId: string) {
  const result = await verifyReservationOwnership(reservationId)
  if ('error' in result) return { status: 'error', errors: [result.error] }
  const { reservation } = result

  if (!([OP_CHECKED_IN, OP_WALKED_IN] as string[]).includes(reservation.operationalStatus)) {
    return { status: 'error', errors: [`Cannot mark departed from: ${reservation.operationalStatus}`] }
  }

  await prisma.reservation.update({
    where: { id: reservationId },
    data: { operationalStatus: OP_DEPARTED, departedAt: new Date() },
  })

  revalidate()
  return { status: 'ok' }
}

export async function markNoShow(reservationId: string) {
  const result = await verifyReservationOwnership(reservationId)
  if ('error' in result) return { status: 'error', errors: [result.error] }
  const { reservation } = result

  if (reservation.operationalStatus !== OP_EXPECTED) {
    return { status: 'error', errors: [`Cannot mark no-show from: ${reservation.operationalStatus}`] }
  }

  await prisma.reservation.update({
    where: { id: reservationId },
    data: { operationalStatus: OP_NO_SHOW },
  })

  revalidate()
  return { status: 'ok' }
}

export async function cancelReservation(reservationId: string) {
  const result = await verifyReservationOwnership(reservationId)
  if ('error' in result) return { status: 'error', errors: [result.error] }
  const { reservation } = result

  if (([OP_DEPARTED, OP_NO_SHOW] as string[]).includes(reservation.operationalStatus)) {
    return { status: 'error', errors: ['Cannot cancel a completed reservation'] }
  }

  await prisma.reservation.update({
    where: { id: reservationId },
    data: { status: RESERVATION_CANCELED },
  })

  // Send cancellation email (non-blocking)
  try {
    const { sendCancellationEmail } = await import('@repo/data/reservation-emails')
    sendCancellationEmail(reservationId).catch(() => {})
  } catch {}

  revalidate()
  return { status: 'ok' }
}

export async function updateNotes(reservationId: string, notes: string) {
  const result = await verifyReservationOwnership(reservationId)
  if ('error' in result) return { status: 'error', errors: [result.error] }

  await prisma.reservation.update({
    where: { id: reservationId },
    data: { internalNotes: notes.slice(0, 500) || null },
  })

  revalidate()
  return { status: 'ok' }
}

// ═══════════════════════════════════════════════════════════════════════════
// RENTAL BOOKING ACTIONS
// ═══════════════════════════════════════════════════════════════════════════

export async function markRentalPickedUp(bookingId: string) {
  const result = await verifyRentalOwnership(bookingId)
  if ('error' in result) return { status: 'error', errors: [result.error] }
  const { booking } = result

  if (booking.operationalStatus !== OP_RESERVED) {
    return { status: 'error', errors: [`Cannot pick up from: ${booking.operationalStatus}`] }
  }

  await prisma.rentalBooking.update({
    where: { id: bookingId },
    data: { operationalStatus: OP_PICKED_UP, pickedUpAt: new Date() },
  })

  revalidate()
  return { status: 'ok' }
}

export async function markRentalReturned(bookingId: string) {
  const result = await verifyRentalOwnership(bookingId)
  if ('error' in result) return { status: 'error', errors: [result.error] }
  const { booking } = result

  if (booking.operationalStatus !== OP_PICKED_UP) {
    return { status: 'error', errors: [`Cannot return from: ${booking.operationalStatus}`] }
  }

  await prisma.rentalBooking.update({
    where: { id: bookingId },
    data: { operationalStatus: OP_RETURNED, returnedAt: new Date() },
  })

  revalidate()
  return { status: 'ok' }
}

export async function cancelRentalBooking(bookingId: string) {
  const result = await verifyRentalOwnership(bookingId)
  if ('error' in result) return { status: 'error', errors: [result.error] }
  const { booking } = result

  if (([OP_RETURNED] as string[]).includes(booking.operationalStatus)) {
    return { status: 'error', errors: ['Cannot cancel a returned rental'] }
  }

  await prisma.rentalBooking.update({
    where: { id: bookingId },
    data: { status: RENTAL_CANCELED },
  })

  revalidate()
  return { status: 'ok' }
}
