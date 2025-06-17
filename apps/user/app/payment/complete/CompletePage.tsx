'use client'

import CompleteView from './CompleteView'
import { Reservation } from '@/app/sites/types'

export default function CompletePage({
  reservation
} : {
  reservation: Reservation
}) {
  return (
    <div className="App">
      <CompleteView reservation={reservation} />
    </div>
  )

}