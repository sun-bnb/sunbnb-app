import prisma from '@repo/data/PrismaCient'
import { auth } from '@/app/auth'
import BrandedReservationsView from './view'

async function getSiteAndReservations(slug: string, userId: string) {
  const site = await prisma.site.findFirst({
    where: { slug },
    include: { brand: true },
  })

  if (!site) return null

  const reservations = await prisma.reservation.findMany({
    where: { userId, siteId: site.id },
    orderBy: { from: 'desc' },
    include: {
      site: { select: { id: true, name: true } },
      items: { select: { id: true, number: true } },
    },
  })

  return { site, reservations }
}

export default async function BrandedReservationsPage({ params }: { params: { slug: string } }) {
  const session = await auth()
  if (!session?.user?.id) {
    return (
      <div className="flex items-center justify-center min-h-screen text-gray-500">
        Please sign in to view reservations
      </div>
    )
  }

  const data = await getSiteAndReservations(params.slug, session.user.id)
  if (!data) {
    return (
      <div className="flex items-center justify-center min-h-screen text-gray-500">
        Site not found
      </div>
    )
  }

  return (
    <BrandedReservationsView
      slug={params.slug}
      site={data.site}
      brand={data.site.brand}
      reservations={data.reservations}
    />
  )
}
