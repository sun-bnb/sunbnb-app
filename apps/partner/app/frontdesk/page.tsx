import prisma from '@repo/data/PrismaCient'
import { auth } from '@/app/auth'
import TodayBoardView, { type TodayBoardData } from './view'
import {
  BLOCKING_STATUSES,
  OP_EXPECTED,
  OP_CHECKED_IN,
  OP_WALKED_IN,
  OP_DEPARTED,
  OP_NO_SHOW,
  OP_RESERVED,
  OP_PICKED_UP,
  RESERVATION_CANCELED,
  RENTAL_CANCELED,
} from '@repo/data/reservation-status'


const RESERVATION_SELECT = {
  id: true,
  from: true,
  to: true,
  type: true,
  status: true,
  operationalStatus: true,
  guestName: true,
  guestContact: true,
  internalNotes: true,
  checkedInAt: true,
  departedAt: true,
  site: { select: { id: true, name: true } },
  user: { select: { email: true } },
  _count: { select: { items: true } },
} as const

const RENTAL_SELECT = {
  id: true,
  from: true,
  to: true,
  quantity: true,
  durationType: true,
  totalPrice: true,
  status: true,
  operationalStatus: true,
  guestName: true,
  pickedUpAt: true,
  returnedAt: true,
  rentalItem: { select: { id: true, name: true, category: true } },
  site: { select: { id: true, name: true } },
  user: { select: { email: true } },
} as const


async function getTodayBoardData(userId: string): Promise<TodayBoardData> {

  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999)

  // Fetch sites
  const sites = await prisma.site.findMany({
    where: { userId },
    select: { id: true, name: true, features: true },
  })
  const siteIds = sites.map(s => s.id)
  const hasRentals = sites.some(s => s.features.includes('rentals'))

  // ── Parallel queries ──────────────────────────────────────────────────

  const [
    sunbedReservationsRaw,
    rentalBookingsRaw,
  ] = await Promise.all([

    // All today's sunbed reservations (not canceled)
    prisma.reservation.findMany({
      where: {
        siteId: { in: siteIds },
        from: { lte: endOfToday },
        to: { gte: startOfToday },
        status: { not: RESERVATION_CANCELED },
      },
      orderBy: { from: 'asc' },
      select: RESERVATION_SELECT,
    }),

    // All today's rental bookings (not canceled)
    hasRentals
      ? prisma.rentalBooking.findMany({
          where: {
            siteId: { in: siteIds },
            from: { lte: endOfToday },
            to: { gte: startOfToday },
            status: { not: RENTAL_CANCELED },
          },
          orderBy: { from: 'asc' },
          select: RENTAL_SELECT,
        })
      : Promise.resolve([]),
  ])

  // ── Serialize dates ───────────────────────────────────────────────────

  const sunbedReservations = sunbedReservationsRaw.map(r => ({
    id: r.id,
    from: r.from.toISOString(),
    to: r.to.toISOString(),
    type: 'sunbed' as const,
    status: r.status,
    operationalStatus: r.operationalStatus,
    guestName: r.guestName,
    guestContact: r.guestContact,
    guestEmail: r.user.email,
    internalNotes: r.internalNotes,
    checkedInAt: r.checkedInAt?.toISOString() ?? null,
    departedAt: r.departedAt?.toISOString() ?? null,
    siteName: r.site.name,
    siteId: r.site.id,
    itemCount: r._count.items,
  }))

  const rentalBookings = rentalBookingsRaw.map(r => ({
    id: r.id,
    from: r.from.toISOString(),
    to: r.to.toISOString(),
    type: 'rental' as const,
    status: r.status,
    operationalStatus: r.operationalStatus,
    guestName: r.guestName,
    guestEmail: r.user.email,
    siteName: r.site.name,
    siteId: r.site.id,
    rentalItemName: r.rentalItem.name,
    quantity: r.quantity,
    totalPrice: r.totalPrice,
    pickedUpAt: r.pickedUpAt?.toISOString() ?? null,
    returnedAt: r.returnedAt?.toISOString() ?? null,
  }))

  return {
    sites: sites.map(s => ({ id: s.id, name: s.name ?? 'Unnamed site' })),
    sunbedReservations,
    rentalBookings,
  }
}


export default async function TodayBoardPage() {
  const session = await auth()
  if (!session?.user) return null

  const data = await getTodayBoardData(session.user.id)

  return <TodayBoardView data={data} />
}
