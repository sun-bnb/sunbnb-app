import { NextRequest } from "next/server"

export async function GET(request: NextRequest) {
  
  const apiKey = process.env.GOOGLE_MAPS_API_KEY as string
  console.log('PLACES HROUTER (D) API KEY', apiKey)

  const searchParams = request.nextUrl.searchParams
  const placeId = searchParams.get('placeId')
  const res = await fetch(`https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&key=${apiKey}`)
  const data = await res.json()
  return Response.json({ data })
}