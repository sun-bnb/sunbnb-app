'use client'

import { useTranslations } from 'next-intl'
import { useMemo, useRef, useState, useEffect, type FC, type ReactNode } from 'react'
import QRCodeLib from 'react-qr-code'
import { haptic } from '@/lib/app-sprites.ts'
import type { BeachLayout } from '@/lib/beach-layout.ts'
import type { Run } from '@/lib/intent.ts'
import { exampleBookings, staffWindow } from '@/lib/missions.ts'
import { MAX_SUNBEDS } from '@/lib/places.ts'

// react-qr-code types against the hoisted @types/react 19 (same cast as apps/user PassView).
const QRCode = QRCodeLib as unknown as FC<{ value: string; size?: number; style?: React.CSSProperties }>

/**
 * The step UIs of the conversation (track 027 D11) — each rides on the agent's latest message,
 * like a bot's inline keyboard, and acts on the world behind it.
 */

export const cardCls = 'rounded-2xl border border-[#0e3a4a]/10 bg-white/95 p-3 shadow-md backdrop-blur'
export const chipCls =
  'flex items-center gap-1.5 rounded-full border border-[#0e3a4a]/15 bg-white/95 px-3.5 py-2 text-sm font-medium text-[#0e3a4a] shadow-sm backdrop-blur transition active:scale-95'
const bigBtn =
  'w-full rounded-xl bg-[#0e3a4a] px-5 py-3 text-base font-semibold text-white shadow-[0_4px_0_#06222c] transition active:translate-y-[3px] active:shadow-[0_1px_0_#06222c] disabled:opacity-50 disabled:shadow-none'

export function Chips({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap gap-2">{children}</div>
}

export function BigButton({ onClick, disabled, children }: { onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => {
        haptic(12)
        onClick()
      }}
      className={bigBtn}
    >
      {children}
    </button>
  )
}

/** The qualifier (D10), asked during the fly-in: multi-select, "Just sunbeds" answers at once. */
export function RunsChips({ onDone }: { onDone: (runs: Run[], echo: string) => void }) {
  const t = useTranslations('Thread')
  const [picked, setPicked] = useState<Run[]>([])
  const options: Run[] = ['fnb', 'rentals', 'tables']
  const toggle = (r: Run) => {
    haptic(6)
    setPicked((p) => (p.includes(r) ? p.filter((x) => x !== r) : [...p, r]))
  }
  return (
    <Chips>
      {options.map((r) => (
        <button key={r} type="button" aria-pressed={picked.includes(r)} onClick={() => toggle(r)} className={`${chipCls} ${picked.includes(r) ? '!border-[#0e3a4a] !bg-[#0e3a4a] !text-white' : ''}`}>
          {t(`run_${r}`)}
        </button>
      ))}
      {picked.length ? (
        <button type="button" onClick={() => onDone(picked, picked.map((r) => t(`run_${r}`)).join(' + '))} className={`${chipCls} !border-green-300 !bg-green-50 !text-green-800`}>
          {t('runsDone')}
        </button>
      ) : (
        <button type="button" onClick={() => onDone([], t('run_none'))} className={chipCls}>
          {t('run_none')}
        </button>
      )}
    </Chips>
  )
}

const PRESETS = [20, 60, 120, 250]
const STEP = 2 // one pair

