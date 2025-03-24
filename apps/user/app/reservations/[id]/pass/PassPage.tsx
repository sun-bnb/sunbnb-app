import ReceiptView from './PassView'
import { Reservation } from '@/app/sites/types'


export default function PassPage({ 
  reservation
} : { 
  reservation: Reservation
}) {
  return (
    <div className="App">
      <ReceiptView reservation={reservation} />
    </div>
  )

}