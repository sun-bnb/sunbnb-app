import prisma from '@repo/data/PrismaCient'
import { auth } from '@/app/auth'
import { SiteProps } from '@/app/sites/types'
import SiteView from './view'
import CreateSiteView from './create-site'


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
          orderBy: { number: 'asc' },
          include: {
            reservations: {
              include: {
                user: true
              },
              orderBy: { from: 'asc' }
            }
          }
        }
      } 
    })
    if (!site) return <div>Site {params.id} not found</div>
  }

  console.log('SITE', site?.inventoryItems)

  const content = params.id === 'create' ? 
    <CreateSiteView  site={site} apiKey={apiKey} /> :
    <SiteView site={site} apiKey={apiKey} />
  
    return (
    <div className="container mx-auto max-w-[768px]">
      { content }
    </div>
  )

}