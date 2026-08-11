'use server'

import { revalidatePath } from 'next/cache'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import { applyTransition } from '@repo/data/reservation-machine-apply'
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

// MIGRATED onto the state machine (track 018 P4 slice 2 — the D14/D15 fossil
// fix): these formerly wrote parent columns only (no ReservationDay row, no
// venue TZ, terminal-only depart). They now name table events; guards, day-row
// atomicity, and the multiday daily cycle execute from the machine.

function stateLabel(r: Awaited<ReturnType<typeof applyTransition>>): string {
  return r.outcome === 'rejected' ? `${r.state.kind}\u00b7${r.state.pay}\u00b7${r.state.occ}` : r.outcome
}

export async function checkInReservation(reservationId: string) {
  const result = await verifyOwnership(reservationId)
  if ('error' in result) return { status: 'error', errors: [result.error] }

  const r = await applyTransition(reservationId, 'staff.checkIn')
  if (r.outcome !== 'applied') {
    return { status: 'error', errors: [`Cannot check in from status: ${stateLabel(r)}`] }
  }
  revalidate(reservationId)
  return { status: 'ok' }
}

export async function markDeparted(reservationId: string) {
  const result = await verifyOwnership(reservationId)
  if ('error' in result) return { status: 'error', errors: [result.error] }

  // The machine branches multiday (cycle to expected) vs last-day (departed) —
  // the fossil's unconditionally-terminal depart is gone.
  const r = await applyTransition(reservationId, 'staff.depart')
  if (r.outcome !== 'applied') {
    return { status: 'error', errors: [`Cannot mark departed from status: ${stateLabel(r)}`] }
  }
  revalidate(reservationId)
  return { status: 'ok' }
}

export async function markNoShow(reservationId: string) {
  const result = await verifyOwnership(reservationId)
  if ('error' in result) return { status: 'error', errors: [result.error] }

  const r = await applyTransition(reservationId, 'staff.noShow')
  if (r.outcome !== 'applied') {
    return { status: 'error', errors: [`Cannot mark no-show from status: ${stateLabel(r)}`] }
  }
  revalidate(reservationId)
  return { status: 'ok' }
}

export async function cancelReservation(reservationId: string) {
  const result = await verifyOwnership(reservationId)
  if ('error' in result) return { status: 'error', errors: [result.error] }

  // partner.cancel: online-complete only (terminal reads refundedAt); cash
  // walk-ins are released via manage Unreserve — the machine rejects them here.
  const r = await applyTransition(reservationId, 'partner.cancel')
  if (r.outcome !== 'applied') {
    return { status: 'error', errors: [`Cannot cancel from status: ${stateLabel(r)}`] }
  }

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
