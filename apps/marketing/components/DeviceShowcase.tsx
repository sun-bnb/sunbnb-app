'use client'

import { useTranslations } from 'next-intl'
import { useEffect, useRef, useState, type CSSProperties, type FC, type ReactNode } from 'react'
import QRCodeLib from 'react-qr-code'

// react-qr-code types against the hoisted @types/react 19 (same cast as HeroVignettes).
const QRCode = QRCodeLib as unknown as FC<{
  value: string
  size?: number
  bgColor?: string
  fgColor?: string
  style?: CSSProperties
}>

/**
 * The seat-side status indicator (tracks 019/021/025), modelled from photos of the prototype in
 * pure CSS 3D: two screw-fastened plates either side of a core, solar panels on the top and both
 * sides, and a colour wheel behind a fan-shaped window in the front plate. The wheel shows the
 * seat's status — red reserved, blue occupied, green free — and turns through them in a day's
 * order, always the same way. The device is still in testing, so the copy says so —
 * the page's rule is that every claim is true today. The model is decorative (aria-hidden); the
 * text beside it carries the meaning.
 */

// Box size in px, proportioned from the photos (front ≈ 1.1 : 1, depth ≈ 0.42 × width).
const W = 260
const H = 236
const D = 110
/** Plate thickness — drawn as stacked layers, which also gives the window its wall. */
const PLATE = 5
/** How far the plates overhang the core on every edge. */
const LIP = 3
const CORNER = 12

// The window: an annular sector pointing down at the wheel's hub (photo-measured).
const HUB = { x: W / 2, y: 141 }
const R_OUT = 97
const R_IN = 38
const HALF = (32 * Math.PI) / 180
const at = (a: number, r: number) => `${(HUB.x + r * Math.sin(a)).toFixed(2)} ${(HUB.y - r * Math.cos(a)).toFixed(2)}`
const WINDOW = `M${at(-HALF, R_OUT)} A${R_OUT} ${R_OUT} 0 0 1 ${at(HALF, R_OUT)} L${at(HALF, R_IN)} A${R_IN} ${R_IN} 0 0 0 ${at(-HALF, R_IN)} Z`
const PLATE_OUTLINE = `M${CORNER} 0 H${W - CORNER} Q${W} 0 ${W} ${CORNER} V${H - CORNER} Q${W} ${H} ${W - CORNER} ${H} H${CORNER} Q0 ${H} 0 ${H - CORNER} V${CORNER} Q0 0 ${CORNER} 0 Z`

const RED = '#e5372e'
const BLUE = '#2f7de1'
const GREEN = '#76c92f'
/**
 * A third of the wheel per status, clockwise from the window: each step turns it a third, so a
 * seat's day reads reserved → occupied → free → reserved again (the window is narrower than a
 * sector, so only one colour ever shows at rest).
 */
const WHEEL = `conic-gradient(from -60deg, ${RED} 0 120deg, ${BLUE} 120deg 240deg, ${GREEN} 240deg 360deg)`
export type DeviceStatus = 'reserved' | 'occupied' | 'free'
const STATUSES: DeviceStatus[] = ['reserved', 'occupied', 'free']
/** The status the wheel shows after `step` turns. */
export const deviceStatus = (step: number): DeviceStatus => STATUSES[step % 3]!
const STEP_MS = 3200

export default function DeviceShowcase() {
  const t = useTranslations('Device')
  const ref = useRef<HTMLElement>(null)
  const [step, setStep] = useState(0)
  const [visible, setVisible] = useState(false)
  const [drag, setDrag] = useState(0)
  const dragFrom = useRef<{ x: number; base: number } | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => setVisible(Boolean(e?.isIntersecting)), {
      threshold: 0.3,
    })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  // The wheel only turns while someone can see it, so the first turn they see is red → green.
  useEffect(() => {
    if (!visible) return
    const id = setInterval(() => setStep((s) => s + 1), STEP_MS)
    return () => clearInterval(id)
  }, [visible])
  const status = deviceStatus(step)

  return (
    <section ref={ref} data-track-section="device" aria-labelledby="device-title" className="mx-auto grid max-w-5xl items-center gap-8 px-4 py-16 md:grid-cols-[1.1fr_1fr] md:gap-12">
      <div
        className="relative flex h-[330px] cursor-grab touch-pan-y select-none items-center justify-center active:cursor-grabbing sm:h-[400px]"
        aria-hidden
        onPointerDown={(e) => {
          dragFrom.current = { x: e.clientX, base: drag }
          e.currentTarget.setPointerCapture(e.pointerId)
        }}
        onPointerMove={(e) => {
          if (dragFrom.current) setDrag(Math.max(-70, Math.min(70, dragFrom.current.base + (e.clientX - dragFrom.current.x) * 0.4)))
        }}
        onPointerUp={() => (dragFrom.current = null)}
        onPointerCancel={() => (dragFrom.current = null)}
      >
        <DeviceModel step={step} drag={drag} className="scale-[0.82] sm:scale-100" />
      </div>

      <div>
        <p className="text-sm font-medium text-[#0083a0]">{t('place')}</p>
        <h2 id="device-title" className="mt-1 text-3xl font-semibold tracking-tight text-[#0e3a4a]">
          {t('title')}
        </h2>
        <p className="mt-3 text-[15px] leading-relaxed text-[#0e3a4a]/75">{t('body')}</p>
        <ul className="mt-4 space-y-2 text-[15px] text-[#0e3a4a]/80">
          {(
            [
              ['free', GREEN],
              ['reserved', RED],
              ['occupied', BLUE],
            ] as const
          ).map(([k, color]) => (
            <li key={k} className="flex items-center gap-2.5">
              <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: color }} />
              {t(k)}
            </li>
          ))}
          <li className="flex items-center gap-2.5">
            <span className="h-3 w-3 shrink-0 rounded-[3px] border-2 border-dotted border-[#0e3a4a]/70" />
            {t('qr')}
          </li>
          <li className="flex items-center gap-2.5">
            <span className="h-3 w-3 shrink-0 rounded-[3px] bg-[#1a2230]" />
            {t('solar')}
          </li>
        </ul>
        <p className="mt-5 inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-sm text-amber-800">{t('testing')}</p>
        {/* Live status for the animation, for screen readers that announce it at all. */}
        <p className="sr-only" role="status">
          {t(status)}
        </p>
      </div>
    </section>
  )
}

