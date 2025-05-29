import prisma from '@repo/data/PrismaCient'
import { auth } from '@/app/auth'
import { SiteProps } from '@/types/shared'
import SiteView from './site-view'
import { SiteProvider } from './site-context'


export default async function SitePage(
  { params, tab, children }:
  { 
    params: { id: string }
    tab: string
    children?: React.ReactNode | React.ReactNode[]
  }
) {

  const session = await auth()
  if (!session?.user) return null

  const apiKey = process.env.GOOGLE_MAPS_API_KEY as string

  console.log('SITE PAGE PARAMS', params)

  let site: SiteProps | null = {
    name: '',
    services: []
  }

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
          },
          pair: true,
          pairedBy: true
        }
      },
      products: {
        where: { active: true }
      }
    } 
  })
  
  if (!site) return <div>Site {params.id} not found</div>
  
  return (
    <div className="container mx-auto max-w-[768px]">
      <SiteView site={site} apiKey={apiKey} tab={tab}>
        { children }
      </SiteView>
    </div>
  )

}