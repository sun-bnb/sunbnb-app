'use client'

import { useTranslations } from 'next-intl'
import { useEffect, useLayoutEffect, useRef, useState, type FC, type ReactNode } from 'react'
import QRCodeLib from 'react-qr-code'
import { BedArtDefs, BedGlyphSvg } from '@repo/schematic/art'
import { BED_STATE, BED_WIDTH_RATIO } from '@/lib/app-art'
import { DeviceModel, deviceStatus } from './DeviceShowcase'
import type { HeroMode } from './HeroBeach'

/**
 * Each feature slide's own scene (track 027): a horizontal strip that scrolls the active feature
 * into view over the sand while the beach's sunbeds fade out — drinks ordered to the sunbed
 * reaching the bar's board, boards leaving and returning to the rack, the staff grid checking
 * guests in, a receipt printing. Slide 0 (booking) is the live beach itself, so its panel is
 * empty. Only shipped features; illustrative, no figures. Decorative: aria-hidden (the headline
 * says it in text).
 */
const ORDER: HeroMode[] = ['book', 'device', 'order', 'rent', 'checkin', 'invoice']
/** Every scene is designed at this height and scaled to the band it gets. */
const DESIGN_H = 250

// react-qr-code types against the hoisted @types/react 19 (same cast as apps/user PassView).
const QRCode = QRCodeLib as unknown as FC<{ value: string; size?: number; style?: React.CSSProperties }>

