'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import dayjs from 'dayjs'
import Chip from '@mui/material/Chip'
import EventBusyIcon from '@mui/icons-material/EventBusy'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import EventSeatIcon from '@mui/icons-material/EventSeat'
import CalendarTodayIcon from '@mui/icons-material/CalendarToday'
import AccessTimeIcon from '@mui/icons-material/AccessTime'
import Link from 'next/link'
import type { Reservation } from '@/app/sites/types'
import type { SiteViewBrand } from '@/app/sites/[id]/view'
import {
  RESERVATION_PENDING,
  RESERVATION_COMPLETE,
  RESERVATION_CANCELED,
  RESERVATION_PAYMENT_FAILED,
  RESERVATION_REFUNDED,
} from '@repo/data/reservation-status'

const statusToChipColor: Record<string, 'default' | 'success' | 'error'> = {
  [RESERVATION_PENDING]: 'default',
  confirmed: 'success',
  [RESERVATION_COMPLETE]: 'success',
  [RESERVATION_CANCELED]: 'error',
  [RESERVATION_PAYMENT_FAILED]: 'error',
  [RESERVATION_REFUNDED]: 'default',
}

function getChipLabel(reservation: Reservation): string {
  if (reservation.status === RESERVATION_COMPLETE && !reservation.paymentAmount) return 'Reserved'
  const map: Record<string, string> = {
    [RESERVATION_PENDING]: 'Pending',
    confirmed: 'Confirmed',
    [RESERVATION_COMPLETE]: 'Paid',
    [RESERVATION_CANCELED]: 'Canceled',
    [RESERVATION_PAYMENT_FAILED]: 'Payment failed',
    [RESERVATION_REFUNDED]: 'Refunded',
  }
  return map[reservation.status] || 'Unknown'
}

export default function BrandedReservationsView({
  slug,
  site,
  brand,
  reservations,
}: {
  slug: string
  site: { id: string; name?: string | null }
  brand: SiteViewBrand | null | undefined
  reservations: Reservation[]
}) {
  const router = useRouter()
  const t = useTranslations('Reservations')

  const bgColor = brand?.bgColor || '#faf9f6'
  const fgColor = brand?.fgColor || '#111827'

  const [tab, setTab] = useState<'active' | 'history'>('active')

  useEffect(() => {
    document.body.style.backgroundColor = bgColor
    return () => { document.body.style.backgroundColor = '' }
  }, [bgColor])

  const now = new Date()
  const visible = tab === 'active'
    ? reservations.filter(r => r.to >= now)
    : reservations.filter(r => r.to < now)

  return (
    <div className="min-h-screen" style={{ backgroundColor: bgColor, color: fgColor }}>
      {/* Header */}
      <div className="flex items-center gap-3 px-4 pt-4 pb-2">
        <button
          onClick={() => router.push(`/s/${slug}`)}
          className="flex items-center justify-center w-8 h-8 rounded-full hover:opacity-70 transition-opacity"
          style={{ color: fgColor }}
        >
          <ArrowBackIcon style={{ fontSize: 22 }} />
        </button>
        <h1 className="text-lg font-semibold">Reservations</h1>
      </div>

      {/* Tabs */}
      <div className="px-4 pb-1">
        <div className="flex rounded-full p-1" style={{ backgroundColor: `${fgColor}10` }}>
          {(['active', 'history'] as const).map((t2) => (
            <button
              key={t2}
              onClick={() => setTab(t2)}
              className={`flex-1 rounded-full py-2 text-xs font-semibold tracking-wide transition-all duration-200`}
              style={
                tab === t2
                  ? { backgroundColor: 'white', color: fgColor, boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }
                  : { color: `${fgColor}60` }
              }
            >
              {t(t2 === 'active' ? 'Active' : 'History')}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      <div className="px-4 py-3 flex flex-col gap-1">
        {visible.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16" style={{ color: `${fgColor}50` }}>
            <EventBusyIcon sx={{ fontSize: 48, mb: 1 }} />
            <p className="text-sm font-medium">
              {tab === 'active' ? t('No active reservations') : t('No past reservations')}
            </p>
          </div>
        )}
        {visible.map((reservation) => (
          <BrandedReservationCard
            key={reservation.id}
            reservation={reservation}
            fgColor={fgColor}
          />
        ))}
      </div>
    </div>
  )
}

function BrandedReservationCard({
  reservation,
  fgColor,
}: {
  reservation: Reservation
  fgColor: string
}) {
  const t = useTranslations('Reservations')
  const seatNumbers = reservation.items?.map((i) => i.number).join(', ')

  const dateContent =
    reservation.type === 'hours' ? (
      <>
        <div className="flex items-center gap-1.5 text-xs mb-1" style={{ color: `${fgColor}99` }}>
          <CalendarTodayIcon sx={{ fontSize: 13 }} style={{ color: `${fgColor}60` }} />
          <span>{dayjs(reservation.from).format('ddd, D MMM YYYY')}</span>
        </div>
        <div className="flex items-center gap-1.5 text-xs" style={{ color: `${fgColor}80` }}>
          <AccessTimeIcon sx={{ fontSize: 13 }} style={{ color: `${fgColor}60` }} />
          <span>
            {dayjs(reservation.from).format('HH:mm')} – {dayjs(reservation.to).format('HH:mm')}
          </span>
        </div>
      </>
    ) : (
      <div className="flex items-center gap-1.5 text-xs mb-1" style={{ color: `${fgColor}99` }}>
        <CalendarTodayIcon sx={{ fontSize: 13 }} style={{ color: `${fgColor}60` }} />
        <span>
          {dayjs(reservation.from).format('ddd, D MMM YYYY')} – {dayjs(reservation.to).format('ddd, D MMM YYYY')}
        </span>
      </div>
    )

  return (
    <Link href={`/reservations/${reservation.id}`}>
      <div
        className="rounded-xl px-4 py-3 border"
        style={{ backgroundColor: 'white', borderColor: `${fgColor}12` }}
      >
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            {dateContent}
            {seatNumbers && (
              <div className="flex items-center gap-1.5 text-xs mt-1" style={{ color: `${fgColor}80` }}>
                <EventSeatIcon sx={{ fontSize: 13 }} style={{ color: `${fgColor}60` }} />
                <span>{seatNumbers}</span>
              </div>
            )}
          </div>
          <div className="ml-3 flex-shrink-0">
            <Chip
              color={statusToChipColor[reservation.status]}
              label={t(getChipLabel(reservation))}
              sx={{ height: '24px', fontSize: '0.75rem' }}
            />
          </div>
        </div>
      </div>
    </Link>
  )
}
