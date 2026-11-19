'use client'

import { useTranslations } from 'next-intl'

import { fmtHour, type HourBounds } from '@/app/sites/[id]/equipment-time'

/**
 * Start + Duration for hourly equipment rental: two steppers side by side, in
 * the day strip's tile language. Whole hours inside the day's opening hours.
 *
 * Steppers rather than dropdowns or a slot strip: two tiles fit any phone
 * width without scrolling, each tap gives instant feedback, and the bounds
 * (closing time, "not in the past") show as a disabled arrow, not as an
 * option list to read.
 */

const CELL =
  'flex h-14 min-w-0 items-stretch overflow-hidden rounded-xl border border-brand-ink/10 bg-white text-brand-ink'

const ARROW =
  'flex w-11 shrink-0 items-center justify-center text-brand-ink/70 transition-colors ' +
  'hover:bg-brand-ink/5 active:bg-brand-ink/10 disabled:cursor-not-allowed disabled:text-brand-ink/20 disabled:hover:bg-transparent ' +
  'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-ink'

function Arrow({ dir }: { dir: 'left' | 'right' }) {
  return (
    <svg className={`h-5 w-5 ${dir === 'left' ? 'rotate-180' : ''}`} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 0 1 .02-1.06L11.17 10 7.23 6.29a.75.75 0 1 1 1.04-1.08l4.5 4.25a.75.75 0 0 1 0 1.08l-4.5 4.25a.75.75 0 0 1-1.06-.02Z" clipRule="evenodd" />
    </svg>
  )
}

function Stepper({
  label,
  value,
  onDec,
  onInc,
  canDec,
  canInc,
  decLabel,
  incLabel,
}: {
  label: string
  value: string
  onDec: () => void
  onInc: () => void
  canDec: boolean
  canInc: boolean
  decLabel: string
  incLabel: string
}) {
  return (
    <div className={CELL} role="group" aria-label={label}>
      <button type="button" className={ARROW} onClick={onDec} disabled={!canDec} aria-label={decLabel}>
        <Arrow dir="left" />
      </button>
      <div className="flex min-w-0 flex-1 flex-col items-center justify-center leading-none">
        <span className="text-[11px] font-medium text-brand-ink/60">{label}</span>
        <span className="mt-1 text-lg font-semibold tabular-nums" aria-live="polite">
          {value}
        </span>
      </div>
      <button type="button" className={ARROW} onClick={onInc} disabled={!canInc} aria-label={incLabel}>
        <Arrow dir="right" />
      </button>
    </div>
  )
}

export default function TimeStepper({
  bounds,
  start,
  duration,
  onChange,
}: {
  /** `null` = nothing bookable on this day (today, after the last start). */
  bounds: HourBounds | null
  start: number
  duration: number
  onChange: (slot: { start: number; duration: number }) => void
}) {
  const t = useTranslations('SiteView')

  if (!bounds) {
    return (
      <p className="flex h-14 items-center justify-center rounded-xl border border-dashed border-brand-ink/20 px-3 text-sm text-brand-ink/70">
        {t('No times left today')}
      </p>
    )
  }

  // Moving the start keeps the duration when it still fits before closing.
  const setStart = (s: number) => onChange({ start: s, duration: Math.min(duration, bounds.closeHour - s) })

  return (
    <div className="grid grid-cols-2 gap-1.5">
      <Stepper
        label={t('Start')}
        value={fmtHour(start)}
        onDec={() => setStart(start - 1)}
        onInc={() => setStart(start + 1)}
        canDec={start > bounds.minStart}
        canInc={start < bounds.closeHour - 1}
        decLabel={t('Earlier')}
        incLabel={t('Later')}
      />
      <Stepper
        label={t('Duration')}
        value={t('hoursCount', { count: duration })}
        onDec={() => onChange({ start, duration: duration - 1 })}
        onInc={() => onChange({ start, duration: duration + 1 })}
        canDec={duration > 1}
        canInc={start + duration < bounds.closeHour}
        decLabel={t('Shorter')}
        incLabel={t('Longer')}
      />
    </div>
  )
}
