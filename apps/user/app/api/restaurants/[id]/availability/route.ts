import { NextRequest, NextResponse } from 'next/server'
import { rateLimit } from '@repo/data/rate-limit'
import { getRestaurantAvailability } from '@repo/table-reservations-core'
import { isFlagEnabled } from '@/app/flags'

/**
 * Public availability endpoint. Rate-limited per IP — 30 requests / minute
 * covers a typical user clicking through multiple dates without letting
 * scripts scrape the calendar.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  if (!(await isFlagEnabled('restaurants'))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  const limited = rateLimit(`restaurant-availability:${ip}`, {
    maxAttempts: 30,
    windowMs: 60 * 1000,
  })
  if (!limited.allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const url = new URL(request.url)
  const dateStr = url.searchParams.get('date')
  const partySizeStr = url.searchParams.get('partySize')

  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return NextResponse.json({ error: 'Invalid date' }, { status: 400 })
  }
  const partySize = Number(partySizeStr)
  if (!Number.isInteger(partySize) || partySize < 1 || partySize > 50) {
    return NextResponse.json({ error: 'Invalid party size' }, { status: 400 })
  }
  // Interpret the date as local midnight in the server's timezone. Good
  // enough for single-timezone venues; multi-tz support is a post-MVP item.
  const date = new Date(`${dateStr}T00:00:00`)
  if (Number.isNaN(date.getTime())) {
    return NextResponse.json({ error: 'Invalid date' }, { status: 400 })
  }

  const result = await getRestaurantAvailability({
    restaurantId: params.id,
    date,
    partySize,
  })

  return NextResponse.json({
    slots: result.slots.map((s) => ({
      from: s.from.toISOString(),
      to: s.to.toISOString(),
      availableTableIds: s.availableTableIds,
    })),
    mealDurationMinutes: result.mealDurationMinutes,
  })
}
