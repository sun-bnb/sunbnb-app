'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useGetRentalBookingByIdQuery } from '@/store/features/api/apiSlice'
import CircularProgress from '@mui/material/CircularProgress'
import { useTranslations } from 'next-intl'
import { trackPurchase } from '@/app/analytics/track'
import { isPaidPurchase } from '@/app/analytics/funnel'
import {
  RENTAL_PROCESSING,
  RENTAL_COMPLETE,
  RENTAL_PAYMENT_FAILED,
} from '@repo/data/reservation-status'

export default function RentalCompletePage({
  bookingId,
  initialStatus,
  analytics,
}: {
  bookingId: string
  initialStatus: string
  /** Server-computed purchase payload (site + summed paid amount) for GA4. */
  analytics?: { siteId: string; siteName: string | null; amount: number; quantity: number }
}) {
  const [status, setStatus] = useState(initialStatus)
  const router = useRouter()
  const t = useTranslations('PaymentComplete')

  const { data: fetchedBooking } = useGetRentalBookingByIdQuery(
    { id: bookingId },
    { pollingInterval: status === RENTAL_PROCESSING ? 1000 : 0 }
  )

  useEffect(() => {
    if (fetchedBooking?.status) {
      setStatus(fetchedBooking.status)
      if (fetchedBooking.status === RENTAL_COMPLETE) {
        if (analytics && isPaidPurchase(fetchedBooking, RENTAL_COMPLETE)) {
          trackPurchase({ kind: 'rental', transactionId: bookingId, siteId: analytics.siteId, siteName: analytics.siteName, value: analytics.amount, quantity: analytics.quantity })
        }
        router.push(`/reservations/rental/${bookingId}`)
      }
    }
  }, [fetchedBooking?.status, bookingId, router])

  return (
    <div className="flex flex-col items-center justify-center pt-12" style={{ height: '100dvh' }}>
      {status === RENTAL_PROCESSING ? (
        <>
          <CircularProgress size={40} />
          <p className="text-sm text-gray-500 mt-4">{t('Processing payment')}</p>
        </>
      ) : status === RENTAL_COMPLETE ? (
        <>
          <span className="text-4xl mb-2">✅</span>
          <p className="text-lg font-semibold text-gray-900">{t('Payment confirmed')}</p>
          <p className="text-sm text-gray-500 mt-1">{t('Redirecting to your booking')}</p>
        </>
      ) : status === RENTAL_PAYMENT_FAILED ? (
        <>
          <span className="text-4xl mb-2">❌</span>
          <p className="text-lg font-semibold text-gray-900">{t('Payment failed')}</p>
          <p className="text-sm text-gray-500 mt-1">{t('Please try again or contact support')}</p>
        </>
      ) : (
        <>
          <CircularProgress size={40} />
          <p className="text-sm text-gray-500 mt-4">{t('Verifying payment')}</p>
        </>
      )}
    </div>
  )
}
