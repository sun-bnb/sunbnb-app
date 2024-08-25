import { NextRequest } from 'next/server'
import { auth } from '@/app/auth'
import { getAvailability } from '@/service/availabilityService'

export async function GET(request: NextRequest, { params } : { params: { id: string } }) {

  const session = await auth()
  if (!session?.user) return Response.json({ status: 'error', errors: [ 'Not authenticated' ] })
  
  const searchParams = request.nextUrl.searchParams
  const fromParam = searchParams.get('from') as string
  const toParam = searchParams.get('to') as string
  
  const from = new Date(fromParam)
  const to = new Date(toParam)

  const availability = await getAvailability(params.id, from, to)
  const availabilityResponse = {
    siteId: params.id,
    from,
    to,
    availability
  }
  
  return Response.json(availabilityResponse)

}