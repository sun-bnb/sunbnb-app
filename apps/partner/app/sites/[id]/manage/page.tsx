import dayjs from 'dayjs'
import prisma from '@repo/data/PrismaCient'
import { SiteProps } from '@/types/shared'
import ManagementView from './view'
import ErrorCard from '@/components/ErrorCard'
import {
  OP_RETURNED,
  RENTAL_CANCELED,
  RESERVATION_CANCELED,
  RESERVATION_REFUNDED,
} from '@repo/data/reservation-status'


export default async function ManagePage({ params, searchParams }: { params: { id: string }, searchParams: { [key: string]: string } }) {

  const { key } = searchParams
  if (!key) return <ErrorCard title="Missing access key" message="No access key was provided. Please use the link given to you by the site operator." showBackLink={false} />

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
    return <ErrorCard title="Invalid or expired access key" message="This access key is no longer valid. Please contact the site operator to get a new link." showBackLink={false} />
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
              // Keep payment_failed (and legacy 'error') visible so staff can Remove them.
              // Only hide truly-gone canceled/refunded rows.
              status: { notIn: [RESERVATION_CANCELED, RESERVATION_REFUNDED] },
            },
            include: {
              user: { select: { id: true, email: true } }
            },
            orderBy: { from: 'asc' }
          },
          pair: true,
          pairedBy: true,
          sunbedGroup: {
            include: {
              items: {
                select: { id: true, number: true, status: true }
              }
            }
          }
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
  if (!site) return <ErrorCard title="Site not found" message="This site does not exist or has been removed. Please contact the site operator." showBackLink={false} />

  // Verify the access key belongs to the site's owner
  if (site.userId !== securityToken.userId) {
    return <ErrorCard title="Not authorized" message="This access key is not valid for this site. Please contact the site operator." showBackLink={false} />
  }

  // The roster is per-account (PartnerAccount keyed by userId === site.userId).
  // Read server-side and pass down so the (token-gated, session-less) manage page
  // can show the current-worker chip without a separate roster-read action.
  const employees = await prisma.employee.findMany({
    where: { accountId: site.userId, active: true },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  })

  return (
    <div className="w-screen">
      <ManagementView site={site as SiteProps} accessKey={key} employees={employees} />
    </div>
  )

}