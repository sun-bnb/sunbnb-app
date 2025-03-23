import ReceiptView from './ReceiptView'
import { Reservation } from '@/app/sites/types'


export default function ReceiptPage({ 
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