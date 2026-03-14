import { NextRequest } from 'next/server'
import { searchSites } from '@/service/siteService'

export async function GET(request: NextRequest) {

  const searchParams = request.nextUrl.searchParams
  const lat = searchParams.get('lat') as string
  const lng = searchParams.get('lng') as string
  
  const sitesResponse = await searchSites(lat, lng)
  
  return Response.json(sitesResponse)

}