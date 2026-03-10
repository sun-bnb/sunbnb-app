'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useGetRentalBookingByIdQuery } from '@/store/features/api/apiSlice'
import CircularProgress from '@mui/material/CircularProgress'

export default function RentalCompletePage({
  bookingId,
  initialStatus,
}: {
  bookingId: string
  initialStatus: string
}) {
  const [status, setStatus] = useState(initialStatus)
  const router = useRouter()

  const { data: fetchedBooking } = useGetRentalBookingByIdQuery(
    { id: bookingId },
    { pollingInterval: status === 'processing' ? 1000 : 0 }
  )

  useEffect(() => {
    if (fetchedBooking?.status) {
      setStatus(fetchedBooking.status)
      if (fetchedBooking.status === 'complete') {
        router.push(`/reservations/rental/${bookingId}`)
      }
    }
  }, [fetchedBooking?.status, bookingId, router])

  return (
    <div className="flex flex-col items-center justify-center pt-12" style={{ height: '100dvh' }}>
      {status === 'processing' ? (
        <>
          <CircularProgress size={40} />
          <p className="text-sm text-gray-500 mt-4">Processing payment…</p>
        </>
      ) : status === 'complete' ? (
        <>
          <span className="text-4xl mb-2">✅</span>
          <p className="text-lg font-semibold text-gray-900">Payment confirmed</p>
          <p className="text-sm text-gray-500 mt-1">Redirecting to your booking…</p>
        </>
      ) : status === 'payment_failed' ? (
        <>
          <span className="text-4xl mb-2">❌</span>
          <p className="text-lg font-semibold text-gray-900">Payment failed</p>
          <p className="text-sm text-gray-500 mt-1">Please try again or contact support.</p>
        </>
      ) : (
        <>
          <CircularProgress size={40} />
          <p className="text-sm text-gray-500 mt-4">Verifying payment…</p>
        </>
      )}
    </div>
  )
}
