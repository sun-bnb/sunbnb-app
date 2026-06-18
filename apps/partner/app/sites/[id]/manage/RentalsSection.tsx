'use client'

import { useTranslations } from 'next-intl'
import { RentalBookingProps } from '@/types/shared'
import RentalBookingCard from './RentalBookingCard'
import { OP_PICKED_UP, OP_RESERVED } from '@repo/data/reservation-status'

interface RentalsSectionProps {
  siteId: string
  accessKey: string
  rentalBookings: RentalBookingProps[] | undefined
  onRentOut: () => void
}

export default function RentalsSection({
  siteId,
  accessKey,
  rentalBookings,
  onRentOut,
}: RentalsSectionProps) {
  const t = useTranslations('SiteManage')
  const bookings = rentalBookings ?? []
  const outCount = bookings.filter(b => b.operationalStatus === OP_PICKED_UP).length
  const waitingCount = bookings.filter(b => b.operationalStatus === OP_RESERVED).length

  return (
    <div className="mt-6 mb-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-3 px-1">
        <div className="flex items-center gap-2">
          <span className="text-xl font-black">🏄</span>
          {bookings.length > 0 && (
            <span className="text-base font-black text-gray-600 dark:text-gray-300">
              {outCount} {t('out')}
              {waitingCount > 0 && (
                <span className="text-yellow-600 ml-2">
                  {waitingCount} {t('waiting')}
                </span>
              )}
            </span>
          )}
        </div>
        <button
          onClick={onRentOut}
          className="bg-green-600 text-white text-base font-black px-5 py-3 rounded-xl active:bg-green-700 select-none"
        >
          {t('rentOut')}
        </button>
      </div>

      {bookings.length === 0 ? (
        <div className="text-center py-6 text-gray-300 dark:text-gray-500 text-lg font-bold">
          {t('noRentals')}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {bookings.map(booking => (
            <RentalBookingCard
              key={booking.id}
              siteId={siteId}
              booking={booking}
              accessKey={accessKey}
            />
          ))}
        </div>
      )}
    </div>
  )
}
