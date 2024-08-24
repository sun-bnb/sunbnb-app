import { NextRequest } from "next/server"
import prisma from '@repo/data/PrismaCient'
import { Prisma } from "@prisma/client"
import { auth } from '@/app/auth'

export async function GET(request: NextRequest) {

  const session = await auth()
  if (!session?.user) return Response.json({ status: 'error', errors: [ 'Not authenticated' ] })

  const searchParams = request.nextUrl.searchParams
  const lat = searchParams.get('lat')
  const lng = searchParams.get('lng')
  
  const results = await prisma.$queryRaw<any[]>(
    Prisma.sql`SELECT 
      id,
      name,
      description,
      image,
      location_lat,
      location_lng,
      ST_DistanceSphere(coords, ST_MakePoint(${lat}::double precision, ${lng}::double precision)) / 1000 AS dist_km
      FROM "Site"
      ORDER BY 
      dist_km 
      LIMIT 10`
  )

  const sites = results.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    image: r.image,
    locationLat: r.location_lat,
    locationLng: r.location_lng,
    distance: r.dist_km
  }))
  
  return Response.json({ sites })
}