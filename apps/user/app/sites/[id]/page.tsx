import prisma from '@repo/data/PrismaCient'
import { auth } from '@/app/auth'
import SiteView from './view'

async function getSite(id: string, userId: string) {
  const site = await prisma.site.findFirst({ 
    where: { id: id },
    include: {
      workingHours: true,
      inventoryItems: {
        include: {
          reservations: {
            where: {
              userId: userId
            },
            orderBy: { from: 'desc' }
          }
        }
      }
    }
  })

  return site

}

export default async function Site({ params, searchParams }: { params: { id: string }, searchParams: URLSearchParams }) {

  console.log('params', params)
  const session = await auth()
  if (!session?.user) return null

  const apiKey = process.env.GOOGLE_MAPS_API_KEY as string
  console.log('API KEY', apiKey)

  const site = await getSite(params.id, session.user.id)
  if (!site) return <div>Site {params.id} not found</div>

  return (
    <div className="container mx-auto lg:px-4">
      <SiteView site={site} apiKey={apiKey} />
    </div>
  )

}