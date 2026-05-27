import { NextRequest, NextResponse } from 'next/server'
import { rateLimit } from '@repo/data/rate-limit'
import { getPublicRestaurantLayout } from '@repo/table-reservations-core'
import { isFlagEnabled } from '@/app/flags'

/**
 * Public floor layout for the consumer "pick your spot" map. Sanitized geometry
 * only (no staff notes / deposit amounts — see getPublicRestaurantLayout).
 * Rate-limited per IP. Returns 404 when guest selection is off for the venue, so
 * the map never renders unless the partner opted in.
 */
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  if (!(await isFlagEnabled('restaurants'))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  const limited = rateLimit(`restaurant-layout:${ip}`, { maxAttempts: 30, windowMs: 60 * 1000 })
  if (!limited.allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const layout = await getPublicRestaurantLayout(params.id)
  if (!layout || !layout.guestSelectionEnabled) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  return NextResponse.json(layout)
}
