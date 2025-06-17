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