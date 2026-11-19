'use client'

import React from 'react'
import { RentalItemProps } from '@/app/sites/types'
import { useTranslations } from 'next-intl'

const CATEGORY_EMOJI: Record<string, string> = {
  surfboard: '🏄',
  paddleboard: '🏄‍♂️',
  kayak: '🛶',
  pedalboat: '🚤',
  snorkel: '🤿',
  other: '📦',
}

interface RentalCartItem {
  rentalItemId: string
  quantity: number
}

/** The unit price for the current booking mode — what the item costs per hour or per day. */
export function unitPrice(item: RentalItemProps, durationType: string): number | null {
  const price = durationType === 'hours' ? item.pricePerHour : item.pricePerDay
  return price != null && price > 0 ? price : null
}

const QTY_BTN =
  'flex h-9 w-9 items-center justify-center rounded-full border transition-colors ' +
  'disabled:cursor-not-allowed disabled:border-brand-ink/10 disabled:text-brand-ink/20 ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-ink'

function Glyph({ d }: { d: string }) {
  return (
    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d={d} />
    </svg>
  )
}

/**
 * The equipment list in the booking sheet. Only items bookable in the current
 * mode are passed in (see `EquipmentBookingSection`), so every price shown is
 * the price that will be charged.
 */
export default function EquipmentSelection({
  items,
  cart,
  onCartChange,
  durationType,
}: {
  items: RentalItemProps[]
  cart: RentalCartItem[]
  onCartChange: (cart: RentalCartItem[]) => void
  durationType: string
}) {
  const t = useTranslations('SiteView')

  const getQuantity = (itemId: string) =>
    cart.find(c => c.rentalItemId === itemId)?.quantity || 0

  const setQuantity = (itemId: string, qty: number) => {
    const item = items.find(i => i.id === itemId)
    if (!item) return
    const max = item.availableQuantity ?? item.totalQuantity
    const clamped = Math.max(0, Math.min(qty, max))

    if (clamped === 0) {
      onCartChange(cart.filter(c => c.rentalItemId !== itemId))
    } else {
      const existing = cart.find(c => c.rentalItemId === itemId)
      if (existing) {
        onCartChange(cart.map(c => c.rentalItemId === itemId ? { ...c, quantity: clamped } : c))
      } else {
        onCartChange([...cart, { rentalItemId: itemId, quantity: clamped }])
      }
    }
  }

  if (items.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center text-brand-ink/50">
        <span className="mb-2 text-3xl">🏄</span>
        <p className="text-sm">{t('No equipment available')}</p>
      </div>
    )
  }

  return (
    // The bottom fade says "more below" where the list runs under the footer.
    <div className="h-full space-y-2 overflow-y-auto pt-1.5 pb-4 [mask-image:linear-gradient(to_bottom,black_calc(100%-20px),transparent)]">
      {items.map(item => {
        const qty = getQuantity(item.id)
        const emoji = CATEGORY_EMOJI[item.category || 'other'] || '📦'
        const available = item.availableQuantity ?? item.totalQuantity
        const price = unitPrice(item, durationType)
        const soldOut = available <= 0

        return (
          <div
            key={item.id}
            className={`flex items-center gap-2.5 rounded-xl border bg-white py-2.5 pr-2.5 pl-3 text-left transition-colors ${
              qty > 0 ? 'border-brand-ink/40 shadow-soft' : 'border-brand-ink/10'
            } ${soldOut ? 'opacity-60' : ''}`}
          >
            <span className="shrink-0 text-2xl leading-none" aria-hidden="true">{emoji}</span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-brand-ink">{item.name}</div>
              {/* Two nowrap units: on a narrow phone "10 left" moves to its own
                  line whole instead of the price breaking mid-phrase. */}
              <div className="mt-0.5 flex flex-wrap items-baseline gap-x-1.5 text-xs leading-snug">
                {price != null && (
                  <span className="whitespace-nowrap font-medium text-brand-ink/80 tabular-nums">
                    €{price} {durationType === 'hours' ? t('per hour') : t('per day')}
                  </span>
                )}
                <span className={`whitespace-nowrap ${available <= 2 ? 'text-amber-700' : 'text-brand-ink/55'}`}>
                  {available} {t('left')}
                </span>
              </div>
            </div>
            <div className="flex shrink-0 items-center" role="group" aria-label={item.name}>
              <button
                type="button"
                className={`${QTY_BTN} border-brand-ink/20 text-brand-ink hover:border-brand-ink/40`}
                disabled={qty === 0}
                onClick={() => setQuantity(item.id, qty - 1)}
                aria-label={`${t('Remove')} ${item.name}`}
              >
                <Glyph d="M5 10h10" />
              </button>
              <span
                className={`w-7 text-center text-sm font-semibold tabular-nums ${qty > 0 ? 'text-brand-ink' : 'text-brand-ink/30'}`}
                aria-live="polite"
              >
                {qty}
              </span>
              <button
                type="button"
                // Outlined until the item is in the cart: a column of filled dark
                // dots would compete with Reserve, the sheet's one dark action.
                className={`${QTY_BTN} ${
                  qty > 0
                    ? 'border-brand-ink bg-brand-ink text-white hover:bg-brand-ink-hover disabled:bg-transparent'
                    : 'border-brand-ink/40 text-brand-ink hover:border-brand-ink'
                }`}
                disabled={qty >= available}
                onClick={() => setQuantity(item.id, qty + 1)}
                aria-label={`${t('Add')} ${item.name}`}
              >
                <Glyph d="M10 5v10M5 10h10" />
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
