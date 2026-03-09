import prisma from '@repo/data/PrismaCient'
import { auth } from '@/app/auth'
import { Metadata } from 'next'
import BrandedSiteView from './view'

const { STRIPE_PUBLIC_KEY } = process.env

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
          pair: true,
          pairedBy: true
        }
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

  const apiKey = process.env.GOOGLE_MAPS_API_KEY as string

  return (
    <BrandedSiteView
      site={site}
      brand={site.brand}
      apiKey={apiKey}
      stripePublicKey={STRIPE_PUBLIC_KEY}
    />
  )
}
