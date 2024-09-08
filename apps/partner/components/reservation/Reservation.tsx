import { cancelReservation } from '@/actions/reservations'
import { Reservation } from '@/types/shared'
import Chip from '@mui/material/Chip'
import Button from '@mui/material/Button'
import MailOutlineIcon from '@mui/icons-material/MailOutline'
import dayjs, { Dayjs } from 'dayjs'

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

export default function ReservationComponent({ reservation }: { reservation: Reservation }) {
 
  
  let reservationElem = null

  const reservationControls = (
    <div className="flex justify-between">
      <div className="">
        {
          reservation.status !== 'canceled' &&
            <Button size="small" variant="outlined" color="error" onClick={() => {
              cancelReservation(reservation.id)
            }}>Cancel</Button>
        }
      </div>
      <div className="flex mt-[6px]">
        <div className="text-gray-400 mr-1 -mt-[1px]">
          <MailOutlineIcon />
        </div>
        <div>{ reservation.user.email }</div>
      </div>
    </div>
  )

  if (reservation.type === 'hours') {
    const formattedDate = dayjs(reservation.from).format('ddd, D MMM YYYY')
    const timeRangeFrom = `${dayjs(reservation.from).format('HH:mm')}`
    const timeRangeTo = `${dayjs(reservation.to).format('HH:mm')}`
    reservationElem = (
      <div className="pt-1 mb-2 pb-2">
        <div className="flex justify-between align-center pb-1">
          <div className="flex -mt-[7px]">
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
        { reservationControls }
      </div>
    )
  } else {
    const dateRangeFrom = dayjs(reservation.from).format('ddd, D MMM YYYY')
    const dateRangeTo = dayjs(reservation.to).format('ddd, D MMM YYYY')
    reservationElem = (
      <div className="mb-2 pb-2 pt-1">
        <div className="flex justify-between align-center pb-1">
          <div className="-mt-[7px]">
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
        { reservationControls }
      </div>
    )
  }

  return reservationElem

}