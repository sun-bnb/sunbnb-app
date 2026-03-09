import logger from '@/utils/logger'

import prisma from '@repo/data/PrismaCient'
import { Metadata } from 'next'
import { auth } from '@/app/auth'
import SiteView from './view'

const { STRIPE_PUBLIC_KEY } = process.env

async function getSite(id: string, userId: string) {

  const includeReservations = !!userId

  const site = await prisma.site.findFirst({ 
    where: { id: id },
    include: {
      workingHours: true,
      inventoryItems: {
        where: {
          status: 'active'
        },
        include: {
          ...(includeReservations && {
            reservations: {
              where: { userId },
              orderBy: { from: 'desc' }
            }
          }),
          pair: true,
          pairedBy: true
        }
      }
    }
  })

  return site

}

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const site = await prisma.site.findFirst({
    where: { id: params.id },
    select: { name: true, description: true, image: true },
  })

  const title = site?.name || 'Sunbnb'
  const description = site?.description || ''
  const image = site?.image || undefined

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      ...(image && { images: [{ url: image }] }),
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      ...(image && { images: [image] }),
    },
  }
}

export default async function Site({ params }: { params: { id: string }}) {

  logger.debug('Site page params', params)
  
  const session = await auth()

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_CLIENT_KEY
    || process.env.GOOGLE_MAPS_API_KEY as string

  const appUrl = process.env.APP_URL as string

  const site = await getSite(params.id, session?.user?.id)
  if (!site) return <div>Site {params.id} not found</div>

  return (
    <div>
      <SiteView site={site} apiKey={apiKey} stripePublicKey={STRIPE_PUBLIC_KEY}/>
    </div>
  )

}