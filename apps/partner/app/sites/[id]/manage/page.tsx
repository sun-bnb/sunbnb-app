import prisma from '@repo/data/PrismaCient'
import { auth } from '@/app/auth'
import { SiteProps } from '@/types/shared'
import ManagementView from './view'


export default async function Site({ params }: { params: { id: string } }) {

  const session = await auth()
  if (!session?.user) return null

  const apiKey = process.env.GOOGLE_MAPS_API_KEY as string

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
      }
    } 
  })
  if (!site) return <div>Site {params.id} not found</div>

  return (
    <div className="w-screen min-w-[768px]">
      <ManagementView site={site} userId={session.user.id} apiKey={apiKey} />
    </div>
  )

}