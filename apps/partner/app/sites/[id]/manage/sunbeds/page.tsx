import prisma from '@repo/data/PrismaCient'
import { SiteProps } from '@/types/shared'
import ManagementView from '../view'
import ErrorCard from '@/components/ErrorCard'
import {
  OP_RETURNED,
  RENTAL_CANCELED,
  RESERVATION_CANCELED,
  RESERVATION_REFUNDED,
} from '@repo/data/reservation-status'
import { siteDayBounds } from '@repo/data/site-day'
import { resolveTodayRows } from '../reservation-day'
import { validateManageToken } from '../token'


export default async function ManageSunbedsPage({
  params,
  searchParams,
}: {
  params: { id: string }
  searchParams: { [key: string]: string }
}) {
  const { key } = searchParams

  const tokenResult = await validateManageToken(params.id, key)
  if (!tokenResult.ok) {
    return (
      <ErrorCard
        title={tokenResult.error.title}
        message={tokenResult.error.message}
        showBackLink={false}
      />
    )
  }

  // Heavy data fetch — same block as the old page.tsx.
  // Fetch the site first (minimal) to resolve the venue-local timezone,
  // then compute the today-overlap window in venue-local time.
  const siteMeta = await prisma.site.findFirst({
    where: { id: params.id },
    select: { id: true, userId: true, timeZone: true, locationLat: true, locationLng: true },
  })
  if (!siteMeta) {
    return (
      <ErrorCard
        title="Site not found"
        message="This site does not exist or has been removed. Please contact the site operator."
        showBackLink={false}
      />
    )
  }

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
              user: { select: { id: true, email: true } },
              tillEntries: {
                where: { voidedAt: null },
                select: { id: true, amount: true },
              },
              // Party seats with prices — lets BedDetail show the PARTITIONED
              // seat share in the Seat-mode unreserve dialog (track 018 B2:
              // the machine's tillPartition moves exactly that share).
              items: { select: { id: true, price: true } },
            },
            orderBy: { from: 'asc' },
          },
          pair: true,
          pairedBy: true,
          sunbedGroup: {
            include: {
              items: {
                select: { id: true, number: true, status: true },
              },
            },
          },
        },
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
    },
  })

  // site is guaranteed non-null here (siteMeta check + token validation above)
  if (!site) {
    return (
      <ErrorCard
        title="Site not found"
        message="This site does not exist or has been removed. Please contact the site operator."
        showBackLink={false}
      />
    )
  }

  // A booking's stay is "over" when it has no remaining reserved days — `to` is on
  // or before the end of today. Compute the boundary in venue-local time (not the
  // server TZ) so `stayOver` is correct regardless of where the server runs.
  // A departed/no-show booking frees its bed (green + bookable) only when stayOver;
  // mid-stay it stays held. (track 012)
  const { end: endOfToday } = siteDayBounds(siteForDay)

  // Lazy-resolve today's ReservationDay rows for the non-blocked reservations,
  // then attach the row (+ the stayOver flag) to each reservation object so the
  // view and BedDetail can read today's state without an extra query.
  //
  // Track 020 P5: this was one serially-awaited UPSERT per seat-reservation
  // (a party of 4 hit the same (reservationId, date) key 4×) on every render
  // AND every 30s poll from every open device. resolveTodayRows dedupes by
  // reservation and resolves the whole floor in ≤5 statements.
  const nonBlocked: Array<{ id: string; operationalStatus: string; checkedInAt?: Date | null }> = []
  for (const item of site.inventoryItems ?? []) {
    for (const res of item.reservations ?? []) {
      // Mutate in place — the site object is only read once (server render).
      ;(res as any).stayOver = res.to <= endOfToday
      if (res.operationalStatus === 'blocked') continue
      nonBlocked.push(res)
    }
  }
  const todayRows = await resolveTodayRows(nonBlocked, siteForDay)
  for (const res of nonBlocked) {
    ;(res as any).today = todayRows.get(res.id)
  }

  // The roster is per-account (PartnerAccount keyed by userId === site.userId).
  // Read server-side and pass down so the (token-gated, session-less) manage page
  // can show the current-worker chip without a separate roster-read action.
  const employees = await prisma.employee.findMany({
    where: { accountId: site.userId, active: true },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  })

  const backHref = `/sites/${params.id}/manage?key=${key}`

  return (
    <div className="w-screen">
      <ManagementView
        site={site as SiteProps}
        accessKey={key!}
        employees={employees}
        backHref={backHref}
      />
    </div>
  )
}
