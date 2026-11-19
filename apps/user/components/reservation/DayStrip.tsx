'use client'

import { useLayoutEffect, useRef, useState } from 'react'
import dayjs from 'dayjs'
import { useLocale, useTranslations } from 'next-intl'

import {
  availabilityTone,
  selectedChip,
  visibleDayCount,
  type AvailabilityTone,
  type StripDay,
} from '@/app/sites/[id]/day-strip'

/**
 * The booking sheet's date control: the next days as calendar tiles (weekday,
 * day numeral, free-seat count), a calendar tile for anything else, and one
 * caption line that spells the selection out in words.
 *
 * The tiles carry NUMBERS only — the words live in the caption. Three lines of
 * text per tile did not fit a phone-width tile in English and could not in
 * Finnish; a numeral and a coloured count fit in any locale.
 *
 * The row never scrolls: it shows exactly as many days as fit
 * (`visibleDayCount`), because a half-hidden tile at the edge read as an empty
 * gap. Anything further out is one tap away in the calendar.
 */

const TILE =
  'rounded-xl border flex flex-col items-center justify-center select-none ' +
  'transition-[background-color,border-color,color,transform] duration-150 motion-reduce:transition-none ' +
  'active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-ink'

const TILE_SELECTED = 'border-brand-ink bg-brand-ink text-white shadow-soft'
const TILE_IDLE = 'border-brand-ink/10 bg-white text-brand-ink hover:border-brand-ink/30'

const TONE_TEXT: Record<AvailabilityTone, string> = {
  free: 'text-green-700',
  few: 'text-amber-700',
  full: 'text-red-600',
}

const TONE_DOT: Record<AvailabilityTone, string> = {
  free: 'bg-green-500',
  few: 'bg-amber-500',
  full: 'bg-red-500',
}

/** A civil `YYYY-MM-DD` key as a local Date (noon — safe from DST edges for display). */
function keyToDate(key: string): Date {
  return new Date(`${key}T12:00:00`)
}

function CalendarIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <rect x="3" y="4.5" width="14" height="12.5" rx="2.5" />
      <path d="M3 8.5h14M7 2.5v4M13 2.5v4" strokeLinecap="round" />
    </svg>
  )
}

/** A strip day; the free count is optional — equipment has no per-day count. */
type DayTile = Pick<StripDay, 'date'> & Partial<Pick<StripDay, 'available' | 'total'>>

