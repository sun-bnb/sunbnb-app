/**
 * GET /api/places/details?placeId=…&session=…&lang=… → { name, address, lat, lng }
 *
 * The beach builder needs coordinates the moment a beach is picked — before any lead exists — so
 * the map can fly in and the sunbeds drop in live. Same guards as autocomplete (public, ad-driven):
 * validated params, per-IP rate limit, the Places session token that closes the autocomplete
 * session (one billable session per search), and a trimmed payload.
 */
import type { NextRequest } from 'next/server'
import { rateLimit } from '@repo/data/rate-limit'
import { fetchBeachPlace } from '@/lib/place-details.ts'
import { clientIp, isValidPlaceId, isValidSessionToken, localeOrDefault } from '@/lib/places.ts'

export async function GET(request: NextRequest) {
  if (!rateLimit(`places-details:${clientIp(request.headers)}`, { maxAttempts: 60, windowMs: 60_000 }).allowed) {
    return Response.json({ error: 'rate_limited' }, { status: 429 })
  }
  const params = request.nextUrl.searchParams
  const placeId = params.get('placeId')
  const session = params.get('session')
  if (!isValidPlaceId(placeId)) return Response.json({ error: 'invalid_place' }, { status: 400 })
  const place = await fetchBeachPlace(placeId, {
    session: isValidSessionToken(session) ? session : undefined,
    lang: localeOrDefault(params.get('lang')),
  })
  if (!place) return Response.json({ error: 'not_found' }, { status: 404 })
  return Response.json({ name: place.name, address: place.address, lat: place.lat, lng: place.lng })
}