/** Sunbed count: −/+ (hold to accelerate), presets, and Build. Beds drop on the map as it changes. */
export function CountCard({ count, rows, building, onChange, onBuild }: { count: number; rows: number; building: boolean; onChange: (n: number) => void; onBuild: () => void }) {
  const t = useTranslations('Thread')
  const holdRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const countRef = useRef(count)
  countRef.current = count
  const set = (n: number) => {
    const v = Math.max(0, Math.min(MAX_SUNBEDS, n))
    if (v !== countRef.current) haptic(5)
    onChange(v)
  }
  function startHold(dir: 1 | -1) {
    let delay = 260
    let step = STEP
    const go = () => {
      set(countRef.current + dir * step)
      delay = Math.max(40, delay * 0.82)
      if (delay < 90) step = STEP * 5
      holdRef.current = setTimeout(go, delay)
    }
    go()
  }
  const stopHold = () => {
    if (holdRef.current) clearTimeout(holdRef.current)
    holdRef.current = null
  }
  useEffect(() => stopHold, [])
  const round =
    'grid h-11 w-11 shrink-0 place-items-center rounded-full border-2 border-[#0e3a4a] bg-white text-2xl font-semibold text-[#0e3a4a] shadow-[0_3px_0_#0e3a4a] transition active:translate-y-[2px] active:shadow-[0_1px_0_#0e3a4a] select-none touch-manipulation'

  return (
    <div className={cardCls}>
      <div className="flex items-center gap-3">
        <button type="button" aria-label={t('fewer')} className={round} onPointerDown={() => startHold(-1)} onPointerUp={stopHold} onPointerLeave={stopHold} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && set(count - STEP)}>
          −
        </button>
        <div className="min-w-0 flex-1 text-center" aria-live="polite">
          <span key={count} className="block animate-[pop_160ms_ease-out] text-3xl font-semibold leading-none tabular-nums text-[#0e3a4a]">
            {count}
          </span>
          <span className="mt-1 block truncate text-xs text-[#0e3a4a]/60">{count ? t('rowsLine', { count, rows }) : t('countHint')}</span>
        </div>
        <button type="button" aria-label={t('more')} className={round} onPointerDown={() => startHold(1)} onPointerUp={stopHold} onPointerLeave={stopHold} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && set(count + STEP)}>
          +
        </button>
      </div>
      <div className="mt-3 grid grid-cols-4 gap-2">
        {PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => set(p)}
            className={`rounded-full border-2 py-1 text-sm font-semibold tabular-nums transition active:scale-95 ${count === p ? 'border-[#0e3a4a] bg-[#0e3a4a] text-white' : 'border-[#0e3a4a]/20 bg-white text-[#0e3a4a]'}`}
          >
            {p}
          </button>
        ))}
      </div>
      <div className="mt-3">
        <BigButton onClick={onBuild} disabled={!count || building}>
          {building ? t('building') : count ? t('build', { count }) : t('buildEmpty')}
        </BigButton>
      </div>
    </div>
  )
}

/** The guest app's booking sheet look: bed, row, today, the operator's own price, Reserve. */
export function BedCard({ label, rowText, price, onPrice, onReserve }: { label: string; rowText: string; price: number; onPrice: (p: number) => void; onReserve: () => void }) {
  const t = useTranslations('Thread')
  const btn = 'grid h-10 w-10 place-items-center rounded-full border-2 border-gray-900 text-xl font-semibold text-gray-900 transition active:scale-90 select-none touch-manipulation'
  const set = (v: number) => {
    haptic(5)
    onPrice(Math.max(1, Math.min(500, v)))
  }
  return (
    <div className={`${cardCls} !border-gray-200`}>
      <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-gray-300" aria-hidden />
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-lg font-semibold text-gray-900">{t('bedTitle', { label })}</p>
          <p className="text-sm text-gray-500">{rowText} · {t('today')}</p>
        </div>
        <span className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700">{t('selected')}</span>
      </div>
      <div className="mt-3 flex items-center justify-between rounded-xl bg-gray-50 px-3 py-2">
        <span className="text-sm text-gray-600">{t('priceLabel')}</span>
        <div className="flex items-center gap-3">
          <button type="button" aria-label={t('priceLess')} className={btn} onClick={() => set(price - 1)}>
            −
          </button>
          <span key={price} className="w-14 animate-[pop_160ms_ease-out] text-center text-xl font-semibold tabular-nums text-gray-900">
            €{price}
          </span>
          <button type="button" aria-label={t('priceMore')} className={btn} onClick={() => set(price + 1)}>
            +
          </button>
        </div>
      </div>
      <div className="mt-3">
        <BigButton onClick={onReserve}>{t('reserve', { price })}</BigButton>
      </div>
    </div>
  )
}

