import { NextRequest } from 'next/server'
import { getAvailability } from '@/service/availabilityService'
import { isValidEntityId } from '@/app/api/_lib/payment-ids'

/** Max date range allowed (90 days) to prevent expensive queries. */
const MAX_RANGE_MS = 90 * 24 * 60 * 60 * 1000

export async function GET(request: NextRequest, { params } : { params: { id: string } }) {

  // Intentionally public — anonymous users need availability data before booking

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

  const availability = await getAvailability(id, from, to)
  const availabilityResponse = {
    siteId: id,
    from,
    to,
    availability
  }
  
  return Response.json(availabilityResponse)

}