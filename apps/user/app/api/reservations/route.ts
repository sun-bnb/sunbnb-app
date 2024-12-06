import prisma from '@repo/data/PrismaCient'
import { Prisma } from '@prisma/client'

import { NextRequest } from 'next/server'
import { auth } from '@/app/auth'

export async function GET(request: NextRequest) {

  const session = await auth()
  if (!session?.user) return Response.json({ status: 'error', errors: [ 'Not authenticated' ] })
  

  const searchParams = request.nextUrl.searchParams
  const paymentRef = searchParams.get('paymentRef') as string

  if (!paymentRef) {
    return Response.json({ status: 'error', errors: [ 'Invalid search params' ] })
  }

  const reservation = await prisma.reservation.findMany({ where: { paymentRef } })
  console.log('RESERVATION', reservation)
  return Response.json(reservation)

}