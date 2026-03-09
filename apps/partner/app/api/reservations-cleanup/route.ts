import prisma from '@repo/data/PrismaCient'
import { Prisma } from '@prisma/client'
import dayjs from 'dayjs'
import { NextRequest } from 'next/server'
import { auth } from '@/app/auth'

const CRON_SECRET = process.env.CRON_SECRET

export async function GET(request: Request) {

  // Require either a valid cron secret or an authenticated session
  const authHeader = request.headers.get('authorization')
  const hasCronAuth = CRON_SECRET && authHeader === `Bearer ${CRON_SECRET}`

  if (!hasCronAuth) {
    const session = await auth()
    if (!session?.user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const cutoffPending = new Date(Date.now() - 15 * 60 * 1000)
  const cutoffPaidInCash = dayjs().startOf('day').toDate()
  const now = new Date()

  const result = await prisma.reservation.deleteMany({
    where: {
      OR: [
        { 
          status: { in: [ 'pending', 'processing' ] },
          createdAt: { lt: cutoffPending }
        },
        { 
          status: { in: [ 'paid-in-cash' ] },
          createdAt: { 
            lt: cutoffPaidInCash,
          },
          to: { 
            lt: now,
          }
        }
      ]
    }
  })

  return Response.json({ deleted: result.count })

}
