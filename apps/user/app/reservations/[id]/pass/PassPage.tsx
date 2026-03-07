import PassView from './PassView'
import { Reservation } from '@/app/sites/types'

export default function PassPage({ 
  reservation
} : { 
  reservation: Reservation
}) {
  return <PassView reservation={reservation} />
}