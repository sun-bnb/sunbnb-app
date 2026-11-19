'use client'

import { useEffect, useRef } from 'react'
import dayjs from 'dayjs'
import { useDispatch, useSelector } from 'react-redux'
import { useLocale, useTranslations } from 'next-intl'

import { SiteProps } from '@/app/sites/types'
import { RootState } from '@/store/store'
import { setValue } from '@/store/features/sites/sitesSlice'
import ReservationView from '@/app/sites/[id]/Reservation'
import { formatStay, singleDayRange } from '@/app/sites/[id]/day-strip'
import { formatSeatId } from '@repo/data/seat-label'
import { RESERVATION_PROCESSING } from '@repo/data/reservation-status'
import { BTN_PRIMARY } from './ui'

/**
 * The booking funnel as ONE mountable component (track 023 P2).
 *
 * Everything a guest uses to actually book — the dates, seat selection,
 * equipment, the price and the Reserve button — plus the responsive shell
 * around it: a sticky sidebar at `lg`; below it a **mini bar** and a
 * **booking sheet**.
 *
 * **Phone shell — two states, each with one job.**
 * - *Mini bar* (collapsed, the default): one line pinned to the bottom of the
 *   page saying what is being booked, plus Book. The page stays readable.
 * - *Sheet* (expanded): fixed height from just below the site header to the
 *   bottom of the screen. It never scrolls as a whole — its content is a
 *   column whose controls have fixed heights and whose map (or item list)
 *   takes every remaining pixel, with the footer and Reserve pinned at the
 *   bottom. So Reserve is on screen on every phone, by construction.
 *
 * This replaced a peek-and-expand drawer whose collapsed state had to hold the
 * date controls (so it could not be small) and whose expanded state stacked
 * fixed heights taller than a short phone.
 *
 * **Why it is a component rather than part of the page.** A custom brand page
 * (track 023) owns its own layout, and the one thing it must NOT own is the
 * funnel: a bespoke shell that copies it inherits a copy that stops matching
 * the day the payment step, the seat-selection policy or the sheet mechanics
 * change. Brands mount this instead, and an engine change reaches every shell.
 *
 * **Contract.** Give it a site, a Maps key, and optionally the two colours that
 * make it sit inside a branded page. It reads and writes the `sites` slice
 * (`focused` = sheet open, `dateRange`, `reservationDay`, `reservationMode`,
 * `viewMode`) — the panel, the map and the seat canvas coordinate through it.
 *
 * **Placement.** It renders its own desktop column, the mobile spacer, the mini
 * bar and the sheet as siblings. Put it inside a flex row for the sidebar to
 * sit beside the page content; the mobile parts are `position: fixed`. A page
 * whose header is not ~80px tall can set `--booking-sheet-top`.
 */

/**
 * The only two brand values the funnel needs. Deliberately NOT `SiteViewBrand`:
 * the funnel does not care about a brand name, a tagline or a logo, and taking
 * the whole object would tie this component to whatever that shape becomes.
 */
export interface BookingTheme {
  background?: string | null
  foreground?: string | null
}

const DEFAULT_BACKGROUND = '#faf9f6'
const DEFAULT_FOREGROUND = '#111827'

/** Mini bar: 10px padding + 44px button + 10px padding (+ the safe-area inset). */
const MINI_BAR_HEIGHT = 64

function Chevron({ up, className = 'h-4 w-4' }: { up?: boolean; className?: string }) {
  return (
    <svg className={`${className} ${up ? 'rotate-180' : ''}`} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
    </svg>
  )
}

