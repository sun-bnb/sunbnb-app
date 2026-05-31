import dayjs from 'dayjs'
import Chip from '@mui/material/Chip'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import CalendarTodayIcon from '@mui/icons-material/CalendarToday'
import AccessTimeIcon from '@mui/icons-material/AccessTime'
import RestaurantIcon from '@mui/icons-material/Restaurant'
import GroupIcon from '@mui/icons-material/Group'
import type { TableReservationListItem } from '@/app/reservations/Reservations'

type ChipColor = 'default' | 'success' | 'error' | 'warning'

/**
 * Chip resolution: operational status wins once the guest has arrived (seated /
 * departed / no-show); before that we surface the payment-lifecycle status
 * (canceled / pending payment / confirmed). Mirrors the rental-item convention.
 */
function chipLabel(r: TableReservationListItem): string {
  if (r.status === 'canceled') return 'Canceled'
  if (r.operationalStatus === 'seated') return 'Seated'
  if (r.operationalStatus === 'departed') return 'Departed'
  if (r.operationalStatus === 'no_show') return 'No-show'
  if (r.status === 'pending_payment') return 'Pending'
  return 'Confirmed'
}

function chipColor(r: TableReservationListItem): ChipColor {
  if (r.status === 'canceled') return 'error'
  if (r.operationalStatus === 'seated') return 'success'
  if (r.operationalStatus === 'departed') return 'default'
  if (r.operationalStatus === 'no_show') return 'error'
  if (r.status === 'pending_payment') return 'warning'
  return 'success'
}

export default function TableReservationItem({ reservation }: { reservation: TableReservationListItem }) {
  const t = useTranslations('Reservations')

  const restaurantName = reservation.restaurant?.name
  const tableLabel = reservation.table?.label ?? (reservation.table ? `#${reservation.table.number}` : null)
  const dateStr = dayjs(reservation.from).format('ddd, D MMM YYYY')
  const timeFrom = dayjs(reservation.from).format('HH:mm')
  const timeTo = dayjs(reservation.to).format('HH:mm')

  return (
    <Link href={`/table-reservations/${reservation.id}`}>
      <div className="bg-cream-light rounded-xl shadow-card px-4 py-3 border border-subtle">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            {restaurantName && (
              <div className="flex items-center gap-1.5 mb-1">
                <RestaurantIcon sx={{ fontSize: 14 }} className="text-brand-gold/70" />
                <span className="text-sm font-semibold text-brand-gold truncate">{restaurantName}</span>
              </div>
            )}
            {tableLabel && (
              <div className="text-xs text-gray-700 mb-1">
                <span className="font-medium">{t('Table')} {tableLabel}</span>
              </div>
            )}
            <div className="flex items-center gap-1.5 text-xs text-gray-600 mb-1">
              <CalendarTodayIcon sx={{ fontSize: 13 }} className="text-gray-400" />
              <span>{dateStr}</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-1">
              <AccessTimeIcon sx={{ fontSize: 13 }} className="text-gray-400" />
              <span>{timeFrom} – {timeTo}</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-gray-500">
              <GroupIcon sx={{ fontSize: 13 }} className="text-gray-400" />
              <span>{reservation.partySize} {t(reservation.partySize === 1 ? 'guest' : 'guests')}</span>
            </div>
          </div>
          <div className="ml-3 flex-shrink-0">
            <Chip
              color={chipColor(reservation)}
              label={t(chipLabel(reservation))}
              sx={{ height: '24px', fontSize: '0.75rem' }}
            />
          </div>
        </div>
      </div>
    </Link>
  )
}
