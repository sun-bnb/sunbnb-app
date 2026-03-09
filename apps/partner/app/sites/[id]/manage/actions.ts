'use server'

import { revalidatePath } from 'next/cache'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import dayjs from 'dayjs'

// ─── Helpers ────────────────────────────────────────────────────────────────

async function verifySiteOwnership(siteId: string) {
  const session = await auth()
  if (!session?.user) return { error: 'Not authenticated' }
  const site = await prisma.site.findUnique({
    where: { id: siteId },
    select: { userId: true },
  })
  if (!site || site.userId !== session.user.id) return { error: 'Not authorized' }
  return { userId: session.user.id }
}

async function getPairItemId(itemId: string): Promise<string | null> {
  const item = await prisma.inventoryItem.findUnique({
    where: { id: itemId },
    include: { pairedBy: true },
  })
  if (!item) return null
  if (item.pairedBy) return item.pairedBy.id
  if (item.pairId) return item.pairId
  return null
}

// ─── Walk-in: Place a customer on an empty bed ──────────────────────────────

export async function reserveItem(
  siteId: string,
  itemId: string,
  guestName?: string,
  internalNotes?: string
) {
  const ownership = await verifySiteOwnership(siteId)
  if ('error' in ownership) return { status: 'error', errors: [ownership.error] }

  const itemIds = [{ id: itemId }]
  const pairId = await getPairItemId(itemId)
  if (pairId) itemIds.push({ id: pairId })

  await prisma.reservation.create({
    data: {
      userId: ownership.userId,
      type: 'days',
      from: dayjs().startOf('day').toDate(),
      to: dayjs().endOf('day').toDate(),
      siteId,
      status: 'paid-in-cash',
      operationalStatus: 'walked-in',
      checkedInAt: new Date(),
      guestName: guestName?.slice(0, 200) || null,
      internalNotes: internalNotes?.slice(0, 500) || null,
      items: { connect: itemIds },
    },
  })

  revalidatePath(`/sites/${siteId}/manage`)
  return { status: 'ok' }
}

// ─── Release bed: walk-in departs or no-show ────────────────────────────────

export async function unreserveItem(siteId: string, itemId: string) {
  const ownership = await verifySiteOwnership(siteId)
  if ('error' in ownership) return { status: 'error', errors: [ownership.error] }

  const todayStart = dayjs().startOf('day').toDate()
  const todayEnd = dayjs().endOf('day').toDate()

  // For walk-ins (paid-in-cash), delete them entirely (no invoice trail)
  await prisma.reservation.deleteMany({
    where: {
      siteId,
      status: 'paid-in-cash',
      operationalStatus: 'walked-in',
      from: { gte: todayStart },
      to: { lte: todayEnd },
      items: { some: { id: itemId } },
    },
  })

  revalidatePath(`/sites/${siteId}/manage`)
  return { status: 'ok' }
}

// ─── Check-in: customer arrived for their booking ───────────────────────────

export async function checkInReservation(siteId: string, reservationId: string) {
  const ownership = await verifySiteOwnership(siteId)
  if ('error' in ownership) return { status: 'error', errors: [ownership.error] }

  const reservation = await prisma.reservation.findUnique({
    where: { id: reservationId },
    select: { siteId: true, operationalStatus: true },
  })
  if (!reservation || reservation.siteId !== siteId) {
    return { status: 'error', errors: ['Reservation not found'] }
  }
  if (reservation.operationalStatus !== 'expected') {
    return { status: 'error', errors: [`Cannot check in from status: ${reservation.operationalStatus}`] }
  }

  await prisma.reservation.update({
    where: { id: reservationId },
    data: {
      operationalStatus: 'checked-in',
      checkedInAt: new Date(),
    },
  })

  revalidatePath(`/sites/${siteId}/manage`)
  return { status: 'ok' }
}

// ─── Mark departed: customer left ───────────────────────────────────────────

export async function markDeparted(siteId: string, reservationId: string) {
  const ownership = await verifySiteOwnership(siteId)
  if ('error' in ownership) return { status: 'error', errors: [ownership.error] }

  const reservation = await prisma.reservation.findUnique({
    where: { id: reservationId },
    select: { siteId: true, operationalStatus: true },
  })
  if (!reservation || reservation.siteId !== siteId) {
    return { status: 'error', errors: ['Reservation not found'] }
  }
  if (!['checked-in', 'walked-in'].includes(reservation.operationalStatus)) {
    return { status: 'error', errors: [`Cannot mark departed from: ${reservation.operationalStatus}`] }
  }

  await prisma.reservation.update({
    where: { id: reservationId },
    data: {
      operationalStatus: 'departed',
      departedAt: new Date(),
    },
  })

  revalidatePath(`/sites/${siteId}/manage`)
  return { status: 'ok' }
}

