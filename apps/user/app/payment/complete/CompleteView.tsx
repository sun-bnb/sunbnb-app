'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useGetReservationByIdQuery } from '@/store/features/api/apiSlice'
import { Reservation } from '@/app/sites/types'
import ReservationConfirmationView from '@/components/reservation/confirmation/view'
import { useSession } from 'next-auth/react'


export default function CompleteView({
  reservation
} : {
  reservation: Reservation
}) {

  const [status, setStatus] = useState<string | undefined>('default')
  const router = useRouter()
  const { data: session } = useSession()

  let anonId = null
  if (!(session?.user?.id)) {
    anonId = localStorage.getItem('sunbnb-anonId')
  }

  const { data: fetchedReservation, error: reservationFetchError } = useGetReservationByIdQuery({
    id: reservation.id,
  }, {
    pollingInterval: status === 'processing' ? 1000 : 0
  })

  const finalReservation = fetchedReservation || reservation

  
  useEffect(() => {
    if (finalReservation?.status) {
      setStatus(finalReservation.status);
      console.log('Final reservation status:', finalReservation.status)
      if (finalReservation.status === 'paid' || finalReservation.status === 'complete') {
        router.push(`/reservations/${finalReservation.id}?terms=true${anonId ? `&anonId=${anonId}` : ''}`)
      }
    }
  }, [finalReservation?.status])

  return (
    <div id="payment-status" className="bg-[#fff5e1] pt-[24px]" style={{ height: '100dvh' }}>
      <ReservationConfirmationView reservation={finalReservation} processingStatus={status} />
    </div>
  )

}