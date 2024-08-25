import { NextRequest } from "next/server"

export async function GET(request: NextRequest) {


  const apiKey = process.env.GOOGLE_MAPS_API_KEY as string
  console.log('PLACES HROUTER (AC) API KEY', apiKey)

  const searchParams = request.nextUrl.searchParams
  const input = searchParams.get('input')
  const res = await fetch(`https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${input}&key=${apiKey}`)
  const data = await res.json()
  return Response.json({ data })
}