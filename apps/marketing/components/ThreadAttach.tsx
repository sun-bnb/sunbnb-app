'use client'

import { useLocale, useTranslations } from 'next-intl'
import { useMemo, useRef, useState, useEffect, type FC, type ReactNode } from 'react'
import QRCodeLib from 'react-qr-code'
import { haptic } from '@/lib/app-art.ts'
import type { BeachLayout } from '@/lib/beach-layout.ts'
import type { Run } from '@/lib/intent.ts'
import { exampleBookings, staffWindow } from '@/lib/missions.ts'
import { MAX_SUNBEDS } from '@/lib/places.ts'
import { project } from '@/lib/projection.ts'
import { DEMO_PRICES, drinksTotal, formatEur } from '@/lib/demo-prices.ts'
import { track } from '@/lib/track.ts'

// react-qr-code types against the hoisted @types/react 19 (same cast as apps/user PassView).
const QRCode = QRCodeLib as unknown as FC<{ value: string; size?: number; style?: React.CSSProperties }>

/**
 * The step UIs of the conversation (track 027 D11) — each rides on the agent's latest message,
 * like a bot's inline keyboard, and acts on the world behind it.
 */

export const cardCls = 'rounded-2xl border border-[#0e3a4a]/10 bg-white/95 p-3 shadow-md backdrop-blur-sm'
export const chipCls =
  'flex items-center gap-1.5 whitespace-nowrap rounded-full border border-[#0e3a4a]/15 bg-white/95 px-3.5 py-2 text-sm font-medium [@media(max-width:400px)]:px-3 [@media(max-width:400px)]:text-[13px] text-[#0e3a4a] shadow-xs backdrop-blur-sm transition active:scale-95'
const bigBtn =
  'w-full rounded-xl bg-[#0e3a4a] px-5 py-3 text-base font-semibold text-white shadow-[0_4px_0_#06222c] transition active:translate-y-[3px] active:shadow-[0_1px_0_#06222c] disabled:opacity-50 disabled:shadow-none'

export function Chips({ children }: { children: ReactNode }) {
  // Wraps on roomy screens; on the narrowest phones one row that scrolls sideways, so the bar
  // below never gets pushed off screen.
  return <div className="flex flex-wrap gap-2 [@media(max-width:400px)]:-mr-3 [@media(max-width:400px)]:flex-nowrap [@media(max-width:400px)]:overflow-x-auto [@media(max-width:400px)]:pr-3">{children}</div>
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
        <button key={r} type="button" aria-pressed={picked.includes(r)} onClick={() => toggle(r)} className={`${chipCls} ${picked.includes(r) ? 'border-[#0e3a4a]! bg-[#0e3a4a]! text-white!' : ''}`}>
          {t(`run_${r}`)}
        </button>
      ))}
      {picked.length ? (
        <button type="button" onClick={() => onDone(picked, picked.map((r) => t(`run_${r}`)).join(' + '))} className={`${chipCls} border-green-300! bg-green-50! text-green-800!`}>
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
    <div className={`${cardCls} border-gray-200!`}>
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
    <div className={`${cardCls} border-gray-200!`}>
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
      <div className={`${cardCls} flex items-center gap-3 border-gray-200!`}>
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
    <div className={`${cardCls} border-gray-200!`}>
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
            <span className={`h-2.5 w-2.5 rounded-xs border ${cls}`} aria-hidden />
            {label}
          </span>
        ))}
      </div>
    </div>
  )
}

// ── Feature modules (track 027 D10) — each a ~20 s play, each ends with onDone(echo key) ──────

/** Tap-through status pipeline, the order board's own vocabulary. */
function Pipeline({ steps, onDone, doneKey }: { steps: string[]; onDone: (echoKey: string) => void; doneKey: string }) {
  const t = useTranslations('Thread')
  const [at, setAt] = useState(0)
  const finished = at >= steps.length - 1
  return (
    <div className="mt-3">
      <div className="flex flex-wrap gap-1.5">
        {steps.map((st, i) => (
          <span
            key={st}
            className={`rounded-full border px-2.5 py-0.5 text-xs font-medium transition ${
              i < at ? 'border-green-200 bg-green-50 text-green-700' : i === at ? 'animate-[pop_200ms_ease-out] border-blue-200 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-400'
            }`}
          >
            {st}
          </span>
        ))}
      </div>
      <div className="mt-3">
        <BigButton
          onClick={() => {
            if (finished) return onDone(doneKey)
            setAt((a) => a + 1)
          }}
        >
          {finished ? t('continue') : steps[at + 1]}
        </BigButton>
      </div>
    </div>
  )
}