/** The collapsed state: what is being booked, in one line, and the way back in. */
function MiniBar({ onOpen, style }: { onOpen: () => void; style?: React.CSSProperties }) {
  const t = useTranslations('SiteView')
  const locale = useLocale()
  const sitesState = useSelector((state: RootState) => state.sites)
  const { selectedItems, reservationState, pendingReservationId } = sitesState
  const viewMode = sitesState.viewMode || 'sunbeds'

  const dateRange: [string, string] = sitesState.dateRange || singleDayRange(dayjs().format('YYYY-MM-DD'))
  const items: any[] = selectedItems ?? []
  const paying = !!pendingReservationId && (reservationState === RESERVATION_PROCESSING || reservationState === 'payment_in_progress')

  let title: string
  let detail: string
  if (paying) {
    title = t('Complete your payment')
    detail = items.map((i) => formatSeatId(i)).join(', ')
  } else if (viewMode === 'equipment') {
    title =
      sitesState.reservationMode === 'hours'
        ? formatStay(locale, sitesState.reservationDay || new Date())
        : formatStay(locale, dateRange[0], dateRange[1])
    detail = t('Equipment')
  } else {
    title = formatStay(locale, dateRange[0], dateRange[1])
    detail = items.length
      ? `${t('sunbedsSelected', { count: items.length })} · ${items.map((i) => formatSeatId(i)).join(', ')}`
      : t('Choose your sunbeds')
  }

  return (
    <div
      className="lg:hidden fixed inset-x-0 bottom-0 z-[11] border-t border-brand-ink/10 bg-cream px-3 pt-2.5 pb-[calc(0.625rem+env(safe-area-inset-bottom))] shadow-[0_-4px_16px_rgba(23,50,58,0.06)]"
      style={style}
    >
      <div className="flex items-center gap-3">
        <button type="button" onClick={onOpen} className="min-w-0 flex-1 rounded-lg text-left focus-visible:outline-2 focus-visible:outline-brand-ink" aria-label={`${title}. ${detail}`}>
          <span className="flex items-center gap-1 text-sm font-semibold text-brand-ink first-letter:uppercase">
            <Chevron up className="h-4 w-4 shrink-0 text-brand-ink/50" />
            <span className="truncate">{title}</span>
          </span>
          <span className="block truncate pl-5 text-xs text-brand-ink/60">{detail}</span>
        </button>
        <button type="button" onClick={onOpen} className={`${BTN_PRIMARY} h-11 shrink-0`}>
          {paying ? t('Continue') : t('Book')}
        </button>
      </div>
    </div>
  )
}

