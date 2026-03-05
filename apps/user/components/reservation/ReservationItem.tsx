import dayjs from 'dayjs'
import Chip from '@mui/material/Chip'
import Link from 'next/link'
import { Reservation } from '@/app/sites/types'
import { useTranslations } from 'next-intl'

const statusToChipColor: {
  [key: string]: 'default' | 'success' | 'error'
} = {
  'pending': 'default',
  'confirmed': 'success',
  'paid': 'success',
  'complete': 'success',
  'canceled': 'error'
}

const statusToChipLabel: {
  [key: string]: 'Pending' | 'Confirmed' | 'Canceled' | 'Paid' | 'Reserved'
} = {
  'pending': 'Pending',
  'confirmed': 'Confirmed',
  'paid': 'Paid',
  'complete': 'Paid',
  'canceled': 'Canceled'
}

function getChipLabel(reservation: Reservation): string {
  if (reservation.status === 'complete' && !reservation.paymentAmount) return 'Reserved'
  return statusToChipLabel[reservation.status] || 'Unknown'
}


export default function ReservationItem({ reservation }: { reservation: Reservation }) {

  const t = useTranslations('Reservations')

  if (reservation.type === 'hours') {
    const formattedDate = dayjs(reservation.from).format('ddd, D MMM YYYY')
    const timeRangeFrom = `${dayjs(reservation.from).format('HH:mm')}`
    const timeRangeTo = `${dayjs(reservation.to).format('HH:mm')}`
    return (
      <Link href={`/reservations/${reservation.id}`}>
        <div className="flex px-2 justify-between items-center mt-2 mb-3 pb-3 border-b border-subtle">
          <div className="flex text-sm">
            <div className="mr-4 text-gray-700">{formattedDate}</div>
            <div className="flex text-gray-500">
              <div className="mr-1">{timeRangeFrom}</div>
              <div>-</div>
              <div className="ml-1">{timeRangeTo}</div>
            </div>
          </div>
          <div>
            <Chip color={statusToChipColor[reservation.status]} 
              label={t(getChipLabel(reservation)) } 
              sx={{ height: '26px' }} />
          </div>
        </div>
      </Link>
    )
  } else {
    const dateRangeFrom = dayjs(reservation.from).format('ddd, D MMM YYYY')
    const dateRangeTo = dayjs(reservation.to).format('ddd, D MMM YYYY')
    return (
      <Link href={`/reservations/${reservation.id}`}>
        <div className="flex px-2 justify-between items-center mt-2 mb-3 pb-3 border-b border-subtle">
          <div className="text-sm">
            <div className="flex text-gray-700">
              <div className="mr-1">{dateRangeFrom}</div>
              <div>-</div>
              <div className="ml-1">{dateRangeTo}</div>
            </div>
          </div>
          <div>
            <Chip color={statusToChipColor[reservation.status]} 
              label={t(getChipLabel(reservation)) }
              sx={{ height: '26px' }} />
          </div>
        </div>
      </Link>
    )
  }

}