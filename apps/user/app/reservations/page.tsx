import prisma from '@repo/data/PrismaCient'
import { auth } from '@/app/auth'
import dayjs, { Dayjs } from 'dayjs'
import Chip from '@mui/material/Chip'
import Link from 'next/link'

const statusToChipColor: {
  [key: string]: 'default' | 'success' | 'error'
} = {
  'pending': 'default',
  'confirmed': 'success',
  'canceled': 'error'
}

const statusToChipLabel: {
  [key: string]: 'Pending' | 'Confirmed' | 'Canceled'
} = {
  'pending': 'Pending',
  'confirmed': 'Confirmed',
  'canceled': 'Canceled'
}

export default async function Sites() {

  const session = await auth()
  if (!session?.user) return null

  const reservations = await prisma.reservation.findMany({ where: { userId: session.user.id }})

  return (
    <div className="px-2 py-4">
      {
        reservations.map(reservation => {
          let reservationElem = null
          if (reservation.type === 'hours') {
            const formattedDate = dayjs(reservation.from).format('ddd, D MMM YYYY')
            const timeRangeFrom = `${dayjs(reservation.from).format('HH:mm')}`
            const timeRangeTo = `${dayjs(reservation.to).format('HH:mm')}`
            reservationElem = (
              <Link href={`/reservations/${reservation.id}`}>
                <div className="flex px-1 justify-between align-center mt-2 mb-4 pb-1">
                  <div className="flex text-sm">
                    <div className="mr-4">{formattedDate}</div>
                    <div className="flex text-gray-600">
                      <div className="mr-1">{timeRangeFrom}</div>
                      <div>-</div>
                      <div className="ml-1">{timeRangeTo}</div>
                    </div>
                  </div>
                  <div className="-mt-1">
                    <Chip color={statusToChipColor[reservation.status]} 
                      label={statusToChipLabel[reservation.status]} 
                      sx={{ height: '26px' }} />
                  </div>
                </div>
              </Link>
            )
          } else {
            const dateRangeFrom = dayjs(reservation.from).format('ddd, D MMM YYYY')
            const dateRangeTo = dayjs(reservation.to).format('ddd, D MMM YYYY')
            reservationElem = (
              <Link href={`/reservations/${reservation.id}`}>
                <div className="flex px-1 justify-between align-center mt-2 mb-4 pb-1">
                  <div className="text-sm">
                    <div className="flex">
                      <div className="mr-1">{dateRangeFrom}</div>
                      <div>-</div>
                      <div className="ml-1">{dateRangeTo}</div>
                    </div>
                  </div>
                  <div className="-mt-1">
                    <Chip color={statusToChipColor[reservation.status]} 
                      label={statusToChipLabel[reservation.status]}
                      sx={{ height: '26px' }} />
                  </div>
                </div>
              </Link>
            )
          }
          return (
            <div key={reservation.id}>{reservationElem}</div>
          )
        })
      }
    </div>
  )

}