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
import { siteDayBounds } from '@repo/data/site-day'
import { resolveTodayRow } from './reservation-day'


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

  // Fetch the site first (minimal) to resolve the venue-local timezone,
  // then compute the today-overlap window in venue-local time.
  const siteMeta = await prisma.site.findFirst({
    where: { id: params.id },
    select: { id: true, userId: true, timeZone: true, locationLat: true, locationLng: true },
  })
  if (!siteMeta) return <ErrorCard title="Site not found" message="This site does not exist or has been removed. Please contact the site operator." showBackLink={false} />

  const siteForDay = {
    timeZone: siteMeta.timeZone,
    locationLat: siteMeta.locationLat,
    locationLng: siteMeta.locationLng,
  }
  const { start: todayStart, end: todayEnd } = siteDayBounds(siteForDay)

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
          user: { select: { id: true, name: true, email: true } },
        },
        orderBy: { createdAt: 'asc' },
      },
    } 
  })
  // site is guaranteed non-null here (siteMeta check above would have returned early)
  if (!site) return <ErrorCard title="Site not found" message="This site does not exist or has been removed. Please contact the site operator." showBackLink={false} />

  // Verify the access key belongs to the site's owner
  if (site.userId !== securityToken.userId) {
    return <ErrorCard title="Not authorized" message="This access key is not valid for this site. Please contact the site operator." showBackLink={false} />
  }

  // A booking's stay is "over" when it has no remaining reserved days — `to` is on
  // or before the end of today. `to` is stored as server-tz end-of-day, so compute
  // the boundary server-side (here) and pass a flag down, so the client grid never
  // does a tz-skewed comparison. A departed/no-show booking frees its bed (green +
  // bookable) only when stayOver; mid-stay it stays held. (track 012)
  const endOfToday = new Date()
  endOfToday.setHours(23, 59, 59, 999)

  // Lazy-upsert today's ReservationDay row for each non-blocked reservation,
  // then attach the resulting row (+ the stayOver flag) to the reservation object
  // so the view and BedDetail can read today's state without an extra query.
  for (const item of site.inventoryItems ?? []) {
    for (const res of item.reservations ?? []) {
      // Mutate in place — the site object is only read once (server render).
      ;(res as any).stayOver = res.to <= endOfToday
      if (res.operationalStatus === 'blocked') continue
      const todayRow = await resolveTodayRow(res, siteForDay)
      ;(res as any).today = todayRow
    }
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