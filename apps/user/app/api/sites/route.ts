import { NextRequest } from 'next/server'
import { auth } from '@/app/auth'
import { searchSites } from '@/service/siteService'

export async function GET(request: NextRequest) {

  const session = await auth()
  if (!session?.user) return Response.json({ status: 'error', errors: [ 'Not authenticated' ] })

  const searchParams = request.nextUrl.searchParams
  const lat = searchParams.get('lat') as string
  const lng = searchParams.get('lng') as string
  
  const sitesResponse = await searchSites(lat, lng)
  
  return Response.json(sitesResponse)

}