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
  const [anonId, setAnonId] = useState<string | null>(null)
  const router = useRouter()
  const { data: session } = useSession()

  // Read anonId from localStorage inside useEffect to avoid SSR errors
  useEffect(() => {
    if (!session?.user?.id) {
      const storedAnonId = localStorage.getItem('sunbnb-anonId')
      setAnonId(storedAnonId)
    }
  }, [session?.user?.id])

  const { data: fetchedReservation, error: reservationFetchError } = useGetReservationByIdQuery({
    id: reservation.id,
  }, {
    pollingInterval: status === 'processing' ? 1000 : 0
  })

  const finalReservation = fetchedReservation || reservation

  
  useEffect(() => {
    if (finalReservation?.status) {
      setStatus(finalReservation.status);
      if (finalReservation.status === 'paid' || finalReservation.status === 'complete') {
        router.push(`/reservations/${finalReservation.id}?terms=true${anonId ? `&anonId=${anonId}` : ''}`)
      }
    }
  }, [finalReservation?.status, anonId])

  return (
    <div id="payment-status" className="bg-[#fff5e1] pt-[24px]" style={{ height: '100dvh' }}>
      <ReservationConfirmationView reservation={finalReservation} processingStatus={status} />
    </div>
  )

}