/**
 * The model on its own: perspective, a slow sway, and the drag turn. `step` counts turns of the
 * wheel (see `deviceStatus`); `animate: false` jumps there without the motor turn.
 */
export function DeviceModel({ step, drag = 0, animate = true, className }: { step: number; drag?: number; animate?: boolean; className?: string }) {
  return (
    <div className={className} style={{ perspective: 1100 }}>
      <div
        className="animate-[device-sway_10s_ease-in-out_infinite_alternate] motion-reduce:animate-none"
        style={{
          transformStyle: 'preserve-3d',
          transform: 'rotateX(-12deg) rotateY(-24deg)',
        }}
      >
        <div
          className="**:backface-hidden"
          style={{
            transformStyle: 'preserve-3d',
            transform: `rotateY(${drag}deg)`,
            width: W,
            height: H,
            position: 'relative',
          }}
        >
          <Device wheelTurn={-120 * step} animate={animate} />
        </div>
      </div>
    </div>
  )
}

/** Positions a face of the box: centred on the origin, then turned and pushed out. */
function Face({ w, h, transform, style, children }: { w: number; h: number; transform: string; style?: CSSProperties; children?: ReactNode }) {
  return (
    <div
      className="absolute left-1/2 top-1/2"
      style={{
        width: w,
        height: h,
        marginLeft: -w / 2,
        marginTop: -h / 2,
        transform,
        transformStyle: 'preserve-3d',
        ...style,
      }}
    >
      {children}
    </div>
  )
}

function Device({ wheelTurn, animate }: { wheelTurn: number; animate: boolean }) {
  const coreD = D - 2 * PLATE
  const coreW = W - 2 * LIP
  const coreH = H - 2 * LIP
  const layers = Array.from({ length: PLATE }, (_, i) => i)
  return (
    <>
      {/* Belt and braces for depth: every face hides its back (see the container) and the DOM
          runs inside → outside, so even a renderer that paints planes in DOM order instead of
          sorting them by depth draws the convex box right. */}
      {/* Ground shadow. */}
      <Face
        w={W * 1.25}
        h={D * 1.9}
        transform={`rotateX(90deg) translateZ(${-H / 2 - 1}px)`}
        style={{
          background: 'radial-gradient(closest-side, rgba(14,58,74,.28), rgba(14,58,74,0))',
        }}
      />

      {/* The wheel, just behind the front plate: only the window shows it. */}
      <Face w={W} h={H} transform={`translateZ(${D / 2 - PLATE - 4}px)`} style={{ background: '#2b2f33', overflow: 'hidden', borderRadius: CORNER }}>
        <div
          className={`absolute rounded-full ${animate ? 'transition-transform duration-1100 ease-[cubic-bezier(.5,-0.15,.25,1.25)] motion-reduce:transition-none' : ''}`}
          style={{
            width: R_OUT * 2 + 16,
            height: R_OUT * 2 + 16,
            left: HUB.x - R_OUT - 8,
            top: HUB.y - R_OUT - 8,
            background: WHEEL,
            transform: `rotate(${wheelTurn}deg)`,
          }}
        >
          <div
            className="absolute inset-0 rounded-full"
            style={{
              background: 'radial-gradient(circle, rgba(0,0,0,0) 55%, rgba(0,0,0,.18) 100%)',
            }}
          />
        </div>
      </Face>

      {/* The core between the plates. */}
      <Face w={coreW} h={coreD} transform={`rotateX(90deg) translateZ(${coreH / 2}px)`} style={{ background: 'linear-gradient(#fbfaf7, #efede8)' }}>
        {/* Top solar panel: black glass, raised a little. */}
        <div
          className="absolute left-1/2 top-1/2"
          style={{
            width: W * 0.72,
            height: coreD - 4,
            marginLeft: (-W * 0.72) / 2,
            marginTop: -(coreD - 4) / 2,
            transform: 'translateZ(3px)',
            borderRadius: 3,
            background: 'linear-gradient(115deg, #0b0f16 0%, #1d2532 38%, #3a4555 46%, #10151d 56%, #070a0f 100%)',
            boxShadow: '0 0 0 1px #05070a',
          }}
        />
      </Face>
      <Face w={coreW} h={coreD} transform={`rotateX(-90deg) translateZ(${coreH / 2}px)`} style={{ background: '#d8d5ce' }} />
      <Face w={coreD} h={coreH} transform={`rotateY(90deg) translateZ(${coreW / 2}px)`} style={{ background: 'linear-gradient(90deg, #e9e7e1, #dcd9d2)' }}>
        <SidePanel />
      </Face>
      <Face w={coreD} h={coreH} transform={`rotateY(-90deg) translateZ(${coreW / 2}px)`} style={{ background: 'linear-gradient(90deg, #dcd9d2, #e9e7e1)' }}>
        <SidePanel />
      </Face>

      {/* Front plate: stacked layers for thickness; the front-most carries the print. */}
      {layers.map((i) => (
        <Face key={`f${i}`} w={W} h={H} transform={`translateZ(${D / 2 - (PLATE - 1 - i)}px)`}>
          <Plate fill={i === PLATE - 1 ? 'url(#device-front)' : '#d6d3cc'} withWindow />
          {i === PLATE - 1 && <FrontPrint />}
        </Face>
      ))}

      {/* Back plate: four screws, nothing else. */}
      {layers.map((i) => (
        <Face key={`b${i}`} w={W} h={H} transform={`rotateY(180deg) translateZ(${D / 2 - (PLATE - 1 - i)}px)`}>
          <Plate fill={i === PLATE - 1 ? '#efede8' : '#d6d3cc'} />
          {i === PLATE - 1 && <Screws />}
        </Face>
      ))}
    </>
  )
}

