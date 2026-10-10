'use client'

import { useEffect, useState, useTransition, type FormEvent } from 'react'
import logger from '@/utils/logger'
import { requestReceipt } from '@/app/reservations/[id]/receipt/actions'

import LaunchIcon from '@mui/icons-material/Launch'
import MailOutlineIcon from '@mui/icons-material/MailOutlined'
import CircularProgress from '@mui/material/CircularProgress'
import { useTranslations } from 'next-intl'
import { Fraunces } from 'next/font/google'
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
import { formatSeatId } from '@repo/data/seat-label'

// Status = green / blue / amber / red pills (.claude/rules/ui.md).
const PILL = {
  green: 'bg-green-50 border-green-200 text-green-700',
  blue: 'bg-blue-50 border-blue-200 text-blue-700',
  amber: 'bg-amber-50 border-amber-200 text-amber-700',
  red: 'bg-red-50 border-red-200 text-red-700',
} as const
const DOT = { green: 'bg-green-500', blue: 'bg-blue-500', amber: 'bg-amber-500', red: 'bg-red-500' } as const

const STATUS_CONFIG: Record<string, { text: string; tone: keyof typeof PILL }> = {
  [RESERVATION_COMPLETE]:  { text: 'PAID', tone: 'green' },
  reserved:                { text: 'RESERVED', tone: 'blue' },
  confirmed:               { text: 'Confirmed', tone: 'blue' },
  [RESERVATION_PROCESSING]:{ text: 'Processing', tone: 'amber' },
  [RESERVATION_PENDING]:   { text: 'Pending', tone: 'amber' },
  default:                 { text: 'Pending', tone: 'amber' },
  [RESERVATION_PAYMENT_FAILED]: { text: 'Payment failed', tone: 'red' },
  [RESERVATION_CANCELED]:  { text: 'Canceled', tone: 'red' },
  [RESERVATION_REFUNDED]:  { text: 'Refunded', tone: 'amber' },
}

// The landing page's display face, for the venue name on the ticket.
const display = Fraunces({ subsets: ['latin'], axes: ['SOFT', 'opsz'], display: 'swap' })

/** Small caps label above a value — ink at 70% keeps ≥4.5:1 on white. */
const LABEL = 'text-[10px] font-medium uppercase tracking-[0.16em] text-brand-ink/70'

