'use client'

import { useRef, useState, useLayoutEffect, useEffect } from 'react'
import { Reservation } from '@/app/sites/types'
import ReservationConfirmationView from '@/components/reservation/confirmation/view'

interface ReservationViewProps {
  reservation: Reservation
}

export default function ReservationView({ reservation }: ReservationViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const resRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const touchStartY = useRef<number>(0)

  const [page, setPage] = useState<0 | 1>(0)
  const [resScrollable, setResScrollable] = useState(false)

  // Measure whether reservation content overflows
  useLayoutEffect(() => {
    const el = resRef.current
    if (el) {
      setResScrollable(el.scrollHeight > el.clientHeight)
    }
  }, [reservation])

  // Update on resize
  useEffect(() => {
    const handleResize = () => {
      const el = resRef.current
      if (el) {
        setResScrollable(el.scrollHeight > el.clientHeight)
      }
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // Switch pages and reset scroll positions
  const goToPage = (p: 0 | 1) => {
    setPage(p)
    // scroll both views to top
    if (resRef.current) resRef.current.scrollTop = 0
    if (menuRef.current) menuRef.current.scrollTop = 0
  }

  // Swipe detection
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
      className="relative w-full overflow-hidden bg-[#fff5e1]"
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
        {/* Page 0: Reservation */}
        <div className="flex flex-col w-full" style={{ height: '100dvh' }}>
          {/* Content: only scroll if it overflows */}
          <div
            ref={resRef}
            className={resScrollable ? 'overflow-y-auto flex-1' : 'overflow-hidden flex-1'}
            style={{ overscrollBehavior: 'contain' }}
          >
            <ReservationConfirmationView reservation={reservation} />
          </div>
          <button
            onClick={() => goToPage(1)}
            className="h-12 w-full bg-[#00cef1] text-[#fff5e1] font-bold text-lg"
          >
            FOOD AND DRINKS
          </button>
        </div>

        {/* Page 1: Menu */}
        <div className="flex flex-col w-full bg-white" style={{ height: '100dvh' }}>
          <div
            ref={menuRef}
            className="overflow-y-auto flex-1"
            style={{ overscrollBehavior: 'contain' }}
          >
            <div className="p-4 pt-6 space-y-4">
              {/* …your menu items… */}
              <ul className="space-y-4">
                <li>☀️ Cold Drink — $3.50</li>
                <li>🥤 Smoothie — $5.00</li>
                <li>🍹 Cocktail — $7.00</li>
                <li>🧋 Bubble Tea — $4.00</li>
                <li>🍦 Ice Cream — $2.50</li>
              </ul>
            </div>
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
