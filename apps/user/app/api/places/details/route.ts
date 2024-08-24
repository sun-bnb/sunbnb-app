import { NextRequest } from "next/server"

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const placeId = searchParams.get('placeId')
  const res = await fetch(`https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&key=AIzaSyCbaCDvx-HUUuxyOYj3N3aUR1b_jntf1jc`)
  const data = await res.json()
  return Response.json({ data })
}