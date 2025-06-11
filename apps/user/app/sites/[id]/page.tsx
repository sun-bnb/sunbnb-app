import logger from '@/utils/logger'

import prisma from '@repo/data/PrismaCient'
import { auth } from '@/app/auth'
import SiteView from './view'

const { STRIPE_PUBLIC_KEY } = process.env

async function getSite(id: string, userId: string) {
  const site = await prisma.site.findFirst({ 
    where: { id: id },
    include: {
      workingHours: true,
      inventoryItems: {
        where: {
          status: 'active'
        },
        include: {
          reservations: {
            where: {
              userId: userId
            },
            orderBy: { from: 'desc' }
          },
          pair: true,
          pairedBy: true
        }
      }
    }
  })

  return site

}

export default async function Site({ params }: { params: { id: string }}) {

  logger.debug('Site page params', params)
  
  const session = await auth()
  if (!session?.user) return null

  const apiKey = process.env.GOOGLE_MAPS_API_KEY as string

  const appUrl = process.env.APP_URL as string

  const site = await getSite(params.id, session.user.id)
  if (!site) return <div>Site {params.id} not found</div>

  return (
    <div className="container mx-auto lg:px-4">
      <SiteView site={site} apiKey={apiKey} stripePublicKey={STRIPE_PUBLIC_KEY}/>
    </div>
  )

}