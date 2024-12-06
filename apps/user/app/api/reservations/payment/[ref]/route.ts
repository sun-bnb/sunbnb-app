
import prisma from '@repo/data/PrismaCient'
import { Prisma } from '@prisma/client'

import { NextRequest } from 'next/server'
import { auth } from '@/app/auth'

export async function GET(request: NextRequest, { params } : { params: { ref: string } }) {

  const session = await auth()
  if (!session?.user) return Response.json({ status: 'error', errors: [ 'Not authenticated' ] })
  
  const reservation = await prisma.reservation.findFirst({ where: { paymentRef: params.ref } })
  console.log('RESERVATION BY REF', reservation)
  return Response.json(reservation)

}