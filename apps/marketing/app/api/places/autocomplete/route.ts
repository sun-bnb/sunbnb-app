/**
 * GET /api/places/autocomplete?input=…&session=…&lang=…[&near=lat,lng]
 *
 * Proxies Google Places Autocomplete for the beach field. Public and ad-driven, so: validated
 * input, a per-IP rate limit, and a Places session token so a whole typing session plus the
 * final details lookup bills as ONE session instead of per keystroke.
 */
import type { NextRequest } from 'next/server'
import { allow } from '@/lib/limits.ts'
import { clientIp, isValidQuery, isValidSessionToken, localeOrDefault, parseNear } from '@/lib/places.ts'

export async function GET(request: NextRequest) {
  if (!(await allow('placesAutocomplete', clientIp(request.headers)))) return Response.json({ error: 'rate_limited' }, { status: 429 })

  const params = request.nextUrl.searchParams
  const input = params.get('input')
  const session = params.get('session')
  if (!isValidQuery(input)) return Response.json({ error: 'invalid_input' }, { status: 400 })
  if (!isValidSessionToken(session)) return Response.json({ error: 'invalid_session' }, { status: 400 })

  const url = new URL('https://maps.googleapis.com/maps/api/place/autocomplete/json')
  url.searchParams.set('input', input)
  url.searchParams.set('sessiontoken', session)
  url.searchParams.set('language', localeOrDefault(params.get('lang')))
  const near = parseNear(params.get('near'))
  if (near) {
    url.searchParams.set('location', `${near.lat},${near.lng}`)
    url.searchParams.set('radius', '8000')
  }
  url.searchParams.set('key', process.env.GOOGLE_MAPS_API_KEY ?? '')

  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) return Response.json({ error: 'upstream' }, { status: 502 })
  const data = (await res.json()) as {
    status: string
    predictions?: { place_id: string; structured_formatting?: { main_text?: string; secondary_text?: string }; description: string }[]
  }
  if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
    return Response.json({ error: 'upstream', status: data.status }, { status: 502 })
  }

  // Only what the field renders — the raw Google payload never reaches the browser.
  const suggestions = (data.predictions ?? []).slice(0, 6).map((p) => ({
    placeId: p.place_id,
    main: p.structured_formatting?.main_text ?? p.description,
    secondary: p.structured_formatting?.secondary_text ?? '',
  }))
  return Response.json({ suggestions })
}
