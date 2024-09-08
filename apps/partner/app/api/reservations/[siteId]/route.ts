
import prisma from '@repo/data/PrismaCient'
import { Prisma } from '@prisma/client'
import dayjs from 'dayjs'
import { NextRequest } from 'next/server'
import { auth } from '@/app/auth'

export async function GET(request: NextRequest, { params } : { params: { siteId: string } }) {

  const session = await auth()
  if (!session?.user) return Response.json({ status: 'error', errors: [ 'Not authenticated' ] })
  
  const { searchParams } = new URL(request.url)
  const dateParam = searchParams.get('date') as string
  const monthParam = searchParams.get('month') as string

  if (!dateParam && !monthParam) {
    return Response.json({})
  }

  if (dateParam) {
    const date = new Date(dateParam)
    // Start of the day (00:00:00)
    const dayStart = dayjs(date).startOf('day').toDate();
    // End of the day (23:59:59.999)
    const dayEnd = dayjs(date).endOf('day').toDate();
    console.log('DATE', date, dayStart, dayEnd)

    const reservations = await prisma.reservation.findMany({ 
      where: { 
        siteId: params.siteId,
        status: { not: 'canceled' },
        AND: [
          { from: { lte: dayEnd } },
          { to: { gte: dayStart } }
        ]
      },
      include: {
        user: true,
        item: true
      }
    })

    console.log('RESERVATIONS', reservations)
    return Response.json({
      reservations
    })

  } else if (monthParam) {
    
    const monthStart = dayjs(`${monthParam}-01`).startOf('month').toDate();
    const monthEnd = dayjs(`${monthParam}-01`).endOf('month').toDate();

    console.log('MONTH', monthStart, monthEnd)

    const reservationsByDay = await prisma.$queryRaw<{ day: string, count: number }[]>`
      SELECT 
        day::date AS day, 
        COUNT(*)::int AS count
      FROM 
        "Reservation",
        GENERATE_SERIES(
          "from"::date, 
          "to"::date, 
          '1 day'
        ) AS day
      WHERE 
        "site_id" = ${params.siteId} AND
        "status" != 'canceled' AND
        "from" >= ${monthStart} AND
        "to" <= ${monthEnd}
      GROUP BY 
        day
      ORDER BY 
        day;
    `;

    const reservationsCountByDay = reservationsByDay.map((reservation: any) => ({
      date: dayjs(reservation.day).format('YYYY-MM-DD'),
      count: reservation.count,
    }));

    console.log('RES BY DAY', reservationsCountByDay);

    return Response.json({
      reservations: reservationsCountByDay
    })
  }

}