export function OrderCard({ guestBed, onDone }: { guestBed: string; onDone: (echoKey: string) => void }) {
  const t = useTranslations('Thread')
  const locale = useLocale()
  return (
    <div className={`${cardCls} border-gray-200!`}>
      <div className="flex items-center justify-between text-xs text-gray-500">
        <span>{t('orderBoard')}</span>
        <span>{t('example')}</span>
      </div>
      <div className="mt-2 rounded-xl border border-gray-200 p-3">
        <div className="flex items-center justify-between">
          <p className="font-semibold text-gray-900">{t('bedTitle', { label: guestBed })}</p>
          <span className="rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">{t('paidOnline')}</span>
        </div>
        <p className="mt-1 text-sm text-gray-600">{t('orderItems')}</p>
        <p className="mt-1 text-sm font-semibold text-gray-900">{formatEur(locale, drinksTotal())}</p>
      </div>
      <Pipeline steps={[t('st_new'), t('st_accepted'), t('st_preparing'), t('st_ready'), t('st_delivered')]} onDone={onDone} doneKey="meDelivered" />
    </div>
  )
}

export function RentalCard({ onDone }: { onDone: (echoKey: string) => void }) {
  const t = useTranslations('Thread')
  const locale = useLocale()
  return (
    <div className={`${cardCls} border-gray-200!`}>
      <div className="flex items-center justify-between text-xs text-gray-500">
        <span>{t('rentalsToday')}</span>
        <span>{t('example')}</span>
      </div>
      <div className="mt-2 flex items-center justify-between rounded-xl border border-gray-200 p-3">
        <div>
          <p className="font-semibold text-gray-900">{t('rentalItem')}</p>
          <p className="text-sm text-gray-500">
            {t('rentalWhen')} · {formatEur(locale, DEMO_PRICES.paddleboardHour)}
          </p>
        </div>
        <span className="rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">{t('paidOnline')}</span>
      </div>
      <Pipeline steps={[t('st_booked'), t('st_pickedUp'), t('st_returned')]} onDone={onDone} doneKey="meReturned" />
    </div>
  )
}

/** Restaurant floor: seat the party at a table big enough for it. */
export function TablesCard({ onDone }: { onDone: (echoKey: string) => void }) {
  const t = useTranslations('Thread')
  const tables = [
    { id: 'T1', seats: 2 },
    { id: 'T2', seats: 2 },
    { id: 'T3', seats: 4 },
    { id: 'T4', seats: 4 },
    { id: 'T5', seats: 6 },
    { id: 'T6', seats: 2 },
  ]
  const [seated, setSeated] = useState<string | null>(null)
  const [nope, setNope] = useState<string | null>(null)
  return (
    <div className={`${cardCls} border-gray-200!`}>
      <div className="flex items-center justify-between text-xs text-gray-500">
        <span>{t('tablesTonight')}</span>
        <span>{t('example')}</span>
      </div>
      <p className="mt-2 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-700">{t('tablesParty')}</p>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {tables.map((tb) => {
          const isSeated = seated === tb.id
          return (
            <button
              key={tb.id}
              type="button"
              disabled={!!seated}
              onClick={() => {
                if (tb.seats < 4) {
                  haptic(30)
                  setNope(tb.id)
                  return
                }
                haptic(18)
                setSeated(tb.id)
              }}
              className={`flex h-14 flex-col items-center justify-center rounded-xl border-2 text-xs font-semibold transition active:scale-95 ${
                isSeated ? 'animate-[pop_220ms_ease-out] border-red-600 bg-red-400 text-white' : nope === tb.id ? 'animate-[pop_160ms_ease-out] border-gray-300 bg-gray-100 text-gray-400' : 'border-green-500 bg-green-300 text-green-900'
              } ${tb.seats >= 6 ? 'rounded-full' : ''}`}
            >
              {tb.id}
              <span className="font-normal">{t('seats', { count: tb.seats })}</span>
            </button>
          )
        })}
      </div>
      {nope && !seated && <p className="mt-2 text-xs text-gray-500">{t('tablesTooSmall')}</p>}
      {seated && (
        <div className="mt-3">
          <BigButton onClick={() => onDone('meSeated')}>{t('continue')}</BigButton>
        </div>
      )}
    </div>
  )
}

/** The demo day, closed: only figures the visitor produced in this demo (their own price). */
export interface PaidLine {
  label: string
  amount: number
}

