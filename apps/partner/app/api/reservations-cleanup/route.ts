import prisma from '@repo/data/PrismaCient'
import { Prisma } from '@prisma/client'
import dayjs from 'dayjs'
import { NextRequest } from 'next/server'
import { auth } from '@/app/auth'
import {
  RESERVATION_PENDING,
  RESERVATION_PROCESSING,
  RESERVATION_PAYMENT_FAILED,
  RESERVATION_PAID_IN_CASH,
  RESERVATION_HELD,
  OP_WALKED_IN,
  OP_CHECKED_IN,
} from '@repo/data/reservation-status'

const CRON_SECRET = process.env.CRON_SECRET

export async function GET(request: Request) {

  if (!CRON_SECRET) {
    return Response.json({ error: 'CRON_SECRET not configured' }, { status: 503 })
  }

  // Require either a valid cron secret or an authenticated session
  const authHeader = request.headers.get('authorization')
  const hasCronAuth = authHeader === `Bearer ${CRON_SECRET}`

  if (!hasCronAuth) {
    const session = await auth()
    if (!session?.user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const cutoffPending = new Date(Date.now() - 15 * 60 * 1000)
  const cutoffPaymentFailed = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const cutoffPaidInCash = dayjs().startOf('day').toDate()
  const now = new Date()

  const result = await prisma.reservation.deleteMany({
    where: {
      OR: [
        {
          status: { in: [ RESERVATION_PENDING, RESERVATION_PROCESSING ] },
          createdAt: { lt: cutoffPending },
          // Never GC an occupied walk-in mid-collection: a QR collection flips an
          // already-seated walk-in (old createdAt) to PROCESSING, which would
          // otherwise be swept on the next run. Abandoned ONLINE checkouts are
          // operationalStatus 'expected' and still cleaned.
          operationalStatus: { notIn: [ OP_WALKED_IN, OP_CHECKED_IN ] },
        },
        {
          status: RESERVATION_PAYMENT_FAILED,
          createdAt: { lt: cutoffPaymentFailed }
        },
        {
          status: { in: [ RESERVATION_PAID_IN_CASH, RESERVATION_HELD ] },
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