export default function BookingSurface({
  site,
  apiKey,
  theme,
  openOnMount = false,
}: {
  site: SiteProps
  apiKey: string
  theme?: BookingTheme
  /**
   * Open the sheet on first load. Off by default: the page opens on the venue
   * with the mini bar below it — the guest reads the page first, and Book is
   * always one tap away. (Track 014 opened the old drawer on load because its
   * collapsed state was easy to miss; the mini bar is not.)
   */
  openOnMount?: boolean
}) {
  const dispatch = useDispatch()
  const t = useTranslations('SiteView')
  const sitesState = useSelector((state: RootState) => state.sites)
  const open = sitesState.focused === true
  const setOpen = (value: boolean) => dispatch(setValue({ focused: value }))

  // Commit today as the default reservationDay so downstream components
  // (SunbedSelection, ReservationView) see a real committed value rather than
  // a render-time fallback (track 014). Runs once per mount.
  useEffect(() => {
    const updates: Record<string, unknown> = openOnMount ? { focused: true } : {}
    if (!sitesState.reservationDay) updates.reservationDay = dayjs().toDate()
    if (Object.keys(updates).length > 0) dispatch(setValue(updates))
  }, [])

  // A closed sheet is off-screen but mounted (the map keeps its state and the
  // seat preselection runs, so the mini bar can name the seats). `inert` keeps
  // it out of the tab order and away from screen readers while closed — set
  // on the node because this app types JSX against @types/react 18.
  const sheetRef = useRef<HTMLDivElement>(null)

  // Drag-to-close on the handle: the sheet follows the finger down; past
  // CLOSE_DISTANCE (or on a downward flick) it closes, otherwise springs back.
  // A tap closes too — via onClick, which a real drag suppresses.
  //
  // The drag offset goes straight onto the element as a CSS variable — no
  // React state — so following the finger never re-renders the sheet (it
  // holds the Google Map). Flick speed is measured over the latest movement.
  const CLOSE_DISTANCE = 90
  const CLOSE_VELOCITY = 0.5 // px per ms
  const drag = useRef<{ y0: number; y: number; t: number; v: number; moved: boolean } | null>(null)
  const suppressClick = useRef(false)
  const endDrag = () => {
    const el = sheetRef.current
    if (el) {
      el.style.removeProperty('--sheet-drag')
      el.style.transition = ''
    }
  }
  const handlePointer = {
    onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId)
      drag.current = { y0: e.clientY, y: e.clientY, t: performance.now(), v: 0, moved: false }
      suppressClick.current = false
    },
    onPointerMove: (e: React.PointerEvent<HTMLButtonElement>) => {
      const d = drag.current
      const el = sheetRef.current
      if (!d || !el) return
      const now = performance.now()
      d.v = (e.clientY - d.y) / Math.max(1, now - d.t)
      d.y = e.clientY
      d.t = now
      const dy = Math.max(0, e.clientY - d.y0)
      if (dy > 6 && !d.moved) {
        d.moved = true
        el.style.transition = 'none'
      }
      if (d.moved) el.style.setProperty('--sheet-drag', `${dy}px`)
    },
    onPointerUp: (e: React.PointerEvent<HTMLButtonElement>) => {
      const d = drag.current
      drag.current = null
      endDrag()
      if (!d?.moved) return // a tap: onClick closes
      suppressClick.current = true
      if (e.clientY - d.y0 > CLOSE_DISTANCE || d.v > CLOSE_VELOCITY) setOpen(false)
    },
    onPointerCancel: () => {
      drag.current = null
      endDrag()
    },
  }
  useEffect(() => {
    if (sheetRef.current) sheetRef.current.inert = !open
  }, [open])

  // While the sheet is open on a phone: Escape closes it, and the page behind
  // does not scroll under the scrim.
  useEffect(() => {
    if (!open || !window.matchMedia('(max-width: 1023px)').matches) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dispatch(setValue({ focused: false }))
    }
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = previous
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const background = theme ? theme.background || DEFAULT_BACKGROUND : undefined
  const foreground = theme ? theme.foreground || DEFAULT_FOREGROUND : undefined
  const themed = theme ? { backgroundColor: background, color: foreground, borderColor: `${foreground}15` } : undefined

  return (
    <>
      {/* Desktop: sticky sidebar beside the page content */}
      <div className="hidden lg:block lg:flex-2 lg:min-w-[360px] lg:max-w-[480px]">
        <div
          className={`lg:sticky lg:top-[80px] px-3 pb-4 ${theme ? '' : 'bg-cream'}`}
          style={theme ? { backgroundColor: background } : undefined}
        >
          <ReservationView apiKey={apiKey} site={site} wide={true} />
        </div>
      </div>

      {/* Phone: room at the end of the page so the mini bar never covers content */}
      <div className="lg:hidden" style={{ height: `calc(${MINI_BAR_HEIGHT + 16}px + env(safe-area-inset-bottom))` }} />

      <MiniBar onOpen={() => setOpen(true)} style={themed} />

      {/* Scrim: frames the open sheet; a tap on it closes the sheet. */}
      <div
        aria-hidden="true"
        onClick={() => setOpen(false)}
        className={`lg:hidden fixed inset-0 z-[12] bg-black/40 transition-opacity duration-300 motion-reduce:transition-none ${
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      />

      <div
        ref={sheetRef}
        role="dialog"
        aria-modal={open}
        aria-label={t('Book')}
        className={`lg:hidden fixed inset-x-0 bottom-0 z-[13] flex flex-col rounded-t-2xl border-t border-brand-ink/10 shadow-[0_-8px_30px_rgba(23,50,58,0.14)] transition-transform duration-300 ease-out motion-reduce:transition-none ${
          theme ? '' : 'bg-cream'
        }`}
        style={{
          top: 'var(--booking-sheet-top, 5rem)',
          transform: open ? 'translateY(var(--sheet-drag, 0px))' : 'translateY(calc(100% + 32px))',
          ...themed,
        }}
      >
        {/* The handle: a grabber bar on the sheet's own top edge — part of the
            panel, not a control floating on it. Drag it down (or tap it) to
            close. The whole strip is the hit area; "Close" is its accessible
            name. touch-none keeps the drag from scrolling the page. */}
        <button
          type="button"
          {...handlePointer}
          onClick={() => {
            if (suppressClick.current) {
              suppressClick.current = false
              return
            }
            setOpen(false)
          }}
          className="group flex h-8 w-full shrink-0 cursor-grab touch-none items-center justify-center rounded-t-2xl active:cursor-grabbing focus-visible:outline-none"
        >
          <span
            aria-hidden="true"
            className="h-1.5 w-14 rounded-full bg-brand-ink/25 transition-colors group-hover:bg-brand-ink/40 group-active:bg-brand-ink/50 group-focus-visible:bg-brand-ink/60 group-focus-visible:ring-2 group-focus-visible:ring-brand-ink/30 group-focus-visible:ring-offset-2"
          />
          <span className="sr-only">{t('Close')}</span>
        </button>
        {/* The safety net: content is built to fit (the map flexes), but an
            open calendar on a very short screen may not — it scrolls here. */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          <ReservationView apiKey={apiKey} site={site} />
        </div>
      </div>
    </>
  )
}
