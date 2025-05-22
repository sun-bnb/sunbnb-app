'use client'

import { useRef, useState } from 'react'
import { Reservation } from '@/app/sites/types'
import ReservationConfirmationView from '@/components/reservation/confirmation/view'

interface ReservationViewProps {
  reservation: Reservation
}

export default function ReservationView({ reservation }: ReservationViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [page, setPage] = useState<0 | 1>(0)
  const touchStartY = useRef<number>(0)

  const goToPage = (p: 0 | 1) => setPage(p)

  const onTouchStart = (e: React.TouchEvent) => {
    touchStartY.current = e.touches[0]!.clientY
  }
  const onTouchEnd = (e: React.TouchEvent) => {
    const delta = e.changedTouches[0]!.clientY - touchStartY.current
    const threshold = 50
    if (delta < -threshold && page === 0) goToPage(1)
    else if (delta > threshold && page === 1) goToPage(0)
  }

  return (
    <div
      ref={containerRef}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      className="relative w-full overflow-hidden"
      style={{ height: '100dvh' }}
    >
      <div
        className="transition-transform duration-500 ease-out"
        style={{
          height: '200dvh',
          width: '100vw',
          transform: `translateY(-${page * 100}dvh)`,
        }}
      >
        {/* PAGE 0: Reservation */}
        <div className="flex flex-col w-full" style={{ height: '100dvh' }}>
          <div className="flex-1 overflow-y-auto">
            <ReservationConfirmationView reservation={reservation} />
          </div>
          <button
            onClick={() => goToPage(1)}
            className="h-12 w-full bg-[#00cef1] text-[#fff5e1] font-bold text-lg"
          >
            FOOD AND DRINKS
          </button>
        </div>

        {/* PAGE 1: Menu */}
        <div className="flex flex-col w-full bg-white" style={{ height: '100dvh' }}>
          <div className="flex-1 overflow-y-auto px-4 pt-6 pb-4">
            {/* Replace with your actual menu items */}
            <ul className="space-y-4">
              <li>☀️ Cold Drink — $3.50</li>
              <li>🥤 Smoothie — $5.00</li>
              <li>🍹 Cocktail — $7.00</li>
              <li>🧋 Bubble Tea — $4.00</li>
              <li>🍦 Ice Cream — $2.50</li>
            </ul>
          </div>
          <button
            onClick={() => goToPage(0)}
            className="h-12 w-full bg-[#00cef1] text-[#fff5e1] font-bold text-lg"
          >
            BACK TO RESERVATION
          </button>
        </div>
      </div>
    </div>
  )
}
