import logger from '@/utils/logger'

import prisma from '@repo/data/PrismaCient'
import { Metadata } from 'next'
import { auth } from '@/app/auth'
import SiteView from './view'
import ErrorCard from '@/components/ErrorCard'
import { countAvailableToday } from '@/service/availabilityService'

async function getSite(idOrSlug: string, userId: string) {

  const includeReservations = !!userId

  const site = await prisma.site.findFirst({
    where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
    include: {
      workingHours: true,
      inventoryItems: {
        where: {
          status: 'active'
        },
        // Track 020 P5s3: a tight SELECT instead of full rows. The consumer
        // app reads only geometry/grouping fields (audited: SunbedSelection +
        // SiteSunbedMarker + SchematicSelection + sunbed-preselection); the
        // full rows shipped image, partner-internal `notes`, price, userId and
        // timestamps for EVERY seat — ~4.3MB of RSC payload at 4 400 items.
        // Pair partners are id stubs: every consumer reads only `.id`.
        select: {
          id: true,
          number: true,
          seatLabel: true,
          locationLat: true,
          locationLng: true,
          schematicX: true,
          schematicY: true,
          rotation: true,
          label: true,
          status: true,
          category: true,
          group: true,
          sunbedGroupId: true,
          ...(includeReservations && {
            reservations: {
              where: { userId },
              orderBy: { from: 'desc' as const }
            }
          }),
          sunbedGroup: {
            select: { items: { select: { id: true } } }
          }
        }
      },
      rentalItems: {
        where: { active: true },
        orderBy: { name: 'asc' }
      }
    }
  })

  return site

}

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const site = await prisma.site.findFirst({
    where: { OR: [{ id: params.id }, { slug: params.id }] },
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
  if (!site) return <ErrorCard title="Beach not found" message={`We couldn't find the beach you're looking for.`} showHomeLink />

  // Compute today's canonical availability count server-side so the header has
  // a correct initial value before the client-side RTK Query resolves. Only
  // computed when the site has the sunbeds feature (schema default: ["sunbeds"]).
  const siteFeatures = site.features ?? ['sunbeds']
  const hasSunbeds = siteFeatures.includes('sunbeds')
  const initialAvailableCount = hasSunbeds
    ? (await countAvailableToday(site.id)).availableCount
    : undefined

  return (
    <div>
      <SiteView site={site} apiKey={apiKey} initialAvailableCount={initialAvailableCount} />
    </div>
  )

}