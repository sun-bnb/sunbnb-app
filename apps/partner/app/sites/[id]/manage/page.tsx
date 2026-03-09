import prisma from '@repo/data/PrismaCient'
import { SiteProps } from '@/types/shared'
import ManagementView from './view'


export default async function ManagePage({ params, searchParams }: { params: { id: string }, searchParams: { [key: string]: string } }) {

  const apiKey = process.env.GOOGLE_MAPS_API_KEY as string

  let site: SiteProps | null = {
    name: '',
    services: []
  }

  const { token } = searchParams

  if (!token) return <div>Missing token</div>

  const securityToken = await prisma.securityToken.findUnique({
    where: { 
      id: token,
      expires: { gt: new Date() },
      resources: {
        hasSome: ['all', 'manage_site']
      }
    }
  })

  if (!securityToken) {
    return <div>Invalid or expired token</div>
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
              user: { select: { id: true, email: true } }
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

  // Verify the token belongs to the site's owner
  if (site.userId !== securityToken.userId) {
    return <div>Not authorized</div>
  }

  return (
    <div className="w-screen min-w-[768px]">
      <ManagementView site={site} />
    </div>
  )

}