import dayjs from 'dayjs'
import Chip from '@mui/material/Chip'
import Link from 'next/link'
import { Reservation } from '@/app/sites/types'
import { useTranslations } from 'next-intl'
import EventSeatIcon from '@mui/icons-material/EventSeat'
import CalendarTodayIcon from '@mui/icons-material/CalendarToday'
import AccessTimeIcon from '@mui/icons-material/AccessTime'
import {
  RESERVATION_PENDING,
  RESERVATION_COMPLETE,
  RESERVATION_CANCELED,
  RESERVATION_PAYMENT_FAILED,
  RESERVATION_REFUNDED,
} from '@repo/data/reservation-status'
import { formatSeat } from '@repo/data/seat-label'

const statusToChipColor: {
  [key: string]: 'default' | 'success' | 'error'
} = {
  [RESERVATION_PENDING]: 'default',
  'confirmed': 'success',
  [RESERVATION_COMPLETE]: 'success',
  [RESERVATION_CANCELED]: 'error',
  [RESERVATION_PAYMENT_FAILED]: 'error',
  [RESERVATION_REFUNDED]: 'default'
}

const statusToChipLabel: {
  [key: string]: string
} = {
  [RESERVATION_PENDING]: 'Pending',
  'confirmed': 'Confirmed',
  [RESERVATION_COMPLETE]: 'Paid',
  [RESERVATION_CANCELED]: 'Canceled',
  [RESERVATION_PAYMENT_FAILED]: 'Payment failed',
  [RESERVATION_REFUNDED]: 'Refunded'
}

function getChipLabel(reservation: Reservation): string {
  if (reservation.status === RESERVATION_COMPLETE && !reservation.paymentAmount) return 'Reserved'
  return statusToChipLabel[reservation.status] || 'Unknown'
}


export default function ReservationItem({ reservation }: { reservation: Reservation }) {

  const t = useTranslations('Reservations')

  const siteName = reservation.site?.name
  const seatNumbers = reservation.items?.map(item => formatSeat(item)).join(', ')

  if (reservation.type === 'hours') {
    const formattedDate = dayjs(reservation.from).format('ddd, D MMM YYYY')
    const timeRangeFrom = dayjs(reservation.from).format('HH:mm')
    const timeRangeTo = dayjs(reservation.to).format('HH:mm')
    return (
      <Link href={`/reservations/${reservation.id}`}>
        <div className="bg-cream-light rounded-xl shadow-card px-4 py-3 border border-subtle">
          <div className="flex items-start justify-between">
            <div className="flex-1 min-w-0">
              {siteName && (
                <div className="text-sm font-semibold text-brand-gold truncate mb-1">{siteName}</div>
              )}
              <div className="flex items-center gap-1.5 text-xs text-gray-600 mb-1">
                <CalendarTodayIcon sx={{ fontSize: 13 }} className="text-gray-400" />
                <span>{formattedDate}</span>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-gray-500">
                <AccessTimeIcon sx={{ fontSize: 13 }} className="text-gray-400" />
                <span>{timeRangeFrom} – {timeRangeTo}</span>
              </div>
              {seatNumbers && (
                <div className="flex items-center gap-1.5 text-xs text-gray-500 mt-1">
                  <EventSeatIcon sx={{ fontSize: 13 }} className="text-gray-400" />
                  <span>{seatNumbers}</span>
                </div>
              )}
            </div>
            <div className="ml-3 flex-shrink-0">
              <Chip color={statusToChipColor[reservation.status]} 
                label={t(getChipLabel(reservation))}
                sx={{ height: '24px', fontSize: '0.75rem' }} />
            </div>
          </div>
        </div>
      </Link>
    )
  } else {
    const dateRangeFrom = dayjs(reservation.from).format('ddd, D MMM YYYY')
    const dateRangeTo = dayjs(reservation.to).format('ddd, D MMM YYYY')
    return (
      <Link href={`/reservations/${reservation.id}`}>
        <div className="bg-cream-light rounded-xl shadow-card px-4 py-3 border border-subtle">
          <div className="flex items-start justify-between">
            <div className="flex-1 min-w-0">
              {siteName && (
                <div className="text-sm font-semibold text-brand-gold truncate mb-1">{siteName}</div>
              )}
              <div className="flex items-center gap-1.5 text-xs text-gray-600 mb-1">
                <CalendarTodayIcon sx={{ fontSize: 13 }} className="text-gray-400" />
                <span>{dateRangeFrom} – {dateRangeTo}</span>
              </div>
              {seatNumbers && (
                <div className="flex items-center gap-1.5 text-xs text-gray-500 mt-1">
                  <EventSeatIcon sx={{ fontSize: 13 }} className="text-gray-400" />
                  <span>{seatNumbers}</span>
                </div>
              )}
            </div>
            <div className="ml-3 flex-shrink-0">
              <Chip color={statusToChipColor[reservation.status]} 
                label={t(getChipLabel(reservation))}
                sx={{ height: '24px', fontSize: '0.75rem' }} />
            </div>
          </div>
        </div>
      </Link>
    )
  }

}