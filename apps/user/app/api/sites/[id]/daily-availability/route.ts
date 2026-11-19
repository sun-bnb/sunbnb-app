import { NextRequest } from 'next/server'
import { getDailyAvailability } from '@/service/availabilityService'
import { isValidEntityId } from '@/app/api/_lib/payment-ids'

/** The strip shows a week; the cap keeps the public endpoint's window bounded. */
const DEFAULT_DAYS = 7
const MAX_DAYS = 14

/**
 * Free-seat counts per venue civil day, starting today — the mobile booking
 * day strip. Intentionally public, like `/availability`: anonymous guests see
 * availability before they book.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!isValidEntityId(id)) {
    return Response.json({ error: 'Invalid ID format' }, { status: 400 })
  }

  const daysParam = request.nextUrl.searchParams.get('days')
  const days = daysParam === null ? DEFAULT_DAYS : Number(daysParam)
  if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) {
    return Response.json({ error: `days must be an integer between 1 and ${MAX_DAYS}` }, { status: 400 })
  }

  const availability = await getDailyAvailability(id, days)
  return Response.json({ siteId: id, days: availability })
}
