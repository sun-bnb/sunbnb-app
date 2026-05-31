'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Reservation } from '@/app/sites/types'
import ReservationItem from '@/components/reservation/ReservationItem'
import RentalBookingItem from '@/components/reservation/RentalBookingItem'
import TableReservationItem from '@/components/reservation/TableReservationItem'
import EventBusyIcon from '@mui/icons-material/EventBusy'

export type RentalBookingListItem = {
  id: string
  siteId: string
  rentalItemId: string
  userId: string
  from: Date
  to: Date
  quantity: number
  durationType: string
  totalPrice: number
  status: string
  operationalStatus: string
  guestName: string | null
  pickedUpAt: Date | null
  returnedAt: Date | null
  site: { id: string; name: string | null } | null
  rentalItem: { id: string; name: string } | null
}

export type TableReservationListItem = {
  id: string
  restaurantId: string
  tableId: string | null
  userId: string | null
  bookingGroupId: string | null
  from: Date
  to: Date
  partySize: number
  status: string
  operationalStatus: string
  restaurant: { id: string; name: string } | null
  table: { id: string; number: number; label: string | null } | null
}

type ListEntry =
  | { kind: 'reservation'; data: Reservation }
  | { kind: 'rental'; data: RentalBookingListItem }
  | { kind: 'table'; data: TableReservationListItem }

export default function Reservations({
  reservations,
  rentalBookings,
  tableReservations,
}: {
  reservations: Reservation[]
  rentalBookings: RentalBookingListItem[]
  tableReservations: TableReservationListItem[]
}) {

  const [reservationType, setReservationType] = useState<string>('active')

  const t = useTranslations('Reservations')

  const now = new Date()

  // Merge reservations + rental bookings + table reservations into one sorted list
  const allEntries: ListEntry[] = [
    ...reservations.map(r => ({ kind: 'reservation' as const, data: r })),
    ...rentalBookings.map(r => ({ kind: 'rental' as const, data: r })),
    ...tableReservations.map(r => ({ kind: 'table' as const, data: r })),
  ]

  const visible = allEntries
    .filter(entry =>
      reservationType === 'active' ? entry.data.to >= now : entry.data.to < now
    )
    .sort((a, b) => new Date(b.data.from).getTime() - new Date(a.data.from).getTime())
    
  return (
    <div className="min-h-screen bg-cream">
      <div className="mt-[78px] px-4 pt-4 pb-1 max-w-4xl mx-auto">
        <div className="flex rounded-full bg-cream-dark/60 p-1">
          {(['active', 'history'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setReservationType(tab)}
              className={`
                flex-1 rounded-full py-2 text-xs font-semibold tracking-wide transition-all duration-200
                ${reservationType === tab
                  ? 'bg-white text-brand-gold shadow-soft'
                  : 'text-brand-gold/50 hover:text-brand-gold/70'
                }
              `}
            >
              {t(tab === 'active' ? 'Active' : 'History')}
            </button>
          ))}
        </div>
      </div>
      <div className="px-4 py-3 max-w-4xl mx-auto">
        {visible.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-brand-gold/50">
            <EventBusyIcon sx={{ fontSize: 48, mb: 1 }} />
            <p className="text-sm font-medium">
              {reservationType === 'active' ? t('No active reservations') : t('No past reservations')}
            </p>
          </div>
        )}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
          {visible.map(entry =>
            entry.kind === 'reservation' ? (
              <ReservationItem key={`r-${entry.data.id}`} reservation={entry.data} />
            ) : entry.kind === 'rental' ? (
              <RentalBookingItem key={`rb-${entry.data.id}`} booking={entry.data} />
            ) : (
              <TableReservationItem key={`tr-${entry.data.id}`} reservation={entry.data} />
            )
          )}
        </div>
      </div>
    </div>
  )

}