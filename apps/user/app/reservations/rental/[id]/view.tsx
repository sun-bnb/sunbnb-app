'use client'

import dayjs from 'dayjs'
import { useTranslations } from 'next-intl'
import SurfingIcon from '@mui/icons-material/Surfing'
import LaunchIcon from '@mui/icons-material/Launch'
import Link from 'next/link'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import {
  RENTAL_PENDING,
  RENTAL_COMPLETE,
  RENTAL_CANCELED,
  RENTAL_PAYMENT_FAILED,
  OP_RESERVED,
  OP_PICKED_UP,
  OP_RETURNED,
} from '@repo/data/reservation-status'

type Booking = {
  id: string
  siteId: string
  rentalItemId: string
  userId: string
  from: Date
  to: Date
  quantity: number
  durationType: string
  totalPrice: number
  status: string
  operationalStatus: string
  guestName: string | null
  paymentRef: string | null
  pickedUpAt: Date | null
  returnedAt: Date | null
  site: { id: string; name: string | null } | null
  rentalItem: { id: string; name: string; category: string | null } | null
}

const STATUS_CONFIG: Record<string, { text: string; textColor: string; dotColor: string }> = {
  [OP_RESERVED]:    { text: 'Reserved',       textColor: '#d97706', dotColor: '#f59e0b' },
  [OP_PICKED_UP]: { text: 'In use',         textColor: '#059669', dotColor: '#10b981' },
  [OP_RETURNED]:    { text: 'Returned',       textColor: '#6b7280', dotColor: '#9ca3af' },
  [RENTAL_PENDING]:     { text: 'Pending',        textColor: '#6b7280', dotColor: '#9ca3af' },
  [RENTAL_COMPLETE]:    { text: 'Paid',           textColor: '#118811', dotColor: '#22c55e' },
  [RENTAL_CANCELED]:    { text: 'Canceled',       textColor: '#dc2626', dotColor: '#ef4444' },
  [RENTAL_PAYMENT_FAILED]: { text: 'Payment failed', textColor: '#dc2626', dotColor: '#ef4444' },
}

export default function RentalBookingDetail({ booking }: { booking: Booking }) {

  const t = useTranslations('Reservations')
  const tr = useTranslations('Reservation')

  const isUnpaid = booking.status === RENTAL_COMPLETE && !booking.totalPrice
  const showReceipt = (booking.status === RENTAL_COMPLETE) && !isUnpaid && !!booking.paymentRef

  const siteName = booking.site?.name
  const itemName = booking.rentalItem?.name || 'Equipment'
  const category = booking.rentalItem?.category

  // Determine display status — prefer operational status if meaningful
  const displayStatus = booking.operationalStatus !== OP_RESERVED
    ? booking.operationalStatus
    : booking.status === RENTAL_COMPLETE && !booking.totalPrice
      ? OP_RESERVED
      : booking.status
  const cfg = STATUS_CONFIG[displayStatus] ?? STATUS_CONFIG.pending!

  // Format dates/times
  const isHours = booking.durationType === 'hours'

  const fromDate = dayjs(booking.from).format('ddd, D MMM YYYY')
  const toDate = dayjs(booking.to).format('ddd, D MMM YYYY')
  const fromTime = dayjs(booking.from).format('HH:mm')
  const toTime = dayjs(booking.to).format('HH:mm')

  const validity = isHours
    ? `${fromDate}, ${fromTime} – ${toTime}`
    : fromDate === toDate
      ? fromDate
      : `${fromDate} – ${toDate}`

  return (
    <div className="bg-cream min-h-screen flex flex-col px-5" style={{ paddingTop: '80px' }}>

      {/* Back link */}
      <Link href="/reservations" className="self-start mt-4 mb-2 flex items-center gap-1 text-sm text-brand-gold">
        <ArrowBackIcon sx={{ fontSize: 18 }} />
        <span>{t('Reservations')}</span>
      </Link>

      <div className="flex-1 flex items-center justify-center pb-8">
      <div className="w-full max-w-xs rounded-2xl bg-white shadow-card overflow-hidden">

        {/* ── Header: site + status ── */}
        <div className="px-6 pt-8 pb-5 text-center">
          <h1 className="text-xl font-bold tracking-tight text-brand-gold leading-snug">
            {siteName}
          </h1>
          <div className="mt-3 inline-flex items-center gap-1.5" style={{ color: cfg.textColor }}>
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: cfg.dotColor }} />
            <span className="text-xs font-semibold tracking-wide">{t(cfg.text)}</span>
          </div>
        </div>

        {/* ── Perforated divider ── */}
        <div className="relative h-6 flex items-center">
          <div className="absolute -left-3 w-6 h-6 rounded-full bg-cream" />
          <div className="absolute -right-3 w-6 h-6 rounded-full bg-cream" />
          <div className="w-full border-t-2 border-dashed border-neutral-200 mx-5" />
        </div>

        {/* ── Details ── */}
        <div className="px-6 pt-3 pb-5 text-center space-y-4">

          {/* Item */}
          <div>
            <div className="text-[10px] uppercase tracking-widest text-neutral-400 mb-1">{tr('EQUIPMENT')}</div>
            <div className="flex items-center justify-center gap-2">
              <SurfingIcon sx={{ fontSize: 28 }} className="text-brand-gold" />
              <div className="text-lg font-bold text-brand-gold">
                {itemName}
                {booking.quantity > 1 && <span className="text-base font-medium text-neutral-500"> ×{booking.quantity}</span>}
              </div>
            </div>
            {category && (
              <div className="text-xs text-neutral-400 mt-0.5">{category}</div>
            )}
          </div>

          {/* Date/Time */}
          <div>
            <div className="text-[10px] uppercase tracking-widest text-neutral-400 mb-0.5">VALID</div>
            <div className="text-sm font-medium text-neutral-700">{validity}</div>
          </div>

          {/* Amount */}
          {booking.totalPrice > 0 && (
            <div className="text-sm text-neutral-500">
              €{booking.totalPrice.toFixed(2)}
            </div>
          )}

          {/* Operational timestamps */}
          {booking.pickedUpAt && (
            <div className="text-xs text-neutral-400">
              {tr('Picked up')}: {dayjs(booking.pickedUpAt).format('HH:mm, D MMM')}
            </div>
          )}
          {booking.returnedAt && (
            <div className="text-xs text-neutral-400">
              {tr('Returned at')}: {dayjs(booking.returnedAt).format('HH:mm, D MMM')}
            </div>
          )}
        </div>

        {/* ── Receipt footer ── */}
        {showReceipt && (
          <button
            onClick={() => window.open(`/reservations/rental/${booking.id}/receipt`, '_blank')}
            className="w-full border-t border-neutral-100 px-6 py-3 flex items-center justify-center gap-1.5
                       text-xs font-medium text-neutral-500 hover:bg-neutral-50 active:bg-neutral-100 transition-colors"
          >
            {tr('Open receipt')}
            <LaunchIcon sx={{ fontSize: 14 }} />
          </button>
        )}

      </div>
      </div>
    </div>
  )
}
