
import prisma from '@repo/data/PrismaCient'
import { Prisma } from '@prisma/client'
import { NextRequest } from 'next/server'
import { auth } from '@/app/auth'
import { getAvailability } from '@/service/availabilityService'
import { format } from 'path'

export async function GET(request: NextRequest, { params } : { params: { id: string } }) {

  const session = await auth()
  if (!session?.user) return Response.json({ status: 'error', errors: [ 'Not authenticated' ] })

  const site = await prisma.site.findUnique({ 
    where: { id: params.id },
    include: {
      inventoryItems: {
        include: {
          reservations: {
            orderBy: { from: 'desc' }
          }
        }
      }
    }
  })
  
  return Response.json(site)

}