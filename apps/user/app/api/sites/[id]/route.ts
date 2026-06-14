/**
 * GET /api/sites/[id]
 *
 * Returns site details with inventory items. Reservations are only included
 * for the authenticated user to prevent leaking other users' booking data.
 */

import prisma from '@repo/data/PrismaCient'
import { NextRequest } from 'next/server'
import { auth } from '@/app/auth'
import { isValidEntityId } from '@/app/api/_lib/payment-ids'

export async function GET(request: NextRequest, { params } : { params: { id: string } }) {

  const { id } = params
  if (!isValidEntityId(id)) {
    return Response.json({ error: 'Invalid ID format' }, { status: 400 })
  }

  const session = await auth()
  const userId = session?.user?.id

  const site = await prisma.site.findUnique({
    where: { id },
    include: {
      workingHours: true,
      layoutElements: true,
      inventoryItems: {
        where: {
          status: 'active'
        },
        include: {
          // Only include reservations for the authenticated user
          ...(userId && {
            reservations: {
              where: { userId },
              orderBy: { from: 'desc' as const }
            }
          }),
          pair: true,
          pairedBy: true,
          sunbedGroup: {
            include: { items: { select: { id: true } } }
          }
        }
      },
      rentalItems: {
        where: { active: true },
        orderBy: { name: 'asc' }
      }
    }
  })
  
  return Response.json(site)

}