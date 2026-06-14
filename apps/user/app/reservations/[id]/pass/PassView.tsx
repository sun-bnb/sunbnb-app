'use client'

import QRCodeLib from 'react-qr-code'
import { useTranslations } from 'next-intl'
import { Reservation } from '@/app/sites/types'
import { formatSeat } from '@repo/data/seat-label'

// Workaround: react-qr-code class component types are incompatible with React 18+ JSX
const QRCode = QRCodeLib as unknown as React.FC<{
  value: string
  size?: number
  level?: 'L' | 'M' | 'H' | 'Q'
  bgColor?: string
  fgColor?: string
}>

export default function PassView({
  reservation
} : {
  reservation: Reservation
}) {

  const t = useTranslations('Pass')
  const tr = useTranslations('Reservations')

  const fmtOpts: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }

  const validFrom = new Date(reservation.from).toLocaleDateString('en-US', fmtOpts)
  const validTo = new Date(reservation.to).toLocaleDateString('en-US', fmtOpts)
  const validity = validFrom === validTo ? validFrom : `${validFrom} – ${validTo}`

  const seats = reservation.items?.map(item => formatSeat(item)).join(', ')
  const seatCount = reservation.items?.length || 0

  const isPaid = reservation.paymentAmount && reservation.paymentAmount > 0

  return (
    <div className="min-h-screen bg-cream flex items-center justify-center px-5 py-8">
      <div className="w-full max-w-xs rounded-2xl bg-white shadow-card overflow-hidden">

        {/* ── Header ── */}
        <div className="bg-brand-gold px-6 pt-6 pb-5 text-center">
          <div className="text-[10px] uppercase tracking-[0.2em] text-cream/70">{t('Seating Pass')}</div>
          {reservation.site?.name && (
            <h1 className="mt-1.5 text-lg font-bold tracking-tight text-cream leading-snug">
              {reservation.site.name}
            </h1>
          )}
        </div>

        {/* ── QR Code ── */}
        <div className="px-8 pt-8 pb-6 flex justify-center">
          <div className="p-3 bg-white rounded-xl border border-subtle">
            <QRCode
              value={`reservation:${reservation.id}`}
              size={180}
              level="M"
              bgColor="#ffffff"
              fgColor="rgb(142,114,49)"
            />
          </div>
        </div>

        {/* ── Perforated divider ── */}
        <div className="relative h-6 flex items-center">
          <div className="absolute -left-3 w-6 h-6 rounded-full bg-cream" />
          <div className="absolute -right-3 w-6 h-6 rounded-full bg-cream" />
          <div className="w-full border-t-2 border-dashed border-neutral-200 mx-5" />
        </div>

        {/* ── Details ── */}
        <div className="px-6 pt-3 pb-6 text-center space-y-3">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-neutral-400 mb-0.5">{t('Seats')}</div>
            <div className="text-2xl font-bold text-brand-gold tabular-nums">{seats}</div>
            <div className="text-[11px] text-neutral-400">{seatCount} {seatCount === 1 ? t('seat') : t('seats')}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-widest text-neutral-400 mb-0.5">{t('Valid')}</div>
            <div className="text-sm font-medium text-neutral-700">{validity}</div>
          </div>
        </div>

        {/* ── Footer ── */}
        <div className="border-t border-neutral-100 px-6 py-3 text-center">
          <span className="text-xs font-semibold tracking-wide" style={{
            color: isPaid ? '#118811' : '#1e40af'
          }}>
            {isPaid ? tr('PAID') : tr('RESERVED')}
          </span>
        </div>

      </div>
    </div>
  )
}