export default function ReservationConfirmationView({
  reservation,
  processingStatus,
  amountDue,
  confirmationEmail,
} : {
  reservation: Reservation,
  processingStatus?: string
  /** Owed at the venue for an off-platform-billing booking (nothing was charged). */
  amountDue?: number | null
  /** Address the confirmation email went to; omitted when none was sent. */
  confirmationEmail?: string | null
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

  // Self-serve receipt-by-email for anonymous viewers (POS / QR walk-in have no
  // account and no captured email).
  const [email, setEmail] = useState('')
  const [receiptSent, setReceiptSent] = useState(false)
  const [receiptError, setReceiptError] = useState<string | null>(null)
  const [isSending, startSending] = useTransition()

  const handleEmailReceipt = (e: FormEvent) => {
    e.preventDefault()
    setReceiptError(null)
    startSending(async () => {
      const res = await requestReceipt(reservation.id, email)
      if (res.status === 'ok') setReceiptSent(true)
      else setReceiptError(res.errors?.[0] ?? t('Could not send the receipt'))
    })
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

  const seats = reservation.items?.map(item => formatSeatId(item)).join(', ')
  const showReceipt = status === RESERVATION_COMPLETE && !isUnpaid

  const paidAmount = reservation.paymentAmount ?? 0

  return (
    <div id="payment-status" className="min-h-full flex items-start sm:items-center justify-center px-5 pt-4 pb-10">
      <article className="w-full max-w-sm overflow-hidden rounded-[22px] bg-white ring-1 ring-brand-ink/[0.07]
                          shadow-[0_1px_2px_rgba(23,50,58,0.05),0_18px_40px_-18px_rgba(23,50,58,0.28)]">

        {/* ── Header: what this is, where, and its state ── */}
        <header className="px-6 pt-6 pb-5">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-brand-gold">
              {t('Sunbed reservation')}
            </span>
            <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold tracking-wide ${PILL[cfg.tone]}`}>
              {effectiveStatus === RESERVATION_PROCESSING ? (
                <CircularProgress size={10} thickness={6} sx={{ color: 'currentColor' }} />
              ) : (
                <span className={`h-1.5 w-1.5 rounded-full ${DOT[cfg.tone]}`} aria-hidden="true" />
              )}
              {ts(cfg.text)}
            </span>
          </div>
          <h1 className={`${display.className} mt-3 text-[28px] leading-[1.1] text-brand-ink text-balance`}>
            {reservation.site?.name}
          </h1>
        </header>

        {/* ── Perforation: notches take the page colour ── */}
        <div className="relative flex h-5 items-center" aria-hidden="true">
          <div className="absolute -left-2.5 h-5 w-5 rounded-full bg-cream ring-1 ring-inset ring-brand-ink/[0.07]" />
          <div className="absolute -right-2.5 h-5 w-5 rounded-full bg-cream ring-1 ring-inset ring-brand-ink/[0.07]" />
          <div className="mx-5 w-full border-t border-dashed border-brand-ink/15" />
        </div>

        {/* ── Details ── */}
        <dl className="grid grid-cols-2 gap-x-4 gap-y-5 px-6 pt-5 pb-6">
          <div className="col-span-2">
            <dt className={LABEL}>{t('SEATS')}</dt>
            <dd className="mt-1 text-[22px] font-semibold leading-tight tracking-tight text-brand-ink tabular-nums">{seats}</dd>
          </div>
          <div>
            <dt className={LABEL}>{t('VALID')}</dt>
            <dd className="mt-1 text-sm font-medium text-brand-ink">{validity}</dd>
          </div>
          {/* Amount — booleans, not `amount && …`: a 0 amount rendered as a stray "0". */}
          {paidAmount > 0 ? (
            <div className="text-right">
              <dt className={LABEL}>{status === RESERVATION_COMPLETE ? t('PAID ONLINE') : t('Amount')}</dt>
              <dd className="mt-1 text-sm font-semibold text-brand-ink tabular-nums">€{paidAmount.toFixed(2)}</dd>
            </div>
          ) : amountDue ? (
            <div className="text-right">
              <dt className={LABEL}>{t('PAY AT THE VENUE')}</dt>
              <dd className="mt-1 text-lg font-semibold leading-none text-brand-ink tabular-nums">€{amountDue.toFixed(2)}</dd>
            </div>
          ) : null}
        </dl>

        {amountDue && !(paidAmount > 0) ? (
          <p className="mx-6 mb-6 -mt-1 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-snug text-amber-800">
            {t('Nothing has been charged — you pay at the venue when you arrive')}
          </p>
        ) : null}

        {/* ── Where the confirmation went ── */}
        {confirmationEmail && (
          <div className="flex items-center justify-center gap-2 border-t border-brand-ink/6 px-6 py-3.5 text-xs text-brand-ink/70" role="status">
            <MailOutlineIcon sx={{ fontSize: 15 }} aria-hidden="true" />
            <span className="min-w-0 wrap-break-word">{t('Confirmation emailed to {email}', { email: confirmationEmail })}</span>
          </div>
        )}

        {/* ── Receipt ── */}
        {showReceipt && (
          <button
            onClick={() => window.open(authUrl(`/reservations/${reservation.id}/receipt`), '_blank')}
            className="flex w-full items-center justify-center gap-1.5 border-t border-brand-ink/6 px-6 py-3.5
                       text-xs font-semibold text-brand-ink hover:bg-cream-light active:bg-cream transition-colors"
          >
            {t('Open receipt')}
            <LaunchIcon sx={{ fontSize: 14 }} />
          </button>
        )}

        {/* ── Email-me-a-receipt — anonymous viewers only ── */}
        {showReceipt && !session?.user?.id && (
          <div className="border-t border-brand-ink/6 px-6 py-4">
            {receiptSent ? (
              <p className="text-center text-xs font-medium text-green-700" role="status">{t('Receipt sent')}</p>
            ) : (
              <form onSubmit={handleEmailReceipt} className="flex flex-col gap-2">
                <label htmlFor="receipt-email" className={`${LABEL} text-center`}>
                  {t('Email me a receipt')}
                </label>
                <input
                  id="receipt-email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder={t('Enter your email')}
                  className="w-full rounded-lg border border-brand-ink/15 px-3 py-2 text-sm text-brand-ink focus:border-brand-ink/40 focus:outline-hidden focus:ring-2 focus:ring-brand-ink/10"
                />
                {receiptError && <p className="text-center text-xs text-red-600" role="status">{receiptError}</p>}
                <button
                  type="submit"
                  disabled={isSending || email.trim().length === 0}
                  className="w-full rounded-lg bg-brand-ink py-2 text-sm font-semibold text-cream transition-colors hover:bg-brand-ink-hover disabled:opacity-40"
                >
                  {isSending ? '…' : t('Email receipt')}
                </button>
              </form>
            )}
          </div>
        )}

      </article>
    </div>
  )
}