export function DayCloseCard({ lines, onDone }: { lines: PaidLine[]; onDone: (echoKey: string) => void }) {
  const t = useTranslations('Thread')
  const locale = useLocale()
  const [closed, setClosed] = useState(false)
  // Exactly what this demo sold — one line per payment, each with its own receipt.
  const total = Math.round(lines.reduce((sum, l) => sum + l.amount, 0) * 100) / 100
  const rows: [string, string, boolean?][] = [
    ...lines.map((l): [string, string] => [l.label, formatEur(locale, l.amount)]),
    [t('dc_total'), formatEur(locale, total), true],
    [t('dc_cash'), formatEur(locale, 0)],
    [t('dc_receipts'), String(lines.length)],
    [t('dc_vat'), t('dc_vatValue')],
  ]
  return (
    <div className={`${cardCls} border-gray-200!`}>
      <div className="flex items-center justify-between text-xs text-gray-500">
        <span>{t('dc_title')}</span>
        <span>{t('dc_fromDemo')}</span>
      </div>
      <dl className="mt-2 divide-y divide-gray-100 rounded-xl border border-gray-200">
        {rows.map(([k, v, strong]) => (
          <div key={k} className={`flex justify-between px-3 py-2 text-sm ${strong ? 'bg-gray-50' : ''}`}>
            <dt className={strong ? 'font-semibold text-gray-900' : 'text-gray-600'}>{k}</dt>
            <dd className="font-semibold tabular-nums text-gray-900">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-3">
        {closed ? (
          <>
            <p className="mb-3 animate-[pop_220ms_ease-out] rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm font-medium text-green-700">{t('dc_closed')}</p>
            <BigButton onClick={() => onDone('meClosed')}>{t('continue')}</BigButton>
          </>
        ) : (
          <BigButton
            onClick={() => {
              haptic(20)
              setClosed(true)
            }}
          >
            {t('dc_close')}
          </BigButton>
        )}
      </div>
    </div>
  )
}

/** Veri*factu (Spain): COMING — founder wording, never "works today" (lib/agent/knowledge.ts). */
export function VerifactuCard({ onDone }: { onDone: () => void }) {
  const t = useTranslations('Thread')
  return (
    <div className={`${cardCls} border-gray-200!`}>
      <span className="inline-block rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-800">{t('vf_badge')}</span>
      <ul className="mt-2 space-y-1.5 text-sm text-gray-700">
        {(['vf_1', 'vf_2', 'vf_3'] as const).map((k) => (
          <li key={k} className="flex gap-2">
            <span className="text-[#00a9c7]" aria-hidden>
              ›
            </span>
            {t(k)}
          </li>
        ))}
      </ul>
      <div className="mt-3">
        <BigButton onClick={onDone}>{t('continue')}</BigButton>
      </div>
    </div>
  )
}

/** "Your Sunbnb": everything they just ran on their own beach, then the way to make it real. */
export function SummaryCard({ items, onLive, cta }: { items: { text: string; coming?: boolean }[]; onLive: () => void; cta?: string }) {
  const t = useTranslations('Thread')
  return (
    <div className="space-y-2">
      <div className={cardCls}>
        <ul className="space-y-2">
          {items.map((it, i) => (
            <li key={it.text} className="flex animate-[pop_220ms_ease-out] items-center gap-2 text-sm font-medium text-[#0e3a4a]" style={{ animationDelay: `${i * 90}ms`, animationFillMode: 'backwards' }}>
              {/* A coming feature never wears the same tick as a working one. */}
              <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] ${it.coming ? 'border border-amber-300 bg-amber-50 text-amber-700' : 'bg-green-600 text-white'}`} aria-hidden>
                {it.coming ? '…' : '✓'}
              </span>
              {it.text}
            </li>
          ))}
        </ul>
      </div>
      <BigButton onClick={onLive}>{cta ?? t('nextLive')}</BigButton>
    </div>
  )
}

/**
 * Their numbers on each plan (P10). Inputs are theirs only: the price they set for their guest's
 * sunbed (confirmed here if they never touched our starting value) and — optionally — how many
 * sunbeds they'd sell online on a typical day. Without that estimate there are no monthly
 * figures at all. Everything shown traces back to the plan catalogue ("How is this calculated?").
 */
export function ProjectionCard({
  price,
  priceConfirmed,
  sunbeds,
  onChange,
  onLive,
}: {
  price: number
  priceConfirmed: boolean
  sunbeds: number
  onChange: (input: { price: number; sunbeds: number; onlinePerDay: number | null }) => void
  onLive: () => void
}) {
  const t = useTranslations('Thread')
  const locale = useLocale()
  // Money in the visitor's own notation; whole euros without decimals ("€79", "€19.70").
  const eur = (n: number) =>
    new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR', minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 }).format(n)
  const [p, setP] = useState(price)
  const [confirmed, setConfirmed] = useState(priceConfirmed)
  const [online, setOnline] = useState<number | null>(null)
  const [why, setWhy] = useState(false)
  const proj = useMemo(() => project({ price: p, sunbeds, onlinePerDay: online }), [p, sunbeds, online])
  // Funnel: each way of fine-tuning the numbers, and opening the formula — once each.
  const noted = useRef(new Set<string>())
  const note = (what: 'price' | 'online' | 'formula') => {
    if (noted.current.has(what)) return
    noted.current.add(what)
    if (what === 'formula') track('projection_formula_open')
    else track('projection_finetune', { what })
  }
  useEffect(() => {
    const timer = setTimeout(() => onChange({ price: p, sunbeds, onlinePerDay: online }), 600)
    return () => clearTimeout(timer)
  }, [p, sunbeds, online]) // onChange is a fresh closure each render; the inputs are what matter
  const btn = 'grid h-9 w-9 place-items-center rounded-full border-2 border-gray-900 text-lg font-semibold text-gray-900 transition active:scale-90 select-none touch-manipulation'
  const setPrice = (v: number) => {
    haptic(5)
    setConfirmed(true)
    note('price')
    setP(Math.max(1, Math.min(500, v)))
  }

  return (
    <div className="space-y-2">
      <div className={`${cardCls} border-gray-200!`}>
        <div className="flex items-center justify-between rounded-xl bg-gray-50 px-3 py-2">
          <span className="text-sm text-gray-600">{confirmed ? t('pj_price') : t('pj_priceAsk', { price: eur(p) })}</span>
          <div className="flex items-center gap-2">
            <button type="button" aria-label={t('priceLess')} className={btn} onClick={() => setPrice(p - 1)}>
              −
            </button>
            <span key={p} className="w-12 animate-[pop_160ms_ease-out] text-center text-lg font-semibold tabular-nums text-gray-900">€{p}</span>
            <button type="button" aria-label={t('priceMore')} className={btn} onClick={() => setPrice(p + 1)}>
              +
            </button>
          </div>
        </div>

        <ul className="mt-3 space-y-2">
          {proj.tiers.map((l) => {
            const best = proj.cheapest === l.tier
            return (
              <li key={l.tier} className={`rounded-xl border p-3 transition ${best ? 'border-green-300 bg-green-50' : 'border-gray-200'}`}>
                <div className="flex items-baseline justify-between gap-2">
                  <p className="font-semibold text-gray-900">{l.name}</p>
                  <p className="shrink-0 whitespace-nowrap text-sm text-gray-600">{l.monthlyPrice ? t('pj_fee', { fee: eur(l.monthlyPrice) }) : t('pj_noFee')}</p>
                </div>
                {/* Its own line: squeezed next to the name it wrapped mid-badge on phones. */}
                {best && <span className="mt-1 inline-block animate-[pop_200ms_ease-out] whitespace-nowrap rounded-full bg-green-600 px-2 py-0.5 text-[11px] font-semibold text-white">{t('pj_cheapest')}</span>}
                <p className="mt-1 text-sm text-gray-700">{t('pj_keep', { keep: eur(l.keepPerBed), price: eur(p), pct: l.commissionPercent })}</p>
                {l.breakEvenBedDays !== null && <p className="text-xs text-gray-500">{t('pj_breakEven', { days: l.breakEvenBedDays })}</p>}
                {l.monthlyCost !== null && <p key={l.monthlyCost} className="mt-1 animate-[pop_160ms_ease-out] text-sm font-semibold text-gray-900">{t('pj_month', { cost: eur(l.monthlyCost) })}</p>}
              </li>
            )
          })}
        </ul>

        {online === null ? (
          <button
            type="button"
            onClick={() => {
              note('online')
              setOnline(Math.max(1, Math.round(sunbeds / 4)))
            }}
            className={`${chipCls} mt-3`}
          >
            {t('pj_addEstimate')}
          </button>
        ) : (
          <div className="mt-3 rounded-xl bg-gray-50 px-3 py-2">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="text-gray-600">{t('pj_online')}</span>
              <span className="shrink-0 whitespace-nowrap font-semibold tabular-nums text-gray-900">{t('pj_onlineValue', { n: online, total: sunbeds })}</span>
            </div>
            <input
              type="range"
              min={0}
              max={sunbeds}
              value={online}
              onChange={(e) => setOnline(Number(e.target.value))}
              aria-label={t('pj_online')}
              className="mt-2 w-full accent-[#00a9c7]"
            />
            <p className="text-[11px] text-gray-500">{t('pj_yourEstimate')}</p>
          </div>
        )}

        <button
          type="button"
          onClick={() => {
            if (!why) note('formula')
            setWhy((w) => !w)
          }}
          aria-expanded={why} className="mt-3 text-xs font-medium text-[#0083a0] underline-offset-2 hover:underline">
          {t('pj_how')}
        </button>
        {why && (
          <ul className="mt-2 space-y-1 rounded-lg bg-gray-50 p-2.5 text-[11px] leading-snug text-gray-600">
            {[...proj.trace, ...proj.tiers.flatMap((l) => l.trace)].map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}
      </div>
      <BigButton onClick={onLive}>{t('nextLive')}</BigButton>
    </div>
  )
}