export default function HeroVignettes({
  mode,
  reduced,
  withBook = false,
  maxScale = 1,
}: {
  mode: HeroMode
  reduced: boolean
  /** Desktop column: slide 0 gets its own scene too (on mobile the beach itself is slide 0's scene). */
  withBook?: boolean
  /** How far a scene may grow past its design size to fill a large column. */
  maxScale?: number
}) {
  const index = ORDER.indexOf(mode)
  // Moving backwards (the loop starting over, or a tapped earlier dot) jumps there at once — a
  // smooth rewind would sweep every scene past in reverse.
  const prev = useRef(index)
  const jump = index < prev.current
  useEffect(() => {
    prev.current = index
  }, [index])
  return (
    <div className="pointer-events-none h-full w-full overflow-hidden" aria-hidden>
      <div
        className={`flex h-full ${reduced || jump ? '' : 'transition-transform duration-[900ms] ease-[cubic-bezier(.22,.8,.24,1)]'}`}
        style={{ transform: `translateX(-${index * 100}%)` }}
      >
        {ORDER.map((m) => (
          <div key={m} className="flex h-full w-full shrink-0 items-center justify-center px-4">
            {(m !== 'book' || withBook) && (
              <FitScale max={maxScale}>
                {m === 'book' && <BookScene active={mode === m && !reduced} />}
                {m === 'device' && <DeviceScene active={mode === m && !reduced} />}
                {m === 'order' && <OrderScene active={mode === m && !reduced} />}
                {m === 'rent' && <RentScene active={mode === m && !reduced} />}
                {m === 'checkin' && <CheckinScene active={mode === m && !reduced} />}
                {m === 'invoice' && <InvoiceScene active={mode === m && !reduced} />}
              </FitScale>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

/** Scales a DESIGN_H-tall scene to the box it is given: down to fit, up to `max` (default: never up). */
export function FitScale({ children, max = 1 }: { children: ReactNode; max?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const [k, setK] = useState(1)
  useLayoutEffect(() => {
    const el = ref.current?.parentElement
    if (!el) return
    const fit = () => setK(Math.min(max, el.clientHeight / DESIGN_H, el.clientWidth / 360))
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [max])
  return (
    <div ref={ref} style={{ transform: `scale(${k})`, height: DESIGN_H }} className="flex origin-center items-center">
      {children}
    </div>
  )
}

/** A step counter that ticks while the scene is on screen, and resets when it leaves. */
function useTicks(active: boolean, ms: number, max: number) {
  const [n, setN] = useState(0)
  useEffect(() => {
    if (!active) return setN(0)
    const timer = setInterval(() => setN((x) => (x + 1) % max), ms)
    return () => clearInterval(timer)
  }, [active, ms, max])
  return n
}

const paper = 'rounded-2xl border border-[#0e3a4a]/10 bg-white shadow-[0_10px_30px_rgba(14,58,74,0.18)]'

/** Lemonade: a glass with ice, a lemon slice and a straw. */
function Lemonade({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size * 1.25} viewBox="0 0 32 40" aria-hidden>
      <path d="M21 2l-4 14" stroke="#ef4444" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M5 10h22l-3 27a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2z" fill="#fde68a" stroke="#0e3a4a" strokeWidth="1.5" />
      <path d="M6 16h20" stroke="#fff" strokeOpacity=".7" strokeWidth="2" />
      <rect x="10" y="20" width="6" height="6" rx="1.5" fill="#fff" fillOpacity=".8" />
      <rect x="16" y="26" width="5" height="5" rx="1.5" fill="#fff" fillOpacity=".7" />
      <circle cx="26" cy="11" r="5" fill="#facc15" stroke="#0e3a4a" strokeWidth="1.2" />
      <path d="M26 6v10M21 11h10" stroke="#fff" strokeWidth="1" />
    </svg>
  )
}

/** Sparkling water: a bottle with bubbles. */
function Sparkling({ size = 22 }: { size?: number }) {
  return (
    <svg width={size * 0.6} height={size * 1.25} viewBox="0 0 20 40" aria-hidden>
      <rect x="7" y="1" width="6" height="5" rx="1" fill="#0e3a4a" />
      <path d="M7 6h6v5c3 2 5 4 5 8v17a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3V19c0-4 2-6 5-8z" fill="#bae6fd" stroke="#0e3a4a" strokeWidth="1.5" />
      <rect x="2.8" y="21" width="14.4" height="8" fill="#00cef1" />
      <circle cx="8" cy="17" r="1.3" fill="#fff" />
      <circle cx="12" cy="14" r="1" fill="#fff" />
      <circle cx="10" cy="33" r="1.2" fill="#fff" />
    </svg>
  )
}

const CHIP = {
  reserved: 'border-red-200 bg-red-50 text-red-700',
  occupied: 'border-blue-200 bg-blue-50 text-blue-700',
  free: 'border-green-200 bg-green-50 text-green-700',
} as const

/** The parasol's status indicator through a seat's day: reserved (red), the guest arrives (blue), free again (green). */
export function DeviceScene({ active }: { active: boolean }) {
  const t = useTranslations('Hero.v')
  const [step, setStep] = useState(0)
  const [animate, setAnimate] = useState(true)
  useEffect(() => {
    if (!active) {
      // Back to red once the strip has carried it away, without turning the wheel on screen.
      const timer = setTimeout(() => {
        setAnimate(false)
        setStep(0)
      }, 1000)
      return () => clearTimeout(timer)
    }
    setAnimate(true)
    const timers = [setTimeout(() => setStep(1), 1300), setTimeout(() => setStep(2), 3300)]
    return () => timers.forEach(clearTimeout)
  }, [active])
  const status = deviceStatus(step)
  return (
    <div className="flex items-center gap-10">
      <div className="grid h-[230px] w-[230px] place-items-center">
        <DeviceModel step={step} animate={animate} className="scale-[0.78]" />
      </div>
      <div className={`${paper} px-3 py-2.5`}>
        <p className="text-[11px] font-semibold text-gray-900">{t('sunbed')}</p>
        {/* Every label in one cell, only the current one shown: the card is as wide as the widest
            label, so the row (centred) never shifts the device when the status changes. */}
        <p
          className={`mt-1.5 grid rounded-full border px-2.5 py-0.5 text-center text-[11px] font-semibold transition-colors duration-500 ${CHIP[status]}`}
        >
          {(['reserved', 'occupied', 'free'] as const).map((k) => (
            <span key={k} className={`col-start-1 row-start-1 ${k === status ? '' : 'invisible'}`}>
              {t(`dv_${k}`)}
            </span>
          ))}
        </p>
      </div>
    </div>
  )
}

export function OrderScene({ active }: { active: boolean }) {
  const t = useTranslations('Hero.v')
  // 0 phone idle · 1 tap · 2 ticket New · 3 Preparing · 4 Ready · 5 Delivered
  const n = useTicks(active, 900, 7)
  const status = [t('st_new'), t('st_preparing'), t('st_ready'), t('st_delivered')]
  const stage = Math.max(0, Math.min(3, n - 2))
  return (
    <div className="flex items-center gap-4">
      <div className="w-[128px] rounded-[26px] border-[5px] border-[#0e3a4a] bg-white p-2.5 shadow-xl">
        <p className="text-[11px] font-semibold text-gray-900">{t('sunbed')}</p>
        {[
          [t('item1'), <Lemonade key="l" size={16} />],
          [t('item2'), <Sparkling key="s" size={16} />],
        ].map(([it, icon]) => (
          <div key={String(it)} className="mt-1.5 flex items-center gap-1.5 rounded-lg bg-gray-50 px-1.5 py-1 text-[10px] text-gray-700">
            {icon}
            <span className="flex-1">{it}</span>
            <span className="grid h-4 w-4 place-items-center rounded-full bg-[#0e3a4a] text-[10px] text-white">+</span>
          </div>
        ))}
        <div className={`mt-2 rounded-lg py-1.5 text-center text-[10px] font-semibold text-white transition ${n === 1 ? 'scale-95 bg-blue-600' : n >= 2 ? 'bg-green-600' : 'bg-[#0e3a4a]'}`}>
          {n >= 2 ? t('paid') : t('orderPay')}
        </div>
      </div>
      <div className={`w-[176px] p-3 ${paper}`}>
        <p className="text-[11px] font-medium text-gray-500">{t('board')}</p>
        <div className={`mt-2 rounded-xl border p-2.5 transition-all duration-500 ${n >= 2 ? 'translate-x-0 opacity-100' : 'translate-x-6 opacity-0'} ${stage === 3 ? 'border-green-200 bg-green-50' : 'border-gray-200'}`}>
          <p className="text-[12px] font-semibold text-gray-900">{t('sunbed')}</p>
          <div className="mt-1 flex items-end gap-1.5">
            <Lemonade size={20} />
            <Lemonade size={20} />
            <Sparkling size={20} />
          </div>
          <span key={stage} className={`mt-1.5 inline-block animate-[pop_200ms_ease-out] rounded-full px-2 py-0.5 text-[10px] font-semibold ${stage === 3 ? 'bg-green-600 text-white' : 'bg-blue-50 text-blue-700'}`}>
            {status[stage]}
          </span>
        </div>
        {/* On its way: the drinks leave the bar once the order is ready. */}
        <div className="relative mt-2 h-9 overflow-hidden rounded-xl border border-dashed border-gray-200">
          <div className={`absolute inset-y-0 flex items-center gap-1 transition-all duration-700 ${stage >= 2 ? 'left-[60%] opacity-100' : 'left-2 opacity-0'}`}>
            <Lemonade size={14} />
            <Sparkling size={14} />
          </div>
        </div>
      </div>
    </div>
  )
}

/** One sunbed as the guest app draws it — the app's own vector art: ring, blue + check, towel when booked. */
const VIGNETTE_BED_PX = 34
function AppBed({ status }: { status: 'free' | 'selected' | 'booked' }) {
  return (
    <span className={`block ${status === 'selected' ? 'animate-[pop_240ms_ease-out]' : ''}`}>
      <BedGlyphSvg
        state={BED_STATE[status]}
        lengthPx={VIGNETTE_BED_PX}
        width={VIGNETTE_BED_PX * BED_WIDTH_RATIO}
        height={VIGNETTE_BED_PX}
      />
    </span>
  )
}

export function BookScene({ active }: { active: boolean }) {
  const t = useTranslations('Hero.v')
  // 0 idle · 1 a bed picked · 2 Reserve pressed · 3 paid · 4–6 the pass is out
  const n = useTicks(active, 950, 8)
  // The guest picks A3 — the same sunbed the other scenes order drinks to and receipt.
  const booked = [1, 4, 7]
  const pick = 2
  return (
    <div className="flex items-center gap-4">
      <BedArtDefs />
      <div className="w-[150px] rounded-[26px] border-[5px] border-[#0e3a4a] bg-white p-2.5 shadow-xl">
        <div className="flex items-center justify-between text-[10px]">
          <span className="font-semibold text-gray-900">{t('bk_choose')}</span>
          <span className="text-gray-500">{t('today')}</span>
        </div>
        <div className="mt-2 grid grid-cols-5 justify-items-center gap-y-2 rounded-lg bg-[#f8ecd0] px-1 py-2">
          {Array.from({ length: 10 }, (_, i) => (
            <AppBed key={i} status={booked.includes(i) ? 'booked' : i === pick && n >= 1 ? 'selected' : 'free'} />
          ))}
        </div>
        <div className={`mt-2 rounded-lg py-1.5 text-center text-[10px] font-semibold text-white transition ${n === 2 ? 'scale-95 bg-blue-600' : n >= 3 ? 'bg-green-600' : 'bg-[#0e3a4a]'}`}>
          {n >= 3 ? t('paid') : t('bk_reserve')}
        </div>
      </div>
      <div className={`w-[150px] p-3 transition-all duration-500 ${paper} ${n >= 4 ? 'translate-x-0 opacity-100' : 'translate-x-6 opacity-0'}`}>
        <p className="text-[11px] font-medium text-gray-500">{t('bk_pass')}</p>
        <p className="mt-1 text-[13px] font-semibold text-gray-900">{t('sunbed')}</p>
        <p className="text-[10px] text-gray-500">{t('today')}</p>
        <div className="mt-2 grid place-items-center">
          <QRCode value="https://sunbnb.app" size={84} style={{ width: 84, height: 84 }} />
        </div>
      </div>
    </div>
  )
}

export function RentScene({ active }: { active: boolean }) {
  const t = useTranslations('Hero.v')
  const boards = ['#00cef1', '#f59e0b', '#22c55e', '#ef4444', '#8b5cf6']
  // Each tick, one board is out on the water; it comes back as the next one leaves.
  const out = useTicks(active, 1400, boards.length)
  const n = useTicks(active, 700, 2)
  return (
    <div className="flex items-end gap-5">
      <div className="relative flex h-[200px] items-end gap-2 rounded-2xl border-b-[6px] border-[#8b6b43] px-3 pb-1">
        {boards.map((c, i) => (
          <div
            key={c}
            className={`w-[22px] rounded-full border border-black/20 shadow transition-all duration-700 ${active && i === out ? '-translate-y-24 opacity-0' : 'opacity-100'}`}
            style={{ background: c, height: 150 + (i % 2) * 22 }}
          />
        ))}
      </div>
      <div className={`w-[170px] p-3 ${paper}`}>
        <p className="text-[11px] font-medium text-gray-500">{t('rentals')}</p>
        <p className="mt-1.5 text-[13px] font-semibold text-gray-900">{t('paddleboard')}</p>
        <p className="text-[10px] text-gray-500">{t('byHour')}</p>
        <span className="mt-2 inline-block rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-[10px] font-semibold text-green-700">{t('paid')}</span>
        <div className="mt-2 flex gap-1.5">
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold transition ${n === 0 ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-500'}`}>{t('pickedUp')}</span>
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold transition ${n === 1 ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-500'}`}>{t('returned')}</span>
        </div>
      </div>
    </div>
  )
}

export function CheckinScene({ active }: { active: boolean }) {
  const t = useTranslations('Hero.v')
  // The partner grid's colours (@repo/floor-core): free green-300, reserved fuchsia-400, occupied red-400.
  const reserved = [0, 2, 3, 5, 8, 10]
  const n = useTicks(active, 850, reserved.length + 2)
  return (
    <div className="w-[300px] rounded-[22px] border-[6px] border-[#0e3a4a] bg-white p-3 shadow-xl">
      <div className="mb-2 flex items-center justify-between text-[11px]">
        <span className="font-semibold text-gray-900">{t('frontDesk')}</span>
        <span className="text-gray-500">{t('today')}</span>
      </div>
      <div className="grid grid-cols-6 gap-1.5">
        {Array.from({ length: 12 }, (_, i) => {
          const r = reserved.indexOf(i)
          const isIn = r >= 0 && r < n
          const cls = isIn ? 'border-red-600 bg-red-400 text-white' : r >= 0 ? 'border-fuchsia-600 bg-fuchsia-400 text-white' : 'border-green-500 bg-green-300 text-green-900'
          return (
            <div key={i} className={`relative grid h-11 place-items-center rounded-md border-2 text-[10px] font-semibold ${cls} ${isIn && r === n - 1 ? 'animate-[pop_240ms_ease-out]' : ''}`}>
              {String.fromCharCode(65 + Math.floor(i / 6))}
              {(i % 6) + 1}
              {isIn && <span className="absolute -right-1 -top-1 grid h-4 w-4 place-items-center rounded-full bg-green-600 text-[9px] text-white ring-2 ring-white">✓</span>}
            </div>
          )
        })}
      </div>
      <div className="mt-2.5 flex gap-3 text-[10px] text-gray-600">
        <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-fuchsia-400" />{t('reserved')}</span>
        <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-red-400" />{t('checkedIn')}</span>
      </div>
    </div>
  )
}

export function InvoiceScene({ active }: { active: boolean }) {
  const t = useTranslations('Hero.v')
  const lines = [t('rc_sunbed'), t('rc_drinks'), t('rc_board'), t('rc_vat')]
  const n = useTicks(active, 650, lines.length + 4)
  return (
    <div className="relative">
      <div className="w-[210px] bg-white px-4 pb-6 pt-4 shadow-[0_10px_30px_rgba(14,58,74,0.18)]" style={{ clipPath: 'polygon(0 0,100% 0,100% calc(100% - 8px),92% 100%,84% calc(100% - 8px),76% 100%,68% calc(100% - 8px),60% 100%,52% calc(100% - 8px),44% 100%,36% calc(100% - 8px),28% 100%,20% calc(100% - 8px),12% 100%,4% calc(100% - 8px),0 100%)' }}>
        <p className="text-center text-[12px] font-bold text-gray-900">{t('rc_title')}</p>
        <p className="mb-2 text-center text-[10px] text-gray-500">{t('rc_venue')}</p>
        <div className="border-t border-dashed border-gray-300 pt-2">
          {lines.map((l, i) => (
            <p key={l} className={`py-0.5 text-[11px] text-gray-700 transition-all duration-300 ${i < n ? 'translate-y-0 opacity-100' : 'translate-y-1 opacity-0'}`}>
              {l}
            </p>
          ))}
        </div>
        <div className={`mt-2 flex items-center gap-2.5 border-t border-dashed border-gray-300 pt-2 transition-opacity ${n > lines.length ? 'opacity-100' : 'opacity-0'}`}>
          <QRCode value="https://sunbnb.app" size={46} style={{ width: 46, height: 46 }} />
          <div className="text-[10px] leading-tight text-gray-500">
            <p className="font-medium text-gray-700">{t('rc_qr')}</p>
            <p>{t('rc_numbered')}</p>
          </div>
        </div>
      </div>
      <span className={`absolute left-[calc(100%-26px)] top-[42%] whitespace-nowrap rotate-[-8deg] rounded-full bg-green-600 px-3 py-1 text-[11px] font-bold text-white shadow-lg transition-all duration-300 ${n > lines.length + 1 ? 'scale-100 opacity-100' : 'scale-50 opacity-0'}`}>
        ✓ {t('rc_sent')}
      </span>
    </div>
  )
}
