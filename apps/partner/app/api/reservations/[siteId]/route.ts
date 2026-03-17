
import prisma from '@repo/data/PrismaCient'
import { RESERVATION_CANCELED } from '@repo/data/reservation-status'
import dayjs from 'dayjs'
import { NextRequest } from 'next/server'
import { auth } from '@/app/auth'

export async function GET(request: NextRequest, { params } : { params: { siteId: string } }) {

  const session = await auth()
  if (!session?.user) return Response.json({ status: 'error', errors: [ 'Not authenticated' ] }, { status: 401 })

  // Verify the partner owns this site
  const site = await prisma.site.findUnique({
    where: { id: params.siteId },
    select: { userId: true },
  })
  if (!site || site.userId !== session.user.id) {
    return Response.json({ status: 'error', errors: ['Not authorized'] }, { status: 403 })
  }
  
  const { searchParams } = new URL(request.url)
  const dateParam = searchParams.get('date') as string
  const monthParam = searchParams.get('month') as string

  if (!dateParam && !monthParam) {
    return Response.json({})
  }

  if (dateParam) {
    if (isNaN(Date.parse(dateParam))) {
      return Response.json({ error: 'Invalid date format' }, { status: 400 })
    }
    const date = new Date(dateParam)
    // Start of the day (00:00:00)
    const dayStart = dayjs(date).startOf('day').toDate();
    // End of the day (23:59:59.999)
    const dayEnd = dayjs(date).endOf('day').toDate();

    const reservations = await prisma.reservation.findMany({ 
      where: { 
        siteId: params.siteId,
        status: { not: RESERVATION_CANCELED },
        AND: [
          { from: { lte: dayEnd } },
          { to: { gte: dayStart } }
        ]
      },
      include: {
        user: { select: { id: true, email: true } },
        items: true
      }
    })

    return Response.json({
      reservations
    })

  } else if (monthParam) {
    if (!/^\d{4}-\d{2}$/.test(monthParam)) {
      return Response.json({ error: 'Invalid month format (expected YYYY-MM)' }, { status: 400 })
    }
    const monthStart = dayjs(`${monthParam}-01`).startOf('month').toDate();
    const monthEnd = dayjs(`${monthParam}-01`).endOf('month').toDate();

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
        "status" != ${RESERVATION_CANCELED} AND
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

    return Response.json({
      reservations: reservationsCountByDay
    })
  }

}