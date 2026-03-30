'use client'

import React, { useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { RentalItemProps } from '@/types/shared'
import { createWalkInRental } from './actions'

/**
 * Walk-in rental modal — designed for surf instructors.
 *
 * Happy path: tap a board → tap GO. 2 taps total.
 * Everything else (guest name, duration, payment) is tucked behind
 * a "More" toggle so it doesn't clutter the screen.
 *
 * Items are big tappable cards. Single tap = add 1. Tap again = add more.
 * Green highlight + big number = selected. Obvious in sunlight.
 */
export default function CreateRentalModal({
  siteId,
  rentalItems,
  activeBookings,
  accessKey,
  onClose,
  onCreated,
}: {
  siteId: string
  rentalItems: RentalItemProps[]
  activeBookings?: { rentalItemId: string; quantity: number }[]
  accessKey?: string
  onClose: () => void
  onCreated: () => void
}) {
  // Compute available stock per item (totalQuantity minus currently rented out)
  const rentedOut: Record<string, number> = {}
  for (const b of activeBookings ?? []) {
    rentedOut[b.rentalItemId] = (rentedOut[b.rentalItemId] || 0) + b.quantity
  }
  const [durationType, setDurationType] = useState<'hours' | 'days'>('hours')
  const [hours, setHours] = useState(1)
  const [paymentType, setPaymentType] = useState<'cash' | 'free'>('cash')
  const [guestName, setGuestName] = useState('')
  const [showMore, setShowMore] = useState(false)
  // Pre-select the first item with qty 1 if there's only one equipment type
  const [cart, setCart] = useState<Record<string, number>>(() => {
    if (rentalItems.length === 1 && rentalItems[0]!.totalQuantity - (rentedOut[rentalItems[0]!.id] || 0) > 0) {
      return { [rentalItems[0]!.id]: 1 }
    }
    return {}
  })
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const t = useTranslations('CreateRentalModal')

  function addOne(itemId: string, max: number) {
    setCart(prev => {
      const current = prev[itemId] || 0
      if (current >= max) return prev
      return { ...prev, [itemId]: current + 1 }
    })
  }

  function removeOne(itemId: string) {
    setCart(prev => {
      const current = prev[itemId] || 0
      if (current <= 0) return prev
      const copy = { ...prev }
      if (current === 1) delete copy[itemId]
      else copy[itemId] = current - 1
      return copy
    })
  }

  const totalItems = Object.values(cart).reduce((s, q) => s + q, 0)

  // Calculate total price
  const totalPrice = Object.entries(cart).reduce((sum, [itemId, qty]) => {
    const item = rentalItems.find(i => i.id === itemId)
    if (!item || paymentType === 'free') return sum
    if (durationType === 'hours' && item.pricePerHour) {
      return sum + item.pricePerHour * hours * qty
    }
    if (item.pricePerDay) return sum + item.pricePerDay * qty
    if (item.pricePerHour) return sum + item.pricePerHour * hours * qty
    return sum
  }, 0)

  function handleSubmit() {
    if (totalItems === 0) {
      setError(t('tapItemFirst'))
      return
    }
    setError(null)
    startTransition(async () => {
      const items = Object.entries(cart).map(([rentalItemId, quantity]) => ({
        rentalItemId,
        quantity,
      }))
      const result = await createWalkInRental({
        siteId,
        items,
        durationType,
        hours: durationType === 'hours' ? hours : undefined,
        guestName: guestName || undefined,
        paymentType,
        accessKey,
      })
      if (result.status === 'ok') {
        onCreated()
      } else {
        setError(result.errors?.[0] || t('failed'))
      }
    })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 sm:p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-white w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl shadow-xl overflow-hidden max-h-[92vh] sm:max-h-[90vh] flex flex-col">
        {/* Header — big close target */}
        <div className="flex items-center justify-between px-5 py-3 border-b-2 border-gray-200">
          <h2 className="text-xl font-black text-gray-900">🏄 {t('title')}</h2>
          <button onClick={onClose} className="text-gray-400 text-4xl leading-none p-3 -mr-2">&times;</button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-3">

          {/* ── Equipment — BIG tappable cards, the main UI ── */}
          <div className="space-y-2">
            {rentalItems.map(item => {
              const qty = cart[item.id] || 0
              const selected = qty > 0

              return (
                <div
                  key={item.id}
                  className={`
                    rounded-2xl border-3 overflow-hidden transition-colors select-none
                    ${selected ? 'border-green-500 bg-green-50' : 'border-gray-200 bg-white'}
                  `}
                >
                  {/* Tappable area — tap anywhere to add 1 */}
                  <button
                    onClick={() => addOne(item.id, item.totalQuantity - (rentedOut[item.id] || 0))}
                    className="w-full text-left px-4 py-4 active:bg-gray-50"
                  >
                    <div className="flex items-center justify-between">
                      <div className="min-w-0">
                        <div className="text-lg font-black truncate">{item.name}</div>
                        <div className="text-sm font-bold text-gray-400">
                          {t('available', { n: item.totalQuantity - (rentedOut[item.id] || 0) })}
                        </div>
                      </div>
                      {selected ? (
                        <span className="text-3xl font-black text-green-600 flex-shrink-0 ml-3">
                          {qty}
                        </span>
                      ) : (
                        <span className="text-2xl text-gray-300 flex-shrink-0 ml-3">+</span>
                      )}
                    </div>
                  </button>

                  {/* Quantity adjust — only shows when selected */}
                  {selected && (
                    <div className="flex border-t-2 border-green-200">
                      <button
                        onClick={() => removeOne(item.id)}
                        className="flex-1 py-3 text-xl font-black text-red-500 active:bg-red-50 border-r border-green-200"
                      >−</button>
                      <button
                        onClick={() => addOne(item.id, item.totalQuantity - (rentedOut[item.id] || 0))}
                        disabled={qty >= item.totalQuantity - (rentedOut[item.id] || 0)}
                        className="flex-1 py-3 text-xl font-black text-green-600 active:bg-green-100 disabled:opacity-30"
                      >+</button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* ── Duration quick-pick — visible but compact ── */}
          <div className="flex items-center gap-2">
            {[1, 2, 3].map(h => (
              <button
                key={h}
                onClick={() => { setDurationType('hours'); setHours(h) }}
                className={`
                  flex-1 py-3 text-base font-black rounded-xl border-2 select-none
                  ${durationType === 'hours' && hours === h
                    ? 'bg-gray-900 text-white border-gray-900'
                    : 'bg-white text-gray-600 border-gray-300 active:border-gray-500'
                  }
                `}
              >
                {h}h
              </button>
            ))}
            <button
              onClick={() => setDurationType('days')}
              className={`
                flex-1 py-3 text-base font-black rounded-xl border-2 select-none
                ${durationType === 'days'
                  ? 'bg-gray-900 text-white border-gray-900'
                  : 'bg-white text-gray-600 border-gray-300 active:border-gray-500'
                }
              `}
            >
              {t('allDay')}
            </button>
          </div>

          {/* ── More options — hidden by default ── */}
          <button
            onClick={() => setShowMore(v => !v)}
            className="w-full text-sm font-bold text-gray-400 py-1 active:text-gray-600 select-none"
          >
            {showMore ? t('lessOptions') : t('moreOptions')}
          </button>

          {showMore && (
            <div className="space-y-3 pb-1">
              {/* Guest name */}
              <input
                type="text"
                value={guestName}
                onChange={e => setGuestName(e.target.value)}
                placeholder={t('guestNameOptional')}
                className="w-full border-2 rounded-xl px-4 py-3.5 text-base"
              />

              {/* Custom hours (if > 3) */}
              {durationType === 'hours' && (
                <div className="flex items-center gap-3 justify-center">
                  <button
                    onClick={() => setHours(h => Math.max(1, h - 1))}
                    className="w-14 h-14 text-2xl font-black rounded-xl border-2 border-gray-300 active:bg-gray-100 select-none"
                  >−</button>
                  <span className="text-2xl font-black w-16 text-center">{hours}h</span>
                  <button
                    onClick={() => setHours(h => Math.min(12, h + 1))}
                    className="w-14 h-14 text-2xl font-black rounded-xl border-2 border-gray-300 active:bg-gray-100 select-none"
                  >+</button>
                </div>
              )}

              {/* Payment */}
              <div className="flex gap-3">
                <button
                  onClick={() => setPaymentType('cash')}
                  className={`flex-1 py-3.5 text-base font-black rounded-xl border-2 select-none ${
                    paymentType === 'cash'
                      ? 'bg-gray-900 text-white border-gray-900'
                      : 'bg-white text-gray-600 border-gray-300'
                  }`}
                >
                  💵 {t('cash')}
                </button>
                <button
                  onClick={() => setPaymentType('free')}
                  className={`flex-1 py-3.5 text-base font-black rounded-xl border-2 select-none ${
                    paymentType === 'free'
                      ? 'bg-gray-900 text-white border-gray-900'
                      : 'bg-white text-gray-600 border-gray-300'
                  }`}
                >
                  🆓 {t('free')}
                </button>
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="text-lg font-black text-red-600 bg-red-50 px-4 py-3 rounded-xl border-2 border-red-200 text-center">
              {error}
            </div>
          )}
        </div>

        {/* Footer — giant GO button */}
        <div className="px-3 sm:px-4 py-3 border-t-2 border-gray-200"
             style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom, 0.75rem))' }}>
          <button
            disabled={isPending || totalItems === 0}
            onClick={handleSubmit}
            className={`
              w-full font-black py-5 rounded-2xl text-xl select-none transition-colors
              ${totalItems > 0
                ? 'bg-green-600 text-white active:bg-green-700'
                : 'bg-gray-200 text-gray-400'
              }
              disabled:opacity-50
            `}
          >
            {isPending ? '...' : totalItems === 0
              ? t('tapItem')
              : paymentType === 'free'
                ? t('goFree', { n: totalItems })
                : t('goPrice', { price: totalPrice.toFixed(2) })
            }
          </button>
        </div>
      </div>
    </div>
  )
}
