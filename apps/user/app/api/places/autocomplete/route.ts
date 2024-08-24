import { NextRequest } from "next/server"

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const input = searchParams.get('input')
  const res = await fetch(`https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${input}&key=AIzaSyCbaCDvx-HUUuxyOYj3N3aUR1b_jntf1jc`)
  const data = await res.json()
  return Response.json({ data })
}