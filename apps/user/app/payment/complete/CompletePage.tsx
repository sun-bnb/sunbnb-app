'use client'

import CompleteView from './CompleteView'
import { Reservation } from '@/app/sites/types'

export default function CompletePage({
  reservation,
  anonId,
} : {
  reservation: Reservation
  /** anonId from the redirect URL (QR walk-in collection carries it here). */
  anonId?: string
}) {
  return (
    <div className="App">
      <CompleteView reservation={reservation} urlAnonId={anonId} />
    </div>
  )

}