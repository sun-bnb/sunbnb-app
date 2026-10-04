import 'server-only'

export interface BeachPlace {
  placeId: string
  name: string
  address: string
  lat: number
  lng: number
}

/**
 * Server-side Places Details lookup, used by the /beach page (and the details proxy). Asks only
 * for the Basic fields we use, which keeps it in Google's cheapest Details tier. The session
 * token, when given, closes the autocomplete session so the whole search bills once.
 */
export async function fetchBeachPlace(placeId: string, opts: { session?: string; lang?: string } = {}): Promise<BeachPlace | null> {
  const url = new URL('https://maps.googleapis.com/maps/api/place/details/json')
  url.searchParams.set('place_id', placeId)
  url.searchParams.set('fields', 'place_id,name,formatted_address,geometry/location')
  if (opts.session) url.searchParams.set('sessiontoken', opts.session)
  if (opts.lang) url.searchParams.set('language', opts.lang)
  url.searchParams.set('key', process.env.GOOGLE_MAPS_API_KEY ?? '')

  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) return null
  const data = (await res.json()) as {
    status: string
    result?: { place_id: string; name: string; formatted_address?: string; geometry?: { location?: { lat: number; lng: number } } }
  }
  const r = data.result
  const loc = r?.geometry?.location
  if (data.status !== 'OK' || !r || !loc) return null
  return { placeId: r.place_id, name: r.name, address: r.formatted_address ?? '', lat: loc.lat, lng: loc.lng }
}
