'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import CreateReservationModal from './CreateReservationModal'
import { RESERVATION_CANCELED, RESERVATION_PENDING } from '@repo/data/reservation-status'

/* ── Types ──────────────────────────────────────────────────── */

interface SiteData {
  id: string
  name: string
  itemCount: number
}

interface DayReservation {
  id: string
  from: string
  to: string
  status: string
  userName: string
  userEmail: string
  itemCount: number
}

interface DayCount {
  date: string   // YYYY-MM-DD
  count: number
}

/* ── Helpers ────────────────────────────────────────────────── */

function daysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate()
}

function startDayOfMonth(year: number, month: number) {
  // 0 = Sun → shift to Mon-start: (day + 6) % 7
  return (new Date(year, month, 1).getDay() + 6) % 7
}

function isSameDay(a: string, b: string) {
  return a.slice(0, 10) === b.slice(0, 10)
}

function isToday(dateStr: string) {
  return dateStr === new Date().toISOString().slice(0, 10)
}

function formatDateLong(dateStr: string) {
  const d = new Date(dateStr + 'T12:00:00')
  return d.toLocaleDateString('en', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

function formatDateRange(from: string, to: string) {
  const f = new Date(from)
  const t = new Date(to)
  const fStr = f.toLocaleDateString('en', { day: 'numeric', month: 'short' })
  const tStr = t.toLocaleDateString('en', { day: 'numeric', month: 'short' })
  if (fStr === tStr) return fStr
  return `${fStr} – ${tStr}`
}

function daysBetween(from: string, to: string) {
  const f = new Date(from)
  const t = new Date(to)
  return Math.max(1, Math.round((t.getTime() - f.getTime()) / (1000 * 60 * 60 * 24)))
}

function statusColor(status: string) {
  switch (status) {
    case 'confirmed': return 'bg-emerald-500'
    case RESERVATION_PENDING: return 'bg-amber-400'
    case RESERVATION_CANCELED: return 'bg-red-400'
    default: return 'bg-gray-400'
  }
}

function statusBadge(status: string) {
  const styles: Record<string, string> = {
    confirmed: 'bg-emerald-50 text-emerald-700',
    [RESERVATION_PENDING]: 'bg-amber-50 text-amber-700',
    [RESERVATION_CANCELED]: 'bg-red-50 text-red-600',
  }
  return styles[status] || 'bg-gray-100 text-gray-500'
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/* ── Component ──────────────────────────────────────────────── */

export default function CalendarView({ sites }: { sites: SiteData[] }) {

  const router = useRouter()

  // State
  const [siteId, setSiteId] = useState(sites[0]?.id || '')
  const [year, setYear] = useState(() => new Date().getFullYear())
  const [month, setMonth] = useState(() => new Date().getMonth()) // 0-indexed
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const [monthCounts, setMonthCounts] = useState<DayCount[]>([])
  const [dayReservations, setDayReservations] = useState<DayReservation[]>([])
  const [loadingMonth, setLoadingMonth] = useState(false)
  const [loadingDay, setLoadingDay] = useState(false)
  const [showCreateModal, setShowCreateModal] = useState(false)

  const monthKey = `${year}-${String(month + 1).padStart(2, '0')}`
  const selectedSite = sites.find(s => s.id === siteId)

  // Fetch month counts
  const fetchMonthCounts = useCallback(async () => {
    if (!siteId) return
    setLoadingMonth(true)
    try {
      const res = await fetch(`/api/reservations/${siteId}?month=${monthKey}`)
      const data = await res.json()
      setMonthCounts(data.reservations || [])
    } catch {
      setMonthCounts([])
    } finally {
      setLoadingMonth(false)
    }
  }, [siteId, monthKey])

  useEffect(() => {
    fetchMonthCounts()
  }, [fetchMonthCounts])

  // Fetch day detail
  const fetchDayReservations = useCallback(async (dateStr: string) => {
    if (!siteId) return
    setLoadingDay(true)
    try {
      const res = await fetch(`/api/reservations/${siteId}?date=${new Date(dateStr + 'T12:00:00').toISOString()}`)
      const data = await res.json()
      const mapped: DayReservation[] = (data.reservations || []).map((r: any) => ({
        id: r.id,
        from: r.from,
        to: r.to,
        status: r.status,
        userName: r.user?.name || r.user?.email?.split('@')[0] || 'Guest',
        userEmail: r.user?.email || '',
        itemCount: r.items?.length || 0,
      }))
      setDayReservations(mapped)
    } catch {
      setDayReservations([])
    } finally {
      setLoadingDay(false)
    }
  }, [siteId])

  useEffect(() => {
    if (selectedDay) fetchDayReservations(selectedDay)
  }, [selectedDay, fetchDayReservations])

  // Count lookup
  const countMap = useMemo(() => {
    const m: Record<string, number> = {}
    for (const c of monthCounts) m[c.date] = c.count
    return m
  }, [monthCounts])

  // Navigation
  function prevMonth() {
    setSelectedDay(null)
    if (month === 0) { setYear(y => y - 1); setMonth(11) }
    else setMonth(m => m - 1)
  }
  function nextMonth() {
    setSelectedDay(null)
    if (month === 11) { setYear(y => y + 1); setMonth(0) }
    else setMonth(m => m + 1)
  }
  function goToToday() {
    const now = new Date()
    setYear(now.getFullYear())
    setMonth(now.getMonth())
    setSelectedDay(now.toISOString().slice(0, 10))
  }

  // Build day cells
  const totalDays = daysInMonth(year, month)
  const startOffset = startDayOfMonth(year, month)
  const todayStr = new Date().toISOString().slice(0, 10)

  return (
    <div className="container mx-auto px-4 py-6 max-w-5xl">

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Calendar</h1>
          <p className="text-sm text-gray-500 mt-0.5">Reservation overview</p>
        </div>

        {/* Site selector */}
        {sites.length > 1 && (
          <div className="relative">
            <select
              value={siteId}
              onChange={(e) => { setSiteId(e.target.value); setSelectedDay(null) }}
              className="appearance-none bg-white border border-gray-200 rounded-lg pl-3 pr-8 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-300 transition-colors cursor-pointer"
            >
              {sites.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            <svg className="w-4 h-4 text-gray-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
            </svg>
          </div>
        )}
      </div>

      <div className="flex gap-4">

        {/* Calendar grid */}
        <div className={`flex-1 bg-white rounded-xl border border-gray-200 overflow-hidden transition-all ${selectedDay ? 'lg:max-w-[calc(100%-320px)]' : ''}`}>

          {/* Month nav */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <div className="flex items-center gap-3">
              <h2 className="text-base font-semibold text-gray-900">
                {MONTH_NAMES[month]} {year}
              </h2>
              {loadingMonth && (
                <div className="w-4 h-4 border-2 border-gray-200 border-t-gray-500 rounded-full animate-spin" />
              )}
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={goToToday}
                className="px-2.5 py-1 text-xs font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-md transition-colors"
              >
                Today
              </button>
              <button
                onClick={prevMonth}
                className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 transition-colors text-gray-500"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
                </svg>
              </button>
              <button
                onClick={nextMonth}
                className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 transition-colors text-gray-500"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                </svg>
              </button>
            </div>
          </div>

          {/* Weekday headers */}
          <div className="grid grid-cols-7 border-b border-gray-100">
            {WEEKDAYS.map(d => (
              <div key={d} className="py-2 text-center text-[11px] font-medium text-gray-400 uppercase tracking-wider">
                {d}
              </div>
            ))}
          </div>

          {/* Day grid */}
          <div className="grid grid-cols-7">
            {/* Empty leading cells */}
            {Array.from({ length: startOffset }).map((_, i) => (
              <div key={`empty-${i}`} className="min-h-[80px] border-b border-r border-gray-50 bg-gray-50/50" />
            ))}

            {/* Day cells */}
            {Array.from({ length: totalDays }).map((_, i) => {
              const dayNum = i + 1
              const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`
              const count = countMap[dateStr] || 0
              const isSelected = selectedDay === dateStr
              const isTodayCell = dateStr === todayStr
              const isWeekend = ((startOffset + i) % 7) >= 5

              return (
                <button
                  key={dateStr}
                  onClick={() => setSelectedDay(isSelected ? null : dateStr)}
                  className={`min-h-[80px] p-1.5 border-b border-r border-gray-50 text-left transition-colors relative group
                    ${isWeekend ? 'bg-gray-50/30' : ''}
                    ${isSelected ? 'bg-gray-900/[0.03] ring-1 ring-inset ring-gray-900/10' : 'hover:bg-gray-50'}
                  `}
                >
                  {/* Day number */}
                  <span className={`inline-flex items-center justify-center w-6 h-6 text-xs rounded-full
                    ${isTodayCell ? 'bg-gray-900 text-white font-semibold' : 'text-gray-700 font-medium'}
                    ${isSelected && !isTodayCell ? 'text-gray-900 font-semibold' : ''}
                  `}>
                    {dayNum}
                  </span>

                  {/* Reservation count indicator */}
                  {count > 0 && (
                    <div className="mt-1 flex items-center gap-1">
                      <div className={`h-1.5 rounded-full ${count >= (selectedSite?.itemCount || 999) ? 'bg-amber-400' : 'bg-emerald-400'}`}
                        style={{ width: `${Math.min(100, Math.max(20, (count / Math.max(selectedSite?.itemCount || 1, 1)) * 100))}%` }}
                      />
                    </div>
                  )}
                  {count > 0 && (
                    <span className="text-[10px] text-gray-400 mt-0.5 block">
                      {count} {count === 1 ? 'res.' : 'res.'}
                    </span>
                  )}
                </button>
              )
            })}

            {/* Trailing empty cells to complete the grid */}
            {Array.from({ length: (7 - ((startOffset + totalDays) % 7)) % 7 }).map((_, i) => (
              <div key={`trail-${i}`} className="min-h-[80px] border-b border-r border-gray-50 bg-gray-50/50" />
            ))}
          </div>

          {/* Capacity legend */}
          {selectedSite && (
            <div className="flex items-center gap-4 px-5 py-3 border-t border-gray-100 text-[11px] text-gray-400">
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-1.5 rounded-full bg-emerald-400" /> Available
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-1.5 rounded-full bg-amber-400" /> At capacity
              </span>
              <span className="ml-auto">{selectedSite.itemCount} sunbeds total</span>
            </div>
          )}
        </div>

        {/* Day detail panel */}
        {selectedDay && (
          <div className="hidden lg:flex lg:flex-col w-[300px] bg-white rounded-xl border border-gray-200 overflow-hidden flex-shrink-0">

            {/* Panel header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
              <div>
                <h3 className="text-sm font-semibold text-gray-900">
                  {new Date(selectedDay + 'T12:00:00').toLocaleDateString('en', { weekday: 'short', day: 'numeric', month: 'short' })}
                </h3>
                <p className="text-[11px] text-gray-400 mt-0.5">
                  {dayReservations.length} {dayReservations.length === 1 ? 'reservation' : 'reservations'}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setShowCreateModal(true)}
                  className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-gray-100 transition-colors text-gray-500"
                  title="Create reservation"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                  </svg>
                </button>
                <button
                  onClick={() => setSelectedDay(null)}
                  className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-gray-100 transition-colors text-gray-400"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Reservation list */}
            <div className="flex-1 overflow-y-auto">
              {loadingDay ? (
                <div className="flex items-center justify-center py-12">
                  <div className="w-5 h-5 border-2 border-gray-200 border-t-gray-500 rounded-full animate-spin" />
                </div>
              ) : dayReservations.length > 0 ? (
                <div className="divide-y divide-gray-50">
                  {dayReservations.map((r) => (
                    <button
                      key={r.id}
                      onClick={() => router.push(`/reservations/${r.id}`)}
                      className="w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors"
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium text-gray-900 truncate">{r.userName}</span>
                        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${statusBadge(r.status)}`}>
                          {r.status}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-gray-400">
                        <span>{formatDateRange(r.from, r.to)}</span>
                        <span>·</span>
                        <span>{daysBetween(r.from, r.to)} {daysBetween(r.from, r.to) === 1 ? 'day' : 'days'}</span>
                        {r.itemCount > 0 && (
                          <>
                            <span>·</span>
                            <span>{r.itemCount} {r.itemCount === 1 ? 'item' : 'items'}</span>
                          </>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <svg className="w-8 h-8 text-gray-200 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5" />
                  </svg>
                  <p className="text-xs text-gray-400">No reservations</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Create Reservation Modal */}
      {showCreateModal && selectedDay && (
        <CreateReservationModal
          siteId={siteId}
          initialDate={selectedDay}
          onClose={() => setShowCreateModal(false)}
          onCreated={() => {
            fetchMonthCounts()
            if (selectedDay) fetchDayReservations(selectedDay)
          }}
        />
      )}

      {/* Mobile day detail (below the calendar) */}
      {selectedDay && (
        <div className="lg:hidden mt-4 bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <div>
              <h3 className="text-sm font-semibold text-gray-900">
                {new Date(selectedDay + 'T12:00:00').toLocaleDateString('en', { weekday: 'short', day: 'numeric', month: 'short' })}
              </h3>
              <p className="text-[11px] text-gray-400 mt-0.5">
                {dayReservations.length} {dayReservations.length === 1 ? 'reservation' : 'reservations'}
              </p>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setShowCreateModal(true)}
                className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-gray-100 transition-colors text-gray-500"
                title="Create reservation"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
              </button>
              <button
                onClick={() => setSelectedDay(null)}
                className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-gray-100 transition-colors text-gray-400"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
          {loadingDay ? (
            <div className="flex items-center justify-center py-8">
              <div className="w-5 h-5 border-2 border-gray-200 border-t-gray-500 rounded-full animate-spin" />
            </div>
          ) : dayReservations.length > 0 ? (
            <div className="divide-y divide-gray-50">
              {dayReservations.map((r) => (
                <button
                  key={r.id}
                  onClick={() => router.push(`/reservations/${r.id}`)}
                  className="w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-gray-900 truncate">{r.userName}</span>
                    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${statusBadge(r.status)}`}>
                      {r.status}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-gray-400">
                    <span>{formatDateRange(r.from, r.to)}</span>
                    <span>·</span>
                    <span>{daysBetween(r.from, r.to)} {daysBetween(r.from, r.to) === 1 ? 'day' : 'days'}</span>
                    {r.itemCount > 0 && (
                      <>
                        <span>·</span>
                        <span>{r.itemCount} {r.itemCount === 1 ? 'item' : 'items'}</span>
                      </>
                    )}
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <p className="text-xs text-gray-400">No reservations this day</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