function Plate({ fill, withWindow = false }: { fill: string; withWindow?: boolean }) {
  return (
    <svg className="absolute inset-0" width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
      {fill.startsWith('url(') && (
        <defs>
          <linearGradient id="device-front" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#fdfcfa" />
            <stop offset="1" stopColor="#ecebe6" />
          </linearGradient>
        </defs>
      )}
      <path d={withWindow ? `${PLATE_OUTLINE} ${WINDOW}` : PLATE_OUTLINE} fill={fill} fillRule="evenodd" />
      {withWindow && <path d={WINDOW} fill="none" stroke="rgba(0,0,0,.12)" strokeWidth="1" />}
    </svg>
  )
}

function Screws() {
  return (
    <>
      {(
        [
          [10, 30],
          [W - 10, 30],
          [10, H - 14],
          [W - 10, H - 14],
        ] as const
      ).map(([x, y]) => (
        <span key={`${x}-${y}`} className="absolute h-[4px] w-[4px] rounded-full bg-[#9c988f]" style={{ left: x - 2, top: y - 2 }} />
      ))}
    </>
  )
}

/** The front plate's print: the seat's QR under the window, the Sunbnb mark at the bottom. */
function FrontPrint() {
  return (
    <>
      <div className="absolute rounded-[3px] bg-white p-[3px] shadow-[0_0_0_1px_rgba(14,58,74,.15)]" style={{ left: W / 2 - 29, top: 124 }}>
        <QRCode value="SUNBNB-DEMO:A-12" size={52} fgColor="#1f2933" style={{ display: 'block', width: 52, height: 52 }} />
      </div>
      <div className="absolute inset-x-0 flex items-center justify-center gap-1.5" style={{ top: 199 }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- a 14px mark inside a CSS 3D plane */}
        <img src="/sunbnb-logo.svg" alt="" width={16} height={15} className="opacity-80" />
        <span className="text-[13px] font-semibold tracking-tight text-[#1f2933]/85">sunbnb</span>
      </div>
    </>
  )
}

/** A side's vertical solar panel: two columns of cells under glass, low on the side. */
function SidePanel() {
  return (
    <div
      className="absolute left-1/2 overflow-hidden rounded-[3px]"
      style={{
        width: (D - 2 * PLATE) * 0.84,
        height: (H - 2 * LIP) * 0.74,
        bottom: (H - 2 * LIP) * 0.05,
        transform: `translateX(-50%) translateZ(2px)`,
        background: [
          'linear-gradient(115deg, rgba(255,255,255,0) 30%, rgba(255,255,255,.16) 44%, rgba(255,255,255,0) 58%)',
          'linear-gradient(90deg, transparent calc(50% - 1px), #0a0d12 calc(50% - 1px) calc(50% + 1px), transparent calc(50% + 1px))',
          'repeating-linear-gradient(0deg, rgba(120,140,170,.18) 0 1px, transparent 1px 7px)',
          'linear-gradient(#141b27, #1d2636)',
        ].join(', '),
        boxShadow: '0 0 0 2px #0a0d12',
      }}
    />
  )
}
