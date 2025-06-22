import prisma from '@repo/data/PrismaCient'
import { Prisma } from '@prisma/client'
import dayjs from 'dayjs'
import { NextRequest } from 'next/server'
import { auth } from '@/app/auth'

export async function GET(request: Request) {

  const session = await auth()
  
  const cutoffPending = new Date(Date.now() - 15 * 60 * 1000)
  const cutoffPaidInCash = dayjs().startOf('day').toDate()

  const result = await prisma.reservation.deleteMany({
    where: {
      OR: [
        { 
          status: { in: [ 'pending', 'processing' ] },
          createdAt: { lt: cutoffPending }
        },
        { 
          status: { in: [ 'paid-in-cash' ] },
          createdAt: { lt: cutoffPaidInCash }
        }
      ],
    }
  })

  console.log('Deleted reservations older than 15 minutes:', result.count)

  return Response.json({ deleted: result.count })

}
