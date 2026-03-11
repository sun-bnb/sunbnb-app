import prisma from '@repo/data/PrismaCient'
import { auth } from '@/app/auth'
import ReservationView from './view'
import Link from 'next/link'

export default async function ReservationPage({ params }: { params: { id: string } }) {

  const session = await auth()
  if (!session?.user) return null

  const reservation = await prisma.reservation.findUnique({
    where: { id: params.id },
    include: {
      user: { select: { id: true, email: true, name: true } },
      site: { select: { id: true, name: true, userId: true, type: true, vat: true } },
      items: {
        select: { id: true, number: true, group: true, label: true, category: true, price: true },
        orderBy: { number: 'asc' },
      },
    },
  })

  if (!reservation) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-16 text-center">
        <h1 className="text-lg font-semibold text-gray-700 mb-2">Reservation not found</h1>
        <p className="text-sm text-gray-500 mb-4">The reservation <span className="font-mono">{params.id}</span> does not exist.</p>
        <Link href="/frontdesk" className="text-sm text-blue-600 hover:underline">Back to Frontdesk</Link>
      </div>
    )
  }

  if (reservation.site.userId !== session.user.id) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-16 text-center">
        <h1 className="text-lg font-semibold text-gray-700 mb-2">Not authorized</h1>
        <p className="text-sm text-gray-500 mb-4">You don't have access to this reservation.</p>
        <Link href="/frontdesk" className="text-sm text-blue-600 hover:underline">Back to Frontdesk</Link>
      </div>
    )
  }

  // Serialize dates for client component
  const data = {
    ...reservation,
    from: reservation.from.toISOString(),
    to: reservation.to.toISOString(),
    createdAt: reservation.createdAt.toISOString(),
    updatedAt: reservation.updatedAt.toISOString(),
    checkedInAt: reservation.checkedInAt?.toISOString() ?? null,
    departedAt: reservation.departedAt?.toISOString() ?? null,
    reminderSentAt: reservation.reminderSentAt?.toISOString() ?? null,
  }

  return <ReservationView reservation={data} />
}