/**
 * GET /api/places/details
 *
 * Proxies Google Places Details API. placeId is validated against
 * the expected format before forwarding to prevent parameter injection.
 */

import { NextRequest } from "next/server"

/** Google Place IDs are alphanumeric with underscores/dashes, typically < 300 chars. */
const PLACE_ID_PATTERN = /^[A-Za-z0-9_-]{1,300}$/

export async function GET(request: NextRequest) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY as string
  const searchParams = request.nextUrl.searchParams
  const placeId = searchParams.get('placeId')

  if (!placeId) {
    return Response.json({ error: 'placeId parameter is required' }, { status: 400 })
  }

  if (!PLACE_ID_PATTERN.test(placeId)) {
    return Response.json({ error: 'Invalid placeId format' }, { status: 400 })
  }

  // Use URL constructor to safely encode the parameter
  const url = new URL('https://maps.googleapis.com/maps/api/place/details/json')
  url.searchParams.set('place_id', placeId)
  url.searchParams.set('key', apiKey)

  const res = await fetch(url.toString())
  const data = await res.json()
  return Response.json({ data })
}