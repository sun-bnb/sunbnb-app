'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useGetReservationByIdQuery } from '@/store/features/api/apiSlice'
import { Reservation } from '@/app/sites/types'
import ReservationConfirmationView from '@/components/reservation/confirmation/view'


export default function CompleteView({
  reservation
} : {
  stripeClientSecret: string
  reservation: Reservation
}) {

  const [status, setStatus] = useState<string | undefined>('default')
  const router = useRouter()

  const { data: fetchedReservation, error: reservationFetchError } = useGetReservationByIdQuery({
    id: reservation.id,
  }, {
    pollingInterval: status === 'processing' ? 1000 : 0
  })

  const finalReservation = fetchedReservation || reservation

  const anonId = localStorage.getItem('sunbnb-anonId')
  useEffect(() => {
    if (finalReservation?.status) {
      setStatus(finalReservation.status);
      console.log('Final reservation status:', finalReservation.status)
      if (finalReservation.status === 'paid') {
        router.push(`/reservations/${finalReservation.id}${anonId ? `?anonId=${anonId}` : ''}`)
      }
    }
  }, [finalReservation?.status])

  return (
    <div id="payment-status" className="bg-[#fff5e1] pt-[24px]" style={{ height: '100dvh' }}>
      <ReservationConfirmationView reservation={finalReservation} processingStatus={status} />
    </div>
  )

}