export function PayCard({ label, price, paying, onPay }: { label: string; price: number; paying: boolean; onPay: () => void }) {
  const t = useTranslations('Thread')
  return (
    <div className={`${cardCls} !border-gray-200`}>
      <div className="flex justify-between border-b border-gray-100 pb-2 text-sm">
        <span className="text-gray-600">
          {t('bedTitle', { label })} · {t('today')}
        </span>
        <span className="font-semibold text-gray-900">€{price}</span>
      </div>
      <p className="mt-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs text-blue-700">{t('demoNote')}</p>
      <div className="mt-3">
        <BigButton onClick={onPay} disabled={paying}>
          <span className="inline-flex items-center justify-center gap-2">
            {paying && <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" aria-hidden />}
            {paying ? t('paying') : t('pay', { price })}
          </span>
        </BigButton>
      </div>
    </div>
  )
}

export function PassCard({ label, price, onNext }: { label: string; price: number; onNext: () => void }) {
  const t = useTranslations('Thread')
  return (
    <div className="space-y-2">
      <div className={`${cardCls} flex items-center gap-3 !border-gray-200`}>
        <div className="w-24 shrink-0 rounded-lg border border-gray-200 bg-white p-1.5">
          <QRCode value={`SUNBNB-DEMO:${label}`} size={88} style={{ width: '100%', height: 'auto' }} />
        </div>
        <div>
          <p className="inline-block rounded-full border border-green-200 bg-green-50 px-2.5 py-0.5 text-xs font-medium text-green-700">{t('paidBadge', { price })}</p>
          <p className="mt-1.5 text-lg font-semibold text-gray-900">{t('bedTitle', { label })}</p>
          <p className="text-sm text-gray-500">{t('today')}</p>
        </div>
      </div>
      <BigButton onClick={onNext}>{t('nextStaff')}</BigButton>
    </div>
  )
}

/**
 * Your morning: the staff grid for the guest's row in the partner app's own colours
 * (`@repo/floor-core` getCellAppearance): free green-300, reserved fuchsia-400 + card glyph,
 * occupied red-400. Other bookings are labelled as an example — not a claim.
 */
export function StaffCard({ layout, guestBed, checkedIn, onCheckIn }: { layout: BeachLayout; guestBed: string; checkedIn: readonly string[]; onCheckIn: (label: string) => void }) {
  const t = useTranslations('Thread')
  const seats = useMemo(() => staffWindow(layout, guestBed, 8), [layout, guestBed])
  const examples = useMemo(() => exampleBookings(seats, guestBed), [seats, guestBed])
  return (
    <div className={`${cardCls} !border-gray-200`}>
      <div className="mb-2 flex items-center justify-between text-xs text-gray-500">
        <span>{t('staffToday')}</span>
        <span>{t('example')}</span>
      </div>
      <div className="grid grid-cols-4 gap-1.5" role="grid" aria-label={t('staffToday')}>
        {seats.map((s, i) => {
          const isIn = checkedIn.includes(s.label)
          const reserved = s.label === guestBed || examples.has(s.label)
          const cls = isIn ? 'bg-red-400 border-red-600 text-white' : reserved ? 'bg-fuchsia-400 border-fuchsia-600 text-white' : 'bg-green-300 border-green-500 text-green-900'
          const isGuest = s.label === guestBed && !isIn
          return (
            <button
              key={s.label}
              type="button"
              role="gridcell"
              onClick={() => {
                if (!reserved || isIn) return
                haptic(18)
                onCheckIn(s.label)
              }}
              aria-label={`${s.label} ${isIn ? t('legendIn') : reserved ? t('legendReserved') : t('legendFree')}`}
              className={`flex h-12 flex-col items-center justify-center rounded-md border-2 text-xs font-semibold transition active:scale-95 ${cls} ${i % 4 === 2 ? 'ml-1.5' : ''} ${isGuest ? 'ring-4 ring-[#00cef1] ring-offset-1' : ''} ${isIn ? 'animate-[pop_220ms_ease-out]' : ''}`}
            >
              <span>{s.label}</span>
              {reserved && (
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
                  <rect x="2.5" y="5" width="19" height="14" rx="2" />
                  <path d="M2.5 10h19" />
                </svg>
              )}
            </button>
          )
        })}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-gray-600">
        {[
          ['bg-green-300 border-green-500', t('legendFree')],
          ['bg-fuchsia-400 border-fuchsia-600', t('legendReserved')],
          ['bg-red-400 border-red-600', t('legendIn')],
        ].map(([cls, label]) => (
          <span key={label} className="flex items-center gap-1">
            <span className={`h-2.5 w-2.5 rounded-sm border ${cls}`} aria-hidden />
            {label}
          </span>
        ))}
      </div>
    </div>
  )
}
