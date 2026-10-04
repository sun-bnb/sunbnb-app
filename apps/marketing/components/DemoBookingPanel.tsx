'use client'

import { useTranslations } from 'next-intl'
import { useEffect, useState, type FC } from 'react'
import QRCodeLib from 'react-qr-code'
import type { MockSunbed } from '@/lib/beach-layout.ts'

// react-qr-code types against the hoisted @types/react 19; re-type for this app's React 18 types
// (same cast as apps/user PassView).
const QRCode = QRCodeLib as unknown as FC<{ value: string; size?: number; style?: React.CSSProperties }>

type Step = 'details' | 'checkout' | 'pass'

const DEFAULT_PRICE_EUR = 20

/**
 * The guest's side of a booking, played out on the prospect's own beach. Entirely client-side:
 * nothing is reserved, charged or stored — the panel says so at the payment step.
 */
export default function DemoBookingPanel({
  bed,
  bookedCount,
  onBooked,
  onDone,
}: {
  bed: MockSunbed | null
  bookedCount: number
  onBooked: (label: string) => void
  onDone: () => void
}) {
  const t = useTranslations('Booking')
  const [step, setStep] = useState<Step>('details')
  // The prospect's OWN price, typed by them — never a figure we suggest as theirs.
  const [price, setPrice] = useState(String(DEFAULT_PRICE_EUR))

  useEffect(() => setStep('details'), [bed?.label])

  const priceNum = Math.max(0, Math.min(9999, Number(price) || 0))
  const rowLabel = bed ? (bed.row === 0 ? t('rowFront') : t('rowN', { row: String.fromCharCode(65 + bed.row) })) : ''

  return (
    <aside className="card h-fit p-5 shadow-sm" aria-live="polite">
      <h2 className="text-sm font-semibold text-gray-900">{t('title')}</h2>

      {!bed && <p className="mt-2 text-sm text-gray-600">{t('empty')}</p>}

      {bed && step === 'details' && (
        <div className="mt-3 space-y-4">
          <div>
            <p className="text-lg font-semibold text-gray-900">{t('bed', { label: bed.label })}</p>
            <p className="text-sm text-gray-500">
              {rowLabel} · {t('date')}
            </p>
          </div>
          <div>
            <label htmlFor="demo-price" className="label">
              {t('priceLabel')}
            </label>
            <input
              id="demo-price"
              className="input"
              inputMode="decimal"
              value={price}
              onChange={(e) => setPrice(e.target.value.replace(/[^\d.]/g, '').slice(0, 6))}
            />
          </div>
          <button type="button" className="btn-primary w-full" onClick={() => setStep('checkout')}>
            {t('book')}
          </button>
        </div>
      )}

      {bed && step === 'checkout' && (
        <div className="mt-3 space-y-4">
          <p className="text-sm font-medium text-gray-700">{t('checkoutTitle')}</p>
          <div className="flex justify-between border-y border-gray-100 py-3 text-sm">
            <span className="text-gray-600">
              {t('bed', { label: bed.label })} · {t('date')}
            </span>
            <span className="font-semibold text-gray-900">€{priceNum}</span>
          </div>
          <p className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700">{t('demoNote')}</p>
          <button
            type="button"
            className="btn-primary w-full"
            onClick={() => {
              onBooked(bed.label)
              setStep('pass')
            }}
          >
            {t('pay', { price: priceNum })}
          </button>
          <button type="button" className="btn-ghost w-full" onClick={() => setStep('details')}>
            {t('back')}
          </button>
        </div>
      )}

      {bed && step === 'pass' && (
        <div className="mt-3 space-y-4 text-center">
          <p className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm font-medium text-green-700">{t('passTitle')}</p>
          <div className="mx-auto w-40 rounded-xl border border-gray-200 bg-white p-3">
            <QRCode value={`SUNBNB-DEMO:${bed.label}`} size={136} style={{ width: '100%', height: 'auto' }} />
          </div>
          <p className="text-lg font-semibold text-gray-900">{t('bed', { label: bed.label })}</p>
          <p className="text-sm text-gray-600">{t('passBody')}</p>
          <button type="button" className="btn-ghost" onClick={onDone}>
            {t('another')}
          </button>
        </div>
      )}

      {bookedCount > 0 && <p className="mt-4 text-xs text-gray-400">{t('bookedCount', { count: bookedCount })}</p>}
    </aside>
  )
}
