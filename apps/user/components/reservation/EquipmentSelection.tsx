'use client'

import React from 'react'
import { RentalItemProps } from '@/app/sites/types'
import AddIcon from '@mui/icons-material/Add'
import RemoveIcon from '@mui/icons-material/Remove'
import IconButton from '@mui/material/IconButton'

const CATEGORY_EMOJI: Record<string, string> = {
  surfboard: '🏄',
  paddleboard: '🏄‍♂️',
  kayak: '🛶',
  umbrella: '⛱️',
  snorkel: '🤿',
  other: '📦',
}

interface RentalCartItem {
  rentalItemId: string
  quantity: number
}

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

  const getPrice = (item: RentalItemProps) => {
    if (durationType === 'hours' && item.pricePerHour) return `€${item.pricePerHour}/hr`
    if (item.pricePerDay) return `€${item.pricePerDay}/day`
    if (item.pricePerHour) return `€${item.pricePerHour}/hr`
    return ''
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-gray-400">
        <span className="text-3xl mb-2">🏄</span>
        <p className="text-sm">No equipment available</p>
      </div>
    )
  }

  return (
    <div className="overflow-y-auto h-full px-1 space-y-2 pb-2">
      {items.map(item => {
        const qty = getQuantity(item.id)
        const emoji = CATEGORY_EMOJI[item.category || 'other'] || '📦'
        const available = item.availableQuantity ?? item.totalQuantity

        return (
          <div
            key={item.id}
            className={`flex items-center gap-3 rounded-xl border p-3 transition-all ${
              qty > 0
                ? 'border-blue-300 bg-blue-50/50'
                : 'border-gray-200 bg-white'
            }`}
          >
            <span className="text-2xl flex-shrink-0">{emoji}</span>
            <div className="flex-1 min-w-0">
              <div className="font-medium text-sm text-gray-900 truncate">{item.name}</div>
              <div className="flex items-center gap-2 text-xs text-gray-500 mt-0.5">
                <span className="font-medium text-gray-700">{getPrice(item)}</span>
                <span>·</span>
                <span>{available} left</span>
              </div>
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              <IconButton
                size="small"
                disabled={qty === 0}
                onClick={() => setQuantity(item.id, qty - 1)}
                sx={{ 
                  width: 36, height: 36, 
                  border: '1px solid #e5e7eb',
                  '&:not(:disabled)': { borderColor: '#93c5fd' }
                }}
              >
                <RemoveIcon fontSize="small" />
              </IconButton>
              <span className={`w-8 text-center text-sm font-bold ${qty > 0 ? 'text-blue-600' : 'text-gray-300'}`}>
                {qty}
              </span>
              <IconButton
                size="small"
                disabled={qty >= available}
                onClick={() => setQuantity(item.id, qty + 1)}
                sx={{ 
                  width: 36, height: 36, 
                  border: '1px solid #e5e7eb',
                  '&:not(:disabled)': { borderColor: '#93c5fd', bgcolor: '#eff6ff' }
                }}
              >
                <AddIcon fontSize="small" />
              </IconButton>
            </div>
          </div>
        )
      })}
    </div>
  )
}
