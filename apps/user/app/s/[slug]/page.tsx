import prisma from '@repo/data/PrismaCient'
import { auth } from '@/app/auth'
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
