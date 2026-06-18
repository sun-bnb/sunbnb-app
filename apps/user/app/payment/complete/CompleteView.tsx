'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useGetReservationByIdQuery } from '@/store/features/api/apiSlice'
import { Reservation } from '@/app/sites/types'
import ReservationConfirmationView from '@/components/reservation/confirmation/view'
import { useSession } from 'next-auth/react'
import { RESERVATION_PROCESSING, RESERVATION_COMPLETE } from '@repo/data/reservation-status'


export default function CompleteView({
  reservation,
  urlAnonId,
} : {
  reservation: Reservation
  /** anonId carried in the redirect URL (a QR walk-in beachgoer has none in
   *  localStorage) — adopt it so the polling query + onward links can claim
   *  this reservation. */
  urlAnonId?: string
}) {

  const [status, setStatus] = useState<string | undefined>('default')
  const [anonId, setAnonId] = useState<string | null>(null)
  const router = useRouter()
  const { data: session } = useSession()

  // Resolve the anonId inside useEffect to avoid SSR errors. Prefer the one from
  // the redirect URL and persist it, so the RTK polling query (which reads
  // localStorage) can verify ownership; fall back to an existing stored anonId.
  useEffect(() => {
    if (!session?.user?.id) {
      const storedAnonId = localStorage.getItem('sunbnb-anonId')
      const effective = urlAnonId || storedAnonId
      if (urlAnonId && urlAnonId !== storedAnonId) {
        localStorage.setItem('sunbnb-anonId', urlAnonId)
      }
      setAnonId(effective)
    }
  }, [session?.user?.id, urlAnonId])

  const { data: fetchedReservation, error: reservationFetchError } = useGetReservationByIdQuery({
    id: reservation.id,
  }, {
    pollingInterval: (status === RESERVATION_PROCESSING || status === 'default') ? 1000 : 0
  })

  const finalReservation = fetchedReservation || reservation

  
  useEffect(() => {
    if (finalReservation?.status) {
      setStatus(finalReservation.status);
      if (finalReservation.status === RESERVATION_COMPLETE) {
        router.push(`/reservations/${finalReservation.id}?terms=true${anonId ? `&anonId=${anonId}` : ''}`)
      }
    }
  }, [finalReservation?.status, anonId])

  return (
    <div id="payment-status" className="bg-cream pt-6" style={{ height: '100dvh' }}>
      <ReservationConfirmationView reservation={finalReservation} processingStatus={status} />
    </div>
  )

}