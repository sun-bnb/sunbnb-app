'use server';

import logger from '@/utils/logger'

import { auth } from '@/app/auth'
import { Reservation, ServiceFee } from '@prisma/client'
import prisma from '@repo/data/PrismaCient'

async function ensureAuthenticatedUser() {
  const session = await auth();
  if (!session?.user) {
    throw new Error('Not authenticated')
  }
  return session
}

export async function fetchReservation(id: string) {
  const reservation = await prisma.reservation.findUnique({
    where: { id },
    include: { 
      items: true,
      site: true 
    }
  });
  if (!reservation) {
    throw new Error(`Reservation not found for id: ${id}`)
  }
  return reservation
}

export async function updateReservation({
  id,
  status,
}: {
  id: string;
  status: string;
}) {
  try {

    const session = await ensureAuthenticatedUser()

    let savedReservation = await fetchReservation(id)

    logger.debug('updateReservation:', savedReservation)

    if (savedReservation.status === 'paid') {
      return { status: 'ok', id }
    }

    await prisma.reservation.update({
      where: { id },
      data: { status },
    });

    return { status: 'ok', id }
  
  } catch (error: any) {
    logger.error('updateReservation error:', error)
    return { status: 'error', errors: [error.message] }
  }

}