// ─── Mark no-show: customer didn't arrive ───────────────────────────────────

export async function markNoShow(siteId: string, reservationId: string) {
  const ownership = await verifySiteOwnership(siteId)
  if ('error' in ownership) return { status: 'error', errors: [ownership.error] }

  const reservation = await prisma.reservation.findUnique({
    where: { id: reservationId },
    select: { siteId: true, operationalStatus: true },
  })
  if (!reservation || reservation.siteId !== siteId) {
    return { status: 'error', errors: ['Reservation not found'] }
  }
  if (reservation.operationalStatus !== 'expected') {
    return { status: 'error', errors: [`Cannot mark no-show from: ${reservation.operationalStatus}`] }
  }

  await prisma.reservation.update({
    where: { id: reservationId },
    data: { operationalStatus: 'no-show' },
  })

  revalidatePath(`/sites/${siteId}/manage`)
  return { status: 'ok' }
}

// ─── Update internal notes ──────────────────────────────────────────────────

export async function updateReservationNotes(
  siteId: string,
  reservationId: string,
  notes: string
) {
  const ownership = await verifySiteOwnership(siteId)
  if ('error' in ownership) return { status: 'error', errors: [ownership.error] }

  const reservation = await prisma.reservation.findUnique({
    where: { id: reservationId },
    select: { siteId: true },
  })
  if (!reservation || reservation.siteId !== siteId) {
    return { status: 'error', errors: ['Reservation not found'] }
  }

  await prisma.reservation.update({
    where: { id: reservationId },
    data: { internalNotes: notes.slice(0, 500) || null },
  })

  revalidatePath(`/sites/${siteId}/manage`)
  return { status: 'ok' }
}

// ─── Move reservation to different beds ─────────────────────────────────────

export async function moveReservation(
  siteId: string,
  reservationId: string,
  newItemIds: string[]
) {
  const ownership = await verifySiteOwnership(siteId)
  if ('error' in ownership) return { status: 'error', errors: [ownership.error] }

  const reservation = await prisma.reservation.findUnique({
    where: { id: reservationId },
    include: { items: true },
  })
  if (!reservation || reservation.siteId !== siteId) {
    return { status: 'error', errors: ['Reservation not found'] }
  }
  if (['no-show', 'departed'].includes(reservation.operationalStatus)) {
    return { status: 'error', errors: ['Cannot move a completed reservation'] }
  }

  // Verify new items belong to this site and are active
  const newItems = await prisma.inventoryItem.findMany({
    where: { id: { in: newItemIds }, siteId, status: 'active' },
  })
  if (newItems.length !== newItemIds.length) {
    return { status: 'error', errors: ['Some items not found or inactive'] }
  }

  // Disconnect old items, connect new ones
  await prisma.reservation.update({
    where: { id: reservationId },
    data: {
      items: {
        disconnect: reservation.items.map(i => ({ id: i.id })),
        connect: newItemIds.map(id => ({ id })),
      },
    },
  })

  revalidatePath(`/sites/${siteId}/manage`)
  return { status: 'ok' }
}

// ─── Block bed (maintenance / VIP hold) ─────────────────────────────────────

export async function blockBed(
  siteId: string,
  itemId: string,
  notes?: string
) {
  const ownership = await verifySiteOwnership(siteId)
  if ('error' in ownership) return { status: 'error', errors: [ownership.error] }

  const itemIds = [{ id: itemId }]
  const pairId = await getPairItemId(itemId)
  if (pairId) itemIds.push({ id: pairId })

  await prisma.reservation.create({
    data: {
      userId: ownership.userId,
      type: 'days',
      from: dayjs().startOf('day').toDate(),
      to: dayjs().endOf('day').toDate(),
      siteId,
      status: 'paid-in-cash',
      operationalStatus: 'blocked',
      internalNotes: notes?.slice(0, 500) || null,
      items: { connect: itemIds },
    },
  })

  revalidatePath(`/sites/${siteId}/manage`)
  return { status: 'ok' }
}

// ─── Unblock bed ────────────────────────────────────────────────────────────

export async function unblockBed(siteId: string, itemId: string) {
  const ownership = await verifySiteOwnership(siteId)
  if ('error' in ownership) return { status: 'error', errors: [ownership.error] }

  const todayStart = dayjs().startOf('day').toDate()
  const todayEnd = dayjs().endOf('day').toDate()

  await prisma.reservation.deleteMany({
    where: {
      siteId,
      operationalStatus: 'blocked',
      from: { gte: todayStart },
      to: { lte: todayEnd },
      items: { some: { id: itemId } },
    },
  })

  revalidatePath(`/sites/${siteId}/manage`)
  return { status: 'ok' }
}