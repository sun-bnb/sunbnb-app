'use client'

import { useRef, useState, useLayoutEffect, useEffect } from 'react'
import { Reservation } from '@/app/sites/types'
import ReservationConfirmationView from '@/components/reservation/confirmation/view'
import Menu from './Menu'
import { Order } from '@/app/types/types'
import { useGetOrderByIdQuery, useGetReservationByIdQuery } from '@/store/features/api/apiSlice'
import TermsES from '@/app/tos/reservation/TermsES'
import Link from 'next/link'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import { useTranslations } from 'next-intl'
import { RESERVATION_PROCESSING, RESERVATION_COMPLETE, ORDER_COMPLETE, ORDER_PROCESSING } from '@repo/data/reservation-status'

interface ReservationViewProps {
  reservation: Reservation,
  order: Order | null,
  apiKey: string, stripePublicKey: string | undefined
  signedIn: boolean
  showTerms?: boolean
  siteType?: string
  orderPaymentType?: string
  paymentProvider?: string
  serviceFee: {
    chargeType: string
    feeAmount?: number | null
    percentage?: number | null
  } | undefined
}

export default function ReservationView({ serviceFee, siteType, orderPaymentType, showTerms, signedIn, reservation, order, stripePublicKey, paymentProvider }: ReservationViewProps) {

  const t = useTranslations('Reservations')
  const containerRef = useRef<HTMLDivElement>(null)
  const resRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const touchStartY = useRef<number>(0)

  const [page, setPage] = useState<0 | 1>(order ? 1 : 0)
  const [resScrollable, setResScrollable] = useState(false)
  const [orderStatus, setOrderStatus] = useState<string>(order?.status || ORDER_PROCESSING)
  const [reservationStatus, setReservationStatus] = useState<string>(reservation?.status || RESERVATION_PROCESSING)
  const [displayTerms, setDisplayTerms] = useState<boolean>(showTerms || false)

  const { data: fetchedReservation, error: reservationFetchError } = useGetReservationByIdQuery({
    id: reservation.id,
  }, {
    pollingInterval: reservationStatus === RESERVATION_PROCESSING ? 1000 : 0
  })

  const prevStatusRef = useRef<string | undefined>();

  useEffect(() => {
    const prevStatus = prevStatusRef.current
  
    if (fetchedReservation?.status && fetchedReservation.status !== prevStatus) {
      setReservationStatus(fetchedReservation.status)

      if (prevStatus === RESERVATION_PROCESSING && fetchedReservation.status === RESERVATION_COMPLETE) {
        setDisplayTerms(true)
      }

    }
  
    // Update the ref *after* comparing
    prevStatusRef.current = fetchedReservation?.status;
  }, [fetchedReservation?.status])

  const { data: fetchedOrder, error: orderFetchError } = useGetOrderByIdQuery({
    id: order?.id,
  }, {
    skip: !order || orderStatus === ORDER_COMPLETE,
    pollingInterval: orderStatus === ORDER_PROCESSING ? 1000 : 0
  })
  
  const finalOrder = fetchedOrder || order
  
  useEffect(() => {
    if (finalOrder?.status) {
      setOrderStatus(finalOrder.status);
    }
  }, [finalOrder?.status])

  // Measure whether reservation content overflows
  useLayoutEffect(() => {
    const el = resRef.current
    if (el) {
      setResScrollable(el.scrollHeight > el.clientHeight)
    }
  }, [reservation])

  // Update on resize
  useEffect(() => {
    const handleResize = () => {
      const el = resRef.current
      if (el) {
        setResScrollable(el.scrollHeight > el.clientHeight)
      }
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // Switch pages and reset scroll positions
  const goToPage = (p: 0 | 1) => {
    setPage(p)
    // scroll both views to top
    if (resRef.current) resRef.current.scrollTop = 0
    if (menuRef.current) menuRef.current.scrollTop = 0
  }

  // Swipe detection
  const onTouchStart = (e: React.TouchEvent) => {
    touchStartY.current = e.touches[0]!.clientY
  }
  const onTouchEnd = (e: React.TouchEvent) => {
    if (!serviceFee) return
    const delta = e.changedTouches[0]!.clientY - touchStartY.current
    const threshold = 50
    if (delta < -threshold && page === 0) goToPage(1)
    else if (delta > threshold && page === 1) goToPage(0)
  }

  const seatId = (reservation.items || []).length > 0 ? reservation.items![0]!.id : undefined

  const termsElement = (
    <div className="absolute top-0 left-0 w-full h-full bg-white z-50 text-[10px] flex flex-col">
      <div className="flex-1 overflow-auto p-[6px]">
        <TermsES />
      </div>
      <div className="p-2 border-t border-gray-300">
        <button className="w-full py-2 bg-blue-600 text-white rounded" onClick={() => setDisplayTerms(false)}>
          I Agree
        </button>
      </div>
    </div>
  )

  return (
    <div
      ref={containerRef}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      className="relative w-full overflow-hidden bg-cream"
      style={{ height: '100dvh' }}
    >
      {/* displayTerms && termsElement */}
      <div
        className="transition-transform duration-500 ease-out will-change-transform"
        style={{
          height: '200dvh',
          width: '100vw',
          transform: `translateY(-${page * 100}dvh)`,
        }}
      >
        {/* Page 0: Reservation */}
        <div className="flex flex-col w-full" style={{ height: '100dvh', paddingTop: signedIn ? '80px' : '0px' }}>
          {signedIn && (
            <Link href="/reservations" className="ml-5 mt-2 mb-1 flex items-center gap-1 text-sm text-brand-gold self-start">
              <ArrowBackIcon sx={{ fontSize: 18 }} />
              <span>{t('Reservations')}</span>
            </Link>
          )}
          <div
            ref={resRef}
            className={`${resScrollable ? 'overflow-y-auto' : 'overflow-hidden'} flex-1`}
            style={{ overscrollBehavior: 'contain' }}
          >
            <ReservationConfirmationView reservation={reservation} />
          </div>
          {serviceFee && (
            <button
              onClick={() => goToPage(1)}
              className="h-12 w-full bg-brand-cyan text-cream font-semibold text-sm tracking-widest uppercase
                         active:bg-brand-cyan-dark transition-colors flex items-center justify-center gap-2"
            >
              <span>{t('Food & Drinks')}</span>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          )}
        </div>

        {/* Page 1: Menu */}
        <div className="flex flex-col w-full bg-white" style={{ height: '100dvh', paddingTop: signedIn ? '80px' : '0px' }}>
          <div
            ref={menuRef}
            className="overflow-y-auto flex-1"
            style={{ overscrollBehavior: 'contain' }}
          >
            <Menu
              siteId={reservation.site!.id}
              reservationId={reservation.id}
              seatId={seatId}
              siteType={orderPaymentType ?? siteType}
              stripePublicKey={stripePublicKey}
              paymentProvider={paymentProvider}
              orders={reservation.orders}
              showConfirmation={!!order}
            />
          </div>
          <button
            onClick={() => goToPage(0)}
            className="h-12 w-full bg-brand-cyan text-cream font-semibold text-sm tracking-widest uppercase
                       active:bg-brand-cyan-dark transition-colors flex items-center justify-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
            </svg>
            <span>{t('Back to Reservation')}</span>
          </button>
        </div>
      </div>
    </div>
  )
}
