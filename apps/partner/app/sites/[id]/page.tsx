import prisma from '@repo/data/PrismaCient'
import { auth } from '@/app/auth'
import { SiteProps } from '@/app/sites/types'
import SiteView from './view'

export default async function Site({ params }: { params: { id: string } }) {

  const session = await auth()
  if (!session?.user) return null

  const apiKey = process.env.GOOGLE_MAPS_API_KEY as string

  let site: SiteProps | null = {
    name: ''
  }

  if (params.id !== 'create') {
    site = await prisma.site.findFirst({ 
      where: { id: params.id }, 
      include: { 
        workingHours: true,
        inventoryItems: {
          include: {
            reservations: {
              where: {
                status: { not: 'canceled' }
              }
            }
          }
        }
      } 
    })
    if (!site) return <div>Site {params.id} not found</div>
  }

  console.log('SITE', site?.inventoryItems)
  return (
    <div className="container mx-auto lg:px-4">
      <SiteView site={site} apiKey={apiKey} />
    </div>
  )

}