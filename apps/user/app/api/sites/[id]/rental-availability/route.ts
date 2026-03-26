import { NextRequest } from 'next/server'
import prisma from '@repo/data/PrismaCient'
import { isValidEntityId } from '@/app/api/_lib/stripe'
import { OP_RETURNED, RENTAL_CANCELED } from '@repo/data/reservation-status'

/** Max date range allowed (90 days) to prevent expensive queries. */
const MAX_RANGE_MS = 90 * 24 * 60 * 60 * 1000

/**
 * GET /api/sites/[id]/rental-availability?from=...&to=...
 *
 * Returns available quantities for each active rental item on the site,
 * considering all overlapping RentalBookings (hourly and daily).
 * Public endpoint — anonymous users need availability before booking.
 */
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const { id } = params
  if (!isValidEntityId(id)) {
    return Response.json({ error: 'Invalid ID format' }, { status: 400 })
  }

  const searchParams = request.nextUrl.searchParams
  const fromParam = searchParams.get('from')
  const toParam = searchParams.get('to')

  if (!fromParam || !toParam) {
    return Response.json({ error: 'from and to query parameters are required' }, { status: 400 })
  }

  const from = new Date(fromParam)
  const to = new Date(toParam)

  if (isNaN(from.getTime()) || isNaN(to.getTime())) {
    return Response.json({ error: 'Invalid date format' }, { status: 400 })
  }

  if (to <= from) {
    return Response.json({ error: 'to must be after from' }, { status: 400 })
  }

  if (to.getTime() - from.getTime() > MAX_RANGE_MS) {
    return Response.json({ error: 'Date range too large (max 90 days)' }, { status: 400 })
  }

  // Fetch all active rental items for this site
  const rentalItems = await prisma.rentalItem.findMany({
    where: { siteId: id, active: true },
    select: { id: true, totalQuantity: true },
  })

  // For each item, count how many are booked in the overlapping time window
  const availability = await Promise.all(
    rentalItems.map(async (item) => {
      const bookedQty = await prisma.rentalBooking.aggregate({
        where: {
          rentalItemId: item.id,
          siteId: id,
          operationalStatus: { notIn: [OP_RETURNED, RENTAL_CANCELED] },
          from: { lt: to },
          to: { gt: from },
        },
        _sum: { quantity: true },
      })

      const inUse = bookedQty._sum.quantity || 0
      return {
        rentalItemId: item.id,
        totalQuantity: item.totalQuantity,
        inUse,
        availableQuantity: Math.max(0, item.totalQuantity - inUse),
      }
    })
  )

  return Response.json({ siteId: id, from, to, availability })
}
