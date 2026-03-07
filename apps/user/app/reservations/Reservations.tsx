'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Reservation } from '@/app/sites/types'
import ReservationItem from '@/components/reservation/ReservationItem'
import EventBusyIcon from '@mui/icons-material/EventBusy'

export default function Reservations({ reservations }: { reservations: Reservation[] }) {

  const [reservationType, setReservationType] = useState<string>('active')

  const t = useTranslations('Reservations')

  const now = new Date()
  const visibleReservations = reservationType === 'active' ?
    reservations.filter(reservation => reservation.to >= now) :
    reservations.filter(reservation => reservation.to < now)
    
  return (
    <div className="min-h-screen bg-cream">
      <div className="mt-[78px] px-4 pt-4 pb-1">
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
      <div className="px-4 py-3 space-y-5">
        {visibleReservations.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-brand-gold/50">
            <EventBusyIcon sx={{ fontSize: 48, mb: 1 }} />
            <p className="text-sm font-medium">
              {reservationType === 'active' ? t('No active reservations') : t('No past reservations')}
            </p>
          </div>
        )}
        {
          visibleReservations.map(reservation => {
            return (
              <ReservationItem key={reservation.id} reservation={reservation} />
            )
          })
        }
      </div>
    </div>
  )

}