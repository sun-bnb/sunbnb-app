'use client'

import { useEffect, useState } from 'react'
import logger from '@/utils/logger'

import LaunchIcon from '@mui/icons-material/Launch'
import QrCode2Icon from '@mui/icons-material/QrCode2'
import CircularProgress from '@mui/material/CircularProgress'
import { useTranslations } from 'next-intl'
import { useSession } from 'next-auth/react'
import { Reservation } from '@/app/sites/types'
import {
  RESERVATION_COMPLETE,
  RESERVATION_PROCESSING,
  RESERVATION_PENDING,
  RESERVATION_PAYMENT_FAILED,
  RESERVATION_CANCELED,
  RESERVATION_REFUNDED,
} from '@repo/data/reservation-status'

const STATUS_CONFIG: {
  [key: string]: {
    text: string
    textColor: string
    dotColor: string
  }
} = {
  [RESERVATION_COMPLETE]:  { text: 'PAID',             textColor: '#118811', dotColor: '#22c55e' },
  reserved:  { text: 'RESERVED',         textColor: '#1e40af', dotColor: '#3b82f6' },
  [RESERVATION_PROCESSING]:{ text: 'Processing',       textColor: '#6b7280', dotColor: '#9ca3af' },
  confirmed: { text: 'Confirmed',        textColor: '#1e40af', dotColor: '#3b82f6' },
  default:   { text: 'Pending',          textColor: '#6b7280', dotColor: '#9ca3af' },
  [RESERVATION_PENDING]:   { text: 'Pending',          textColor: '#6b7280', dotColor: '#9ca3af' },
  [RESERVATION_PAYMENT_FAILED]: { text: 'Payment failed', textColor: '#dc2626', dotColor: '#ef4444' },
  [RESERVATION_CANCELED]:  { text: 'Canceled',         textColor: '#dc2626', dotColor: '#ef4444' },
  [RESERVATION_REFUNDED]:  { text: 'Refunded',         textColor: '#6b7280', dotColor: '#9ca3af' },
}

export default function ReservationConfirmationView({
  reservation,
  processingStatus
} : {
  reservation: Reservation,
  processingStatus?: string
}) {

  const t = useTranslations('Reservation')
  const ts = useTranslations('Reservations')
  const { data: session } = useSession()

  // Read anonId from localStorage for anonymous users (pass/receipt link auth)
  const [anonId, setAnonId] = useState<string | null>(null)
  useEffect(() => {
    if (!session?.user?.id) {
      const stored = localStorage.getItem('sunbnb-anonId')
      setAnonId(stored)
    }
  }, [session?.user?.id])

  /** Build a pass/receipt URL with anonId for anonymous users */
  const authUrl = (path: string) => {
    if (session?.user?.id) return path
    return anonId ? `${path}?anonId=${anonId}` : path
  }

  logger.debug('Reservation confirmation', reservation)

  const fmtOpts: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }

  const validFrom = new Date(reservation.from).toLocaleDateString('en-US', fmtOpts)
  const validTo = new Date(reservation.to).toLocaleDateString('en-US', fmtOpts)
  const validity = validFrom === validTo ? validFrom : `${validFrom} – ${validTo}`

  const isUnpaid = reservation.status === RESERVATION_COMPLETE && !reservation.paymentAmount
  const status = isUnpaid ? 'reserved' : reservation.status
  const effectiveStatus = processingStatus || status
  const cfg = STATUS_CONFIG[effectiveStatus] ?? STATUS_CONFIG.default!

  const seats = reservation.items?.map(item => String(item.number)).join(', ')
  const showQr = status === RESERVATION_COMPLETE || status === 'reserved'
  const showReceipt = status === RESERVATION_COMPLETE && !isUnpaid

  return (
    <div id="payment-status" className="bg-cream min-h-full flex items-center justify-center px-5 py-8">
      <div className="w-full max-w-xs rounded-2xl bg-white shadow-card overflow-hidden">

        {/* ── Header: site + status ── */}
        <div className="px-6 pt-8 pb-5 text-center">
          <h1 className="text-xl font-bold tracking-tight text-brand-gold leading-snug">
            {reservation.site?.name}
          </h1>
          <div className="mt-3 inline-flex items-center gap-1.5" style={{ color: cfg.textColor }}>
            {effectiveStatus === RESERVATION_PROCESSING ? (
              <CircularProgress size={12} thickness={5} sx={{ color: cfg.textColor }} />
            ) : (
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: cfg.dotColor }} />
            )}
            <span className="text-xs font-semibold tracking-wide">{ts(cfg.text)}</span>
          </div>
        </div>

        {/* ── Perforated divider ── */}
        <div className="relative h-6 flex items-center">
          <div className="absolute -left-3 w-6 h-6 rounded-full bg-cream" />
          <div className="absolute -right-3 w-6 h-6 rounded-full bg-cream" />
          <div className="w-full border-t-2 border-dashed border-neutral-200 mx-5" />
        </div>

        {/* ── Details ── */}
        <div className="px-6 pt-3 pb-5 text-center space-y-3">
          {/* Seats */}
          <div>
            <div className="text-[10px] uppercase tracking-widest text-neutral-400 mb-0.5">{t('SEATS')}</div>
            <div className="text-2xl font-bold text-brand-gold tabular-nums">{seats}</div>
          </div>
          {/* Date */}
          <div>
            <div className="text-[10px] uppercase tracking-widest text-neutral-400 mb-0.5">{t('VALID')}</div>
            <div className="text-sm font-medium text-neutral-700">{validity}</div>
          </div>
          {/* Amount */}
          {reservation.paymentAmount && reservation.paymentAmount > 0 && (
            <div className="text-sm text-neutral-500">
              €{reservation.paymentAmount.toFixed(2)}
            </div>
          )}
        </div>

        {/* ── QR section ── */}
        {showQr && (
          <>
            <div className="relative h-6 flex items-center">
              <div className="absolute -left-3 w-6 h-6 rounded-full bg-cream" />
              <div className="absolute -right-3 w-6 h-6 rounded-full bg-cream" />
              <div className="w-full border-t-2 border-dashed border-neutral-200 mx-5" />
            </div>
            <div className="px-6 pt-4 pb-5 flex flex-col items-center">
              <button
                onClick={() => window.open(authUrl(`/reservations/${reservation.id}/pass`), '_blank')}
                className="text-brand-gold active:scale-95 transition-transform"
              >
                <QrCode2Icon sx={{ fontSize: 72 }} />
              </button>
              <span className="mt-1 text-[10px] text-neutral-400 tracking-wide">{t('Tap to open pass')}</span>
            </div>
          </>
        )}

        {/* ── Receipt footer ── */}
        {showReceipt && (
          <button
            onClick={() => window.open(authUrl(`/reservations/${reservation.id}/receipt`), '_blank')}
            className="w-full border-t border-neutral-100 px-6 py-3 flex items-center justify-center gap-1.5
                       text-xs font-medium text-neutral-500 hover:bg-neutral-50 active:bg-neutral-100 transition-colors"
          >
            {t('Open receipt')}
            <LaunchIcon sx={{ fontSize: 14 }} />
          </button>
        )}

      </div>
    </div>
  )
}
