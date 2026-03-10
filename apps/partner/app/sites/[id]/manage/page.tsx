import dayjs from 'dayjs'
import prisma from '@repo/data/PrismaCient'
import { SiteProps } from '@/types/shared'
import ManagementView from './view'
import { OP_RETURNED, RENTAL_CANCELED } from '@repo/data/reservation-status'


export default async function ManagePage({ params, searchParams }: { params: { id: string }, searchParams: { [key: string]: string } }) {

  const { key } = searchParams
  if (!key) return <div>Missing access key</div>

  const securityToken = await prisma.securityToken.findUnique({
    where: { 
      id: key,
      expires: { gt: new Date() },
      resources: {
        hasSome: ['all', 'manage_site']
      }
    }
  })

  if (!securityToken) {
    return <div>Invalid or expired access key</div>
  }

  const todayStart = dayjs().startOf('day').toDate()
  const todayEnd = dayjs().endOf('day').toDate()

  const site = await prisma.site.findFirst({
    where: { id: params.id },
    include: { 
      workingHours: true,
      inventoryItems: {
        orderBy: { number: 'asc' },
        include: {
          reservations: {
            where: {
              from: { lte: todayEnd },
              to: { gte: todayStart },
            },
            include: {
              user: { select: { id: true, email: true } }
            },
            orderBy: { from: 'asc' }
          },
          pair: true,
          pairedBy: true
        }
      },
      rentalItems: {
        where: { active: true },
        orderBy: { name: 'asc' },
      },
      rentalBookings: {
        where: {
          from: { lte: todayEnd },
          to: { gte: todayStart },
          operationalStatus: { notIn: [OP_RETURNED, RENTAL_CANCELED] },
        },
        include: {
          rentalItem: true,
          user: { select: { id: true, email: true } },
        },
        orderBy: { createdAt: 'asc' },
      },
    } 
  })
  if (!site) return <div>Site {params.id} not found</div>

  // Verify the access key belongs to the site's owner
  if (site.userId !== securityToken.userId) {
    return <div>Not authorized</div>
  }

  return (
    <div className="w-screen">
      <ManagementView site={site as SiteProps} accessKey={key} />
    </div>
  )

}