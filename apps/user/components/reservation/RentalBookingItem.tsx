import dayjs from 'dayjs'
import Chip from '@mui/material/Chip'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import CalendarTodayIcon from '@mui/icons-material/CalendarToday'
import AccessTimeIcon from '@mui/icons-material/AccessTime'
import SurfingIcon from '@mui/icons-material/Surfing'
import type { RentalBookingListItem } from '@/app/reservations/Reservations'

const statusColor: Record<string, 'default' | 'success' | 'error' | 'warning'> = {
  pending: 'default',
  complete: 'success',
  cancelled: 'error',
}

const opStatusColor: Record<string, 'default' | 'success' | 'error' | 'warning'> = {
  reserved: 'warning',
  'picked-up': 'success',
  returned: 'default',
}

function chipLabel(booking: RentalBookingListItem): string {
  if (booking.operationalStatus === 'picked-up') return 'In use'
  if (booking.operationalStatus === 'returned') return 'Returned'
  if (booking.status === 'complete' && !booking.totalPrice) return 'Reserved'
  if (booking.status === 'complete' || booking.status === 'paid') return 'Paid'
  if (booking.status === 'cancelled') return 'Cancelled'
  return 'Pending'
}

function chipColor(booking: RentalBookingListItem) {
  if (booking.operationalStatus === 'picked-up') return opStatusColor['picked-up']
  if (booking.operationalStatus === 'returned') return opStatusColor['returned']
  return statusColor[booking.status] || 'default'
}

export default function RentalBookingItem({ booking }: { booking: RentalBookingListItem }) {

  const t = useTranslations('Reservations')

  const siteName = booking.site?.name
  const itemName = booking.rentalItem?.name
  const qty = booking.quantity > 1 ? ` ×${booking.quantity}` : ''

  if (booking.durationType === 'hours') {
    const formattedDate = dayjs(booking.from).format('ddd, D MMM YYYY')
    const timeFrom = dayjs(booking.from).format('HH:mm')
    const timeTo = dayjs(booking.to).format('HH:mm')
    return (
      <Link href={`/reservations/rental/${booking.id}`}>
      <div className="bg-cream-light rounded-xl shadow-card px-4 py-3 border border-subtle">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            {siteName && (
              <div className="text-sm font-semibold text-brand-gold truncate mb-1">{siteName}</div>
            )}
            {itemName && (
              <div className="flex items-center gap-1.5 text-xs text-gray-700 mb-1">
                <SurfingIcon sx={{ fontSize: 13 }} className="text-gray-400" />
                <span className="font-medium">{itemName}{qty}</span>
              </div>
            )}
            <div className="flex items-center gap-1.5 text-xs text-gray-600 mb-1">
              <CalendarTodayIcon sx={{ fontSize: 13 }} className="text-gray-400" />
              <span>{formattedDate}</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-gray-500">
              <AccessTimeIcon sx={{ fontSize: 13 }} className="text-gray-400" />
              <span>{timeFrom} – {timeTo}</span>
            </div>
          </div>
          <div className="ml-3 flex-shrink-0">
            <Chip
              color={chipColor(booking)}
              label={t(chipLabel(booking))}
              sx={{ height: '24px', fontSize: '0.75rem' }}
            />
          </div>
        </div>
      </div>
      </Link>
    )
  }

  // days
  const dateFrom = dayjs(booking.from).format('ddd, D MMM YYYY')
  const dateTo = dayjs(booking.to).format('ddd, D MMM YYYY')
  return (
    <Link href={`/reservations/rental/${booking.id}`}>
    <div className="bg-cream-light rounded-xl shadow-card px-4 py-3 border border-subtle">
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          {siteName && (
            <div className="text-sm font-semibold text-brand-gold truncate mb-1">{siteName}</div>
          )}
          {itemName && (
            <div className="flex items-center gap-1.5 text-xs text-gray-700 mb-1">
              <SurfingIcon sx={{ fontSize: 13 }} className="text-gray-400" />
              <span className="font-medium">{itemName}{qty}</span>
            </div>
          )}
          <div className="flex items-center gap-1.5 text-xs text-gray-600 mb-1">
            <CalendarTodayIcon sx={{ fontSize: 13 }} className="text-gray-400" />
            <span>{dateFrom} – {dateTo}</span>
          </div>
        </div>
        <div className="ml-3 flex-shrink-0">
          <Chip
            color={chipColor(booking)}
            label={t(chipLabel(booking))}
            sx={{ height: '24px', fontSize: '0.75rem' }}
          />
        </div>
      </div>
    </div>
    </Link>
  )

}
