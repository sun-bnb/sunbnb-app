import prisma from '@repo/data/PrismaCient'
import logger from '@/utils/logger'
import { auth } from '@/app/auth'
import { Metadata } from 'next'
import BrandedSiteView from './view'
import { resolveBrandRender } from '@repo/data/brand-manifest'
import BrandMount from '@/brands/BrandMount'
import { countAvailableToday } from '@/service/availabilityService'

async function getSiteBySlug(slug: string, userId?: string) {

  const includeReservations = !!userId

  const site = await prisma.site.findFirst({
    where: { slug },
    include: {
      brand: true,
      workingHours: true,
      inventoryItems: {
        where: { status: 'active' },
        include: {
          ...(includeReservations && {
            reservations: {
              where: { userId },
              orderBy: { from: 'desc' as const }
            }
          }),
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

  return site
}

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const site = await prisma.site.findFirst({
    where: { slug: params.slug },
    include: { brand: true },
  })

  const title = site?.brand?.brandName || site?.name || 'Book'
  const description = site?.brand?.tagline || site?.description || ''
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

export default async function BrandedSitePage({ params }: { params: { slug: string } }) {

  const session = await auth()

  const site = await getSiteBySlug(params.slug, session?.user?.id)
  if (!site) return <div className="flex items-center justify-center min-h-screen text-gray-500">Site not found</div>

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_CLIENT_KEY
    || process.env.GOOGLE_MAPS_API_KEY as string

  // Same server-side initial count as /sites/[id] — the header falls back to
  // this until the client-side availability query resolves.
  const siteFeatures = site.features ?? ['sunbeds']
  const initialAvailableCount = siteFeatures.includes('sunbeds')
    ? (await countAvailableToday(site.id)).availableCount
    : undefined

  // Track 023: a site with a bespoke module assigned AND the admin switch on
  // renders that instead. `resolveBrandRender` is the ONE answer to "what does a
  // guest see", shared with the partner brand tab and the admin fleet list.
  const render = resolveBrandRender(site)
  if (render.mode === 'custom' && render.key) {
    return (
      <BrandMount
        brandKey={render.key}
        site={site}
        apiKey={apiKey}
        initialAvailableCount={initialAvailableCount}
      />
    )
  }

  return (
    <BrandedSiteView
      site={site}
      brand={site.brand}
      apiKey={apiKey}
      initialAvailableCount={initialAvailableCount}
    />
  )
}