export default function DayStrip({
  days,
  dateRange,
  onSelect,
  onOther,
  between,
  captionAside,
}: {
  /** Undefined while loading — placeholders keep the row height stable. */
  days: DayTile[] | undefined
  /** The current selection as browser-local start/end ISO (one day = same day twice). */
  dateRange: [string, string]
  onSelect: (dateKey: string) => void
  onOther: () => void
  /** Rendered between the tiles and the caption (equipment's Start / Duration). */
  between?: React.ReactNode
  /** Replaces the caption's right side (default: free count, or the day count of a range). */
  captionAside?: React.ReactNode
}) {
  const t = useTranslations('SiteView')
  const locale = useLocale()

  const weekday = new Intl.DateTimeFormat(locale, { weekday: 'short' })
  const month = new Intl.DateTimeFormat(locale, { month: 'short' })
  const fullDay = new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long' })
  const longRange = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long' })

  // Fit-to-width: measure the row, show as many tiles as fit. 5 before the
  // first measurement — the common phone width, so there is no visible jump.
  const rowRef = useRef<HTMLDivElement>(null)
  const [count, setCount] = useState(5)
  useLayoutEffect(() => {
    const el = rowRef.current
    if (!el) return
    const measure = () => setCount(visibleDayCount(el.clientWidth, days?.length ?? 7))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [days?.length])

  const visible = days?.slice(0, count)
  // Counts are all-or-nothing: sunbeds have them, equipment does not. Without
  // them the tile drops its third line and is shorter, not emptier.
  const counts = !!days?.length && days.every((d) => d.available != null && d.total != null)
  const tileHeight = counts || !days ? 'h-16' : 'h-14'
  const toneOf = (d: DayTile) => availabilityTone({ available: d.available ?? 0, total: d.total ?? 0 })
  const selected = selectedChip(dateRange, visible ?? [])
  const selectedDay = visible?.find((d) => d.date === selected)
  const range = selected === 'other' ? { from: new Date(dateRange[0]), to: new Date(dateRange[1]) } : null

  // Calendar tile, when it holds the selection: months on top, day numerals below.
  const sameDay = range ? dayjs(range.from).isSame(range.to, 'day') : false
  const rangeMonths = range
    ? month.format(range.from) === month.format(range.to)
      ? month.format(range.from)
      : `${month.format(range.from)}–${month.format(range.to)}`
    : null
  const rangeDays = range
    ? sameDay
      ? `${range.from.getDate()}`
      : `${range.from.getDate()}–${range.to.getDate()}`
    : null
  const rangeLength = range
    ? dayjs(range.to).startOf('day').diff(dayjs(range.from).startOf('day'), 'day') + 1
    : 0

  return (
    <div>
      <div ref={rowRef} role="group" aria-label={t('Choose a day')} className="flex gap-1.5 py-1.5">
        {visible
          ? visible.map((day, i) => {
              const date = keyToDate(day.date)
              const tone = toneOf(day)
              const isSelected = selected === day.date
              const isFull = counts && tone === 'full'
              const countText = !counts ? null : isFull ? t('Full') : t('seatsFree', { count: day.available ?? 0 })
              return (
                <button
                  key={day.date}
                  type="button"
                  data-day-tile
                  disabled={isFull}
                  aria-pressed={isSelected}
                  aria-label={countText ? `${fullDay.format(date)}, ${countText}` : fullDay.format(date)}
                  onClick={() => onSelect(day.date)}
                  className={`${TILE} ${tileHeight} min-w-0 flex-1 ${
                    isSelected
                      ? TILE_SELECTED
                      : isFull
                        ? 'border-brand-ink/5 bg-white/50 text-brand-ink/35 active:scale-100'
                        : TILE_IDLE
                  }`}
                >
                  <span
                    className={`max-w-full truncate px-0.5 text-[11px] font-medium leading-none ${
                      isSelected ? 'text-white/75' : isFull ? '' : 'text-brand-ink/60'
                    }`}
                  >
                    {i === 0 ? t('Today') : weekday.format(date)}
                  </span>
                  <span className="mt-1 text-lg font-semibold leading-none tabular-nums">{date.getDate()}</span>
                  {counts && (
                    <span
                      className={`mt-1.5 text-[11px] font-semibold leading-none tabular-nums ${
                        isSelected ? 'text-white/85' : TONE_TEXT[tone]
                      }`}
                    >
                      {isFull ? '–' : day.available}
                    </span>
                  )}
                </button>
              )
            })
          : Array.from({ length: count }, (_, i) => (
              <div key={i} className={`${TILE} ${tileHeight} min-w-0 flex-1 border-brand-ink/5 bg-white/70 animate-pulse`} aria-hidden="true">
                <span className="h-2 w-5 rounded-full bg-brand-ink/10" />
                <span className="mt-1.5 h-4 w-5 rounded bg-brand-ink/15" />
                <span className="mt-1.5 h-2 w-4 rounded-full bg-brand-ink/10" />
              </div>
            ))}

        <button
          type="button"
          aria-pressed={!!range}
          aria-label={t('Other dates')}
          onClick={onOther}
          className={`${TILE} ${tileHeight} w-14 shrink-0 ${
            range ? `${TILE_SELECTED} ${sameDay ? '' : 'w-auto min-w-14 px-2'}` : 'border-dashed border-brand-ink/25 bg-transparent text-brand-ink hover:border-brand-ink/50'
          }`}
        >
          {range ? (
            <>
              <span className="text-[11px] font-medium leading-none text-white/75">{rangeMonths}</span>
              <span className="mt-1 whitespace-nowrap text-lg font-semibold leading-none tabular-nums">{rangeDays}</span>
              {counts && <CalendarIcon className="mt-1 h-3.5 w-3.5 text-white/75" />}
            </>
          ) : (
            <>
              <CalendarIcon className={counts || !days ? 'h-5 w-5' : 'h-4.5 w-4.5'} />
              <span className={`${counts || !days ? 'mt-1.5' : 'mt-1'} text-[11px] font-medium leading-none text-brand-ink/70`}>{t('More')}</span>
            </>
          )}
        </button>
      </div>

      {between && <div className="pt-1 pb-1.5">{between}</div>}

      {/* The selection in words — everything the tiles abbreviate. */}
      <p className="flex h-7 items-center justify-between gap-3 text-left text-sm" aria-live="polite">
        {selectedDay ? (
          <>
            <span className="truncate font-semibold text-brand-ink first-letter:uppercase">
              {fullDay.format(keyToDate(selectedDay.date))}
            </span>
            {captionAside !== undefined ? (
              <span className="shrink-0 font-medium tabular-nums text-brand-ink/70">{captionAside}</span>
            ) : counts ? (
              <span className={`flex shrink-0 items-center gap-1.5 font-medium ${TONE_TEXT[toneOf(selectedDay)]}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${TONE_DOT[toneOf(selectedDay)]}`} aria-hidden="true" />
                {(selectedDay.available ?? 0) > 0 ? t('seatsFree', { count: selectedDay.available ?? 0 }) : t('Full')}
              </span>
            ) : null}
          </>
        ) : range ? (
          <>
            <span className="truncate font-semibold text-brand-ink first-letter:uppercase">
              {sameDay ? fullDay.format(range.from) : longRange.formatRange(range.from, range.to)}
            </span>
            <span className="shrink-0 font-medium tabular-nums text-brand-ink/70">
              {captionAside !== undefined ? captionAside : t('daysCount', { count: rangeLength })}
            </span>
          </>
        ) : null}
      </p>
    </div>
  )
}
