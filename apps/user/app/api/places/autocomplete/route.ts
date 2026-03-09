/**
 * GET /api/places/autocomplete
 *
 * Proxies Google Places Autocomplete API. Input is validated and
 * length-limited to prevent abuse of the server-side API key.
 */

import { NextRequest } from "next/server"

const MAX_INPUT_LENGTH = 200

export async function GET(request: NextRequest) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY as string
  const searchParams = request.nextUrl.searchParams
  const input = searchParams.get('input')

  if (!input || input.trim().length === 0) {
    return Response.json({ error: 'input parameter is required' }, { status: 400 })
  }

  if (input.length > MAX_INPUT_LENGTH) {
    return Response.json({ error: 'input too long' }, { status: 400 })
  }

  // Use URL constructor to safely encode the parameter
  const url = new URL('https://maps.googleapis.com/maps/api/place/autocomplete/json')
  url.searchParams.set('input', input)
  url.searchParams.set('key', apiKey)

  const res = await fetch(url.toString())
  const data = await res.json()
  return Response.json({ data })
}