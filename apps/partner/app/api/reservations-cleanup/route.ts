import prisma from '@repo/data/PrismaCient'
import { Prisma } from '@prisma/client'
import dayjs from 'dayjs'
import { NextRequest } from 'next/server'
import { auth } from '@/app/auth'

export async function GET(request: Request) {

  const session = await auth()
  
  // delete any reservation still in "pending" created > 15 minutes ago:
  const cutoff = new Date(Date.now() - 15 * 60 * 1000)
  const result = await prisma.reservation.deleteMany({
    where: {
      status: { in: [ 'pending', 'processing' ] },
      createdAt: { lt: cutoff },
    },
  })

  console.log('Deleted reservations older than 15 minutes:', result.count)

  return Response.json({ deleted: result.count